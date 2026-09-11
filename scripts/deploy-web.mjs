#!/usr/bin/env node
/**
 * 把 `frontend/dist` 部署到生产服务器（usunai.top 的 Nginx 静态根 `/opt/usun/dist`）。
 *
 * 为什么要有这个脚本：仓库里 `candidate:build` / `candidate:verify` 只负责「做候选包并校验」，
 * 没有「推上服务器」这一步，以前全靠手工 ssh + tar。手工最容易出两类事：
 *   ① 传了半份产物（旧 assets 没清干净，新旧 hash 混在一起）；
 *   ② 传坏了不知道（只有 HTTP 200 是看不出来的 —— 200 只说明文件在，不说明是**这份**内容）。
 *
 * 流程（每一步失败即中止，且**不动线上文件**直到第 4 步）：
 *   1. 打包   `frontend/dist` → `tmp/web-dist.tar.gz`（相对路径！见下面第一条坑）
 *   2. 上传   scp 到 `/tmp/usun-web-dist.tar.gz`，并在远端列一次大小
 *   3. 暂存   解压到 `/opt/usun/dist.new` 并自检（期望文件从本地 index.html 动态解析）
 *   4. 替换   旧 `assets`/`index.html` 全部 `mv` 成 `*.bak_<TS>`，再 `mv` 新文件就位
 *   5. 校验   服务器磁盘上的产物 vs 本地 dist **全量 md5**（绕开 HTTP 层）
 *
 * 用法：
 *   node scripts/deploy-web.mjs                 # 正常部署
 *   node scripts/deploy-web.mjs --dry-run       # 只打包 + 上传 + 暂存自检，不替换线上
 *
 * 回滚：脚本结束会打印回滚命令（把 `assets.bak_<TS>` mv 回去即可）。
 *
 * ---- 踩过的坑（别改回去）----
 * 1. **不要给 tar 传 `E:/...` 这类盘符绝对路径**：GNU tar 会把 `E:` 当远程主机名
 *    （`Cannot connect to E: resolve failed`）。一律在仓库根目录下用相对路径。
 * 2. **bsdtar 在 Windows 上输出 CRLF**：`tar -tzf` 的条目末尾带 `\r`，
 *    不 trim 就会把 `./index.html\r` 判成「包不完整」。
 * 3. **别用本机 `curl %{size_download}` 判断线上产物对不对**：本机走 HTTP 代理时
 *    （响应头里能看到 `HTTP/1.1 200 Connection Established`）这个数会因为传输层压缩而失真
 *    （曾出现本地 563478 / 线上 12078，看着像坏了其实完全正常）。
 *    真正可信的是第 5 步的**服务器侧 md5**。
 * 4. 旧文件一律 `mv` 成备份，**不用 `rm`** —— 出问题要能一步回滚。
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

const root = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const argOf = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

const HOST = argOf('--host', 'ubuntu@106.53.17.138');
const KEY = argOf('--key', path.join(os.homedir(), '.ssh', 'usun_deploy'));
const REMOTE_DIR = argOf('--remote-dir', '/opt/usun/dist');
const REMOTE_PKG = '/tmp/usun-web-dist.tar.gz';
const LOCAL_PKG_REL = 'tmp/web-dist.tar.gz';
const LOCAL_PKG = path.join(root, LOCAL_PKG_REL);
const DIST = path.join(root, 'frontend', 'dist');

const run = (cmd, argv, opts = {}) => {
  const r = spawnSync(cmd, argv, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts });
  return { code: r.status, out: (r.stdout || '').trim(), err: (r.stderr || '').trim() };
};
const ssh = (script) =>
  run('ssh', ['-i', KEY, '-o', 'StrictHostKeyChecking=no', '-o', 'ConnectTimeout=20', HOST, script]);
const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const die = (msg) => { console.error('\n❌ ' + msg); process.exit(1); };

/* ---------------------------------------------------------------- 0. 前置检查 */
console.log('=== 0. 前置检查 ===');
if (!fs.existsSync(DIST)) die(`找不到构建产物 ${DIST}\n   先在 frontend/ 执行：npx vite build`);
if (!fs.existsSync(KEY)) die(`找不到 SSH 私钥 ${KEY}`);

const localIndexRel = 'index.html';
if (!fs.existsSync(path.join(DIST, localIndexRel))) die(`${DIST}/index.html 不存在，产物不完整`);

// 本地 index.html 里引用的 hash 产物 = 本次必须上线的文件（动态解析，不写死 hash）
const localIndexHtml = fs.readFileSync(path.join(DIST, localIndexRel), 'utf8');
const expected = [...new Set((localIndexHtml.match(/assets\/[A-Za-z]*-[A-Za-z0-9_-]+\.(js|css)/g) || []))];
if (expected.length === 0) die('index.html 里没解析到任何 assets 引用，产物可能不对');
console.log(`  产物目录   ${path.relative(root, DIST)}`);
console.log(`  入口引用   ${expected.join('  ')}`);

const dirty = run('git', ['status', '--porcelain', '--untracked-files=no']).out;
if (dirty) console.log('  ⚠️ 工作区有未提交改动（本次部署的产物可能不对应任何 commit）');

/* ---------------------------------------------------------------- 1. 打包 */
console.log('\n=== 1. 打包 ===');
fs.mkdirSync(path.dirname(LOCAL_PKG), { recursive: true });
const tar = run('tar', ['-czf', LOCAL_PKG_REL, '-C', 'frontend/dist', '.']);
if (tar.code !== 0) die('打包失败：' + tar.err);
const listing = run('tar', ['-tzf', LOCAL_PKG_REL]);
const entries = listing.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const size = fs.statSync(LOCAL_PKG).size;
console.log(`  ${LOCAL_PKG_REL}  ${(size / 1024).toFixed(1)}KB  ${entries.length} 个条目`);
for (const f of expected) {
  if (!entries.includes('./' + f)) die(`包里缺少入口引用的 ${f} —— 构建产物与 index.html 不匹配`);
}
console.log('  ✅ 入口引用的文件都在包里');

/* ---------------------------------------------------------------- 2. 上传 */
console.log('\n=== 2. 上传 ===');
const scp = run('scp', ['-i', KEY, '-o', 'StrictHostKeyChecking=no', LOCAL_PKG_REL, `${HOST}:${REMOTE_PKG}`]);
if (scp.code !== 0) die('scp 失败：' + scp.err);
const up = ssh(`wc -c < ${REMOTE_PKG}`);
if (Number(up.out) !== size) die(`远端大小 ${up.out} ≠ 本地 ${size}，上传不完整`);
console.log(`  ✅ ${HOST}:${REMOTE_PKG}  ${up.out} 字节`);

/* ---------------------------------------------------------------- 3. 暂存自检 */
console.log('\n=== 3. 解压到 .new 并自检（线上文件未动）===');
const checkLines = expected.map((f) => `[ -f ${REMOTE_DIR}.new/${f} ] && echo "OK ${f}" || echo "MISS ${f}"`);
const stage = ssh(
  [
    'set -e',
    'rm -rf ' + REMOTE_DIR + '.new',
    'mkdir -p ' + REMOTE_DIR + '.new',
    `tar -xzf ${REMOTE_PKG} -C ${REMOTE_DIR}.new`,
    ...checkLines,
    'echo "FILES=$(find ' + REMOTE_DIR + '.new -type f | wc -l)"',
  ].join('\n'),
);
console.log(stage.out.split(/\r?\n/).map((l) => '  ' + l).join('\n'));
if (stage.code !== 0 || /MISS /.test(stage.out)) die('暂存校验未通过 —— 线上文件保持原样');

if (dryRun) {
  console.log('\n[dry-run] 到此为止，未替换线上文件。');
  process.exit(0);
}

/* ---------------------------------------------------------------- 4. 原子替换 */
console.log('\n=== 4. 原子替换 ===');
const swap = ssh(
  [
    'set -e',
    `cd ${REMOTE_DIR}`,
    'TS=$(date -u +%Y%m%d_%H%M%S)',
    'if [ -d assets ]; then mv assets assets.bak_$TS; echo "assets -> assets.bak_$TS"; fi',
    'if [ -f index.html ]; then mv index.html index.html.bak_$TS; echo "index.html -> index.html.bak_$TS"; fi',
    `mv ${REMOTE_DIR}.new/assets ./assets`,
    `mv ${REMOTE_DIR}.new/index.html ./index.html`,
    `rmdir ${REMOTE_DIR}.new`,
    'echo "TS=$TS"',
  ].join('\n'),
);
console.log(swap.out.split(/\r?\n/).map((l) => '  ' + l).join('\n'));
if (swap.code !== 0) die('替换失败 —— 备份仍在 ' + REMOTE_DIR + '，可手工 mv 回滚');
const ts = (swap.out.match(/TS=(\S+)/) || [])[1] || '<TS>';

/* ---------------------------------------------------------------- 5. 全量 md5 校验 */
console.log('\n=== 5. 服务器磁盘 vs 本地 dist（全量 md5）===');
const localMap = new Map();
(function walk(dir, rel) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) walk(full, r);
    else localMap.set(r, md5(fs.readFileSync(full)));
  }
})(DIST, '');

const remoteList = ssh(`cd ${REMOTE_DIR} && find . -type f | sort | xargs md5sum`);
const remoteMap = new Map();
for (const line of remoteList.out.split(/\r?\n/)) {
  const i = line.indexOf('  ');
  if (i < 0) continue;
  const f = line.slice(i + 2).replace(/^\.\//, '').replace(/^\*/, '');
  if (/\.bak_/.test(f)) continue;
  remoteMap.set(f, line.slice(0, i));
}

const missing = [...localMap.keys()].filter((k) => !remoteMap.has(k));
const differing = [...localMap.keys()].filter((k) => remoteMap.has(k) && remoteMap.get(k) !== localMap.get(k));
const extra = [...remoteMap.keys()].filter((k) => !localMap.has(k));
console.log(`  本地 ${localMap.size} 个 / 线上 ${remoteMap.size} 个（不含 .bak）`);
missing.forEach((f) => console.log(`  ❌ 缺失 ${f}`));
differing.forEach((f) => console.log(`  ❌ 不同 ${f}`));
extra.forEach((f) => console.log(`  ⚠️ 线上多出 ${f}`));

const ok = missing.length === 0 && differing.length === 0;
console.log('');
console.log(ok ? `🎉 部署成功：线上产物与本地构建逐字节一致（${localMap.size} 个文件）` : '⚠️ 存在差异，见上');
console.log('');
console.log('回滚命令（如需）：');
console.log(`  ssh -i ${KEY} ${HOST} "cd ${REMOTE_DIR} && mv assets assets.broken_${ts} && mv assets.bak_${ts} assets && mv index.html index.html.broken_${ts} && mv index.html.bak_${ts} index.html"`);
process.exit(ok ? 0 : 1);
