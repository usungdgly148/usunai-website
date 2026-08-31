import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const frontendDir = path.join(root, 'frontend');
const label = String(process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-')).replace(/[^a-zA-Z0-9_-]/g, '-');
const candidateDir = path.join(root, '.tmp', 'candidates', label);
const distDir = path.join(candidateDir, 'dist');
const viteCli = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');
const releaseFiles = [
  'server/billing.js',
  'server/index.mjs',
  'server/miniapp-api.mjs',
  'server/miniapp-auth.mjs',
  'server/miniapp-runtime.mjs',
  'server/miniapp-layout.mjs',
  'server/migrate-tutorial-images.mjs',
  'server/plan-validity.mjs',
  'server/kv-local.js',
  'server/package.json',
  'server/package-lock.json',
  'server/rag.mjs',
  'deploy/usun.nginx.conf',
  'deploy/usun.service',
];
const trackedChanges = execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root, encoding: 'utf8' }).trim();
if (trackedChanges) {
  throw new Error('Candidate builds require a clean tracked worktree. Commit or revert tracked changes first.');
}

fs.rmSync(candidateDir, { recursive: true, force: true });
fs.mkdirSync(candidateDir, { recursive: true });

const build = spawnSync(process.execPath, [viteCli, 'build', '--outDir', distDir, '--emptyOutDir'], {
  cwd: frontendDir,
  stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);

for (const relativePath of releaseFiles) {
  const source = path.join(root, relativePath);
  const destination = path.join(candidateDir, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else files.push(fullPath);
  }
};
walk(candidateDir);

const manifest = files.sort().map((file) => ({
  file: path.relative(candidateDir, file).replaceAll('\\', '/'),
  bytes: fs.statSync(file).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
}));
const report = {
  label,
  createdAt: new Date().toISOString(),
  sourceCommit: process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim(),
  payload: ['dist/', 'server/', 'deploy/'],
  fileCount: manifest.length,
  totalBytes: manifest.reduce((sum, item) => sum + item.bytes, 0),
  files: manifest,
};
fs.writeFileSync(path.join(candidateDir, 'manifest.json'), JSON.stringify(report, null, 2));
console.log(`Candidate build created at ${candidateDir}`);
console.log(`Files: ${report.fileCount}; bytes: ${report.totalBytes}; manifest: ${path.join(candidateDir, 'manifest.json')}`);
