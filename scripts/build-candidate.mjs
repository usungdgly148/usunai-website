import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const frontendDir = path.join(root, 'frontend');
const label = String(process.argv[2] || new Date().toISOString().replace(/[:.]/g, '-')).replace(/[^a-zA-Z0-9_-]/g, '-');
const candidateDir = path.join(root, '.tmp', 'candidates', label);
const distDir = path.join(candidateDir, 'dist');
const viteCli = path.join(frontendDir, 'node_modules', 'vite', 'bin', 'vite.js');

fs.rmSync(candidateDir, { recursive: true, force: true });
fs.mkdirSync(candidateDir, { recursive: true });

const build = spawnSync(process.execPath, [viteCli, 'build', '--outDir', distDir, '--emptyOutDir'], {
  cwd: frontendDir,
  stdio: 'inherit',
});
if (build.error) throw build.error;
if (build.status !== 0) process.exit(build.status || 1);

const files = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else files.push(fullPath);
  }
};
walk(distDir);

const manifest = files.sort().map((file) => ({
  file: path.relative(distDir, file).replaceAll('\\', '/'),
  bytes: fs.statSync(file).size,
  sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
}));
const report = {
  label,
  createdAt: new Date().toISOString(),
  fileCount: manifest.length,
  totalBytes: manifest.reduce((sum, item) => sum + item.bytes, 0),
  files: manifest,
};
fs.writeFileSync(path.join(candidateDir, 'manifest.json'), JSON.stringify(report, null, 2));
console.log(`Candidate build created at ${candidateDir}`);
console.log(`Files: ${report.fileCount}; bytes: ${report.totalBytes}; manifest: ${path.join(candidateDir, 'manifest.json')}`);
