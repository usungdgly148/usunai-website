import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const label = String(process.argv[2] || '').trim();
if (!label) {
  console.error('Usage: npm run candidate:verify -- <candidate-label>');
  process.exit(1);
}

const candidateDir = path.join(root, '.tmp', 'candidates', label);
const manifestPath = path.join(candidateDir, 'manifest.json');
if (!fs.existsSync(manifestPath)) {
  console.error(`Candidate manifest not found: ${manifestPath}`);
  process.exit(1);
}

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
const expectedCommit = process.env.GITHUB_SHA || execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
const errors = [];
if (manifest.sourceCommit !== expectedCommit) errors.push(`sourceCommit mismatch: ${manifest.sourceCommit} != ${expectedCommit}`);

const actualFiles = [];
const walk = (dir) => {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (fullPath !== manifestPath) actualFiles.push(fullPath);
  }
};
walk(candidateDir);

const actual = new Map(actualFiles.map((file) => {
  const relative = path.relative(candidateDir, file).replaceAll('\\', '/');
  return [relative, {
    bytes: fs.statSync(file).size,
    sha256: crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'),
  }];
}));
const listed = new Map((manifest.files || []).map((item) => [item.file, item]));

for (const [file, details] of actual) {
  const entry = listed.get(file);
  if (!entry) errors.push(`missing from manifest: ${file}`);
  else if (entry.bytes !== details.bytes || entry.sha256 !== details.sha256) errors.push(`checksum mismatch: ${file}`);
}
for (const file of listed.keys()) if (!actual.has(file)) errors.push(`manifest lists missing file: ${file}`);

const required = [
  'dist/index.html',
  'server/index.mjs',
  'server/plan-validity.mjs',
  'server/package.json',
  'server/package-lock.json',
  'deploy/usun.service',
  'deploy/usun.nginx.conf',
];
for (const file of required) if (!actual.has(file)) errors.push(`required payload missing: ${file}`);

const forbidden = /(^|\/)(\.env(?:\.|$)|.+\.(?:db|sqlite|sqlite3|pem|key|p12|pfx))$/i;
for (const file of actual.keys()) {
  if (forbidden.test(file)) errors.push(`forbidden runtime or secret file: ${file}`);
  if (!/^(dist|server|deploy)\//.test(file)) errors.push(`unexpected candidate path: ${file}`);
}

const totalBytes = [...actual.values()].reduce((sum, item) => sum + item.bytes, 0);
if (manifest.fileCount !== actual.size) errors.push(`fileCount mismatch: ${manifest.fileCount} != ${actual.size}`);
if (manifest.totalBytes !== totalBytes) errors.push(`totalBytes mismatch: ${manifest.totalBytes} != ${totalBytes}`);

if (errors.length) {
  console.error('Candidate verification failed:\n' + errors.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log(`Candidate verified: ${label}; files: ${actual.size}; bytes: ${totalBytes}; commit: ${expectedCommit}`);
