import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
const required = [
  ['scripts/build-candidate.mjs', [
    "'server/index.mjs'",
    "'server/package-lock.json'",
    "'deploy/usun.service'",
    "payload: ['dist/', 'server/', 'deploy/']",
    'sourceCommit:',
    'walk(candidateDir)',
    'path.relative(candidateDir, file)',
    'Candidate builds require a clean tracked worktree',
  ]],
  ['.github/workflows/ci.yml', [
    'workflow_dispatch:',
    'Build isolated full-stack candidate',
    'Verify isolated full-stack candidate',
    'Audit production frontend dependencies',
    'actions/upload-artifact@v7',
    'if-no-files-found: error',
    'retention-days: 14',
  ]],
  ['scripts/verify-candidate.mjs', [
    'sourceCommit mismatch',
    'checksum mismatch',
    'forbidden runtime or secret file',
    'required payload missing',
  ]],
  ['docs/DEPLOYMENT.md', [
    'GitHub Actions 不连接生产服务器',
    '必须取得明确的生产部署确认',
  ]],
  ['docs/ROLLBACK.md', [
    '不要通过 Git 回滚数据库',
    '只恢复本次发布实际覆盖的文件',
  ]],
  ['docs/STAGE_E_RELEASE_READINESS.md', [
    '真实设备验收',
    '真实第三方服务验收',
    '生产部署授权',
  ]],
];

const missing = [];
for (const [file, needles] of required) {
  const source = read(file);
  for (const needle of needles) {
    if (!source.includes(needle)) missing.push(`${file}: ${needle}`);
  }
}

const workflow = read('.github/workflows/ci.yml');
for (const forbidden of ['appleboy/ssh-action', 'scp-action', '/opt/usun']) {
  if (workflow.includes(forbidden)) missing.push(`.github/workflows/ci.yml must not deploy: ${forbidden}`);
}

if (missing.length) {
  console.error('Stage E release-readiness contract check failed:\n' + missing.map((item) => `- ${item}`).join('\n'));
  process.exit(1);
}

console.log('Stage E candidate packaging, artifact, and no-production-deploy contract check passed.');
