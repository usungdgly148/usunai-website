import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const environment = process.argv[2] || 'production';
if (!['development', 'experience', 'production'].includes(environment)) {
  throw new Error(`Expected development, experience, or production; received ${environment}`);
}

const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'miniapp/package.json'), 'utf8'));
const gitResult = spawnSync('git', ['rev-parse', '--short=12', 'HEAD'], { cwd: root, encoding: 'utf8' });
const build = gitResult.status === 0 ? gitResult.stdout.trim() : 'local';
const apiBase = process.env.MINIAPP_API_BASE || (environment === 'development' ? 'http://127.0.0.1:8787' : 'https://www.usunai.top');
if (environment !== 'development' && !apiBase.startsWith('https://')) {
  throw new Error(`${environment} releases require HTTPS`);
}

const npmCli = process.env.npm_execpath;
const command = npmCli ? process.execPath : (process.platform === 'win32' ? 'npm.cmd' : 'npm');
const args = npmCli
  ? [npmCli, 'run', 'build:weapp', '--prefix', 'miniapp']
  : ['run', 'build:weapp', '--prefix', 'miniapp'];
const result = spawnSync(command, args, {
  cwd: root,
  stdio: 'inherit',
  shell: !npmCli && process.platform === 'win32',
  env: {
    ...process.env,
    NODE_ENV: environment === 'development' ? 'development' : 'production',
    MINIAPP_ENV: environment,
    MINIAPP_API_BASE: apiBase,
    MINIAPP_VERSION: packageJson.version,
    MINIAPP_BUILD: build,
  },
});
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

const distDir = path.join(root, 'miniapp/dist');
if (!fs.existsSync(distDir)) throw new Error('Miniapp build did not create miniapp/dist');

const manifest = {
  environment,
  version: packageJson.version,
  build,
  apiBase,
  builtAt: new Date().toISOString(),
};
fs.writeFileSync(path.join(distDir, 'release-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`miniapp ${environment} release built: ${packageJson.version} (${build})`);
