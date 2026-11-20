/**
 * DeepSeek 平台切换/保存契约守卫（2026-11-20 HTTP 500 事故）。
 *
 * 根因：后台从「外部中转站」切到「DeepSeek 原生模型」时只改 platform，不改 model；
 * 下拉框因 value 无匹配项仍显示 deepseek-flash，提交的却是 relay 遗留模型名，
 * 服务端白名单校验失败 → put-config 500。
 *
 * 守三件事：切换时模型归位 / 提交前前端校验 / 服务端校验失败回 400 且带原因。
 * 只读源码，不建浏览器、不跑构建。
 */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = process.cwd();
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let pass = 0;
const fails = [];
const ok = (name, cond, detail = '') => {
  if (cond) { pass += 1; console.log('  ✓', name); return; }
  fails.push(`${name}${detail ? ' — ' + detail : ''}`);
  console.log('  ✗', name, detail);
};

const EDIT = 'frontend/src/pages/AdminAgentEdit.jsx';
const STORE = 'frontend/src/store.jsx';
const SERVER = 'server/index.mjs';
const edit = read(EDIT);
const store = read(STORE);
const server = read(SERVER);

// ── 1. 切换平台时模型必须归位 ───────────────────────────────────────────────
ok('切到 DeepSeek 时把模型重置为在售默认模型',
  /key === 'deepseek-native' && form\.platform !== 'deepseek-native'\) patch\.model = DEEPSEEK_MODEL_DEFAULT/.test(edit));
ok('反向切到中转站仍清空模型（原行为保留）',
  /key === 'relay-native' && form\.platform !== 'relay-native'\) patch\.model = ''/.test(edit));

// ── 2. 前端白名单 / 别名与服务端逐值一致 ────────────────────────────────────
const frontModels = /const DEEPSEEK_MODEL_OPTIONS = \[([^\]]+)\]/.exec(edit);
const serverModels = /const DEEPSEEK_MODELS = new Set\(\[([^\]]+)\]\)/.exec(server);
const norm = (s) => (s || '').match(/'[^']+'/g)?.sort().join(',') || '';
ok('两端在售模型白名单逐值一致',
  Boolean(frontModels && serverModels) && norm(frontModels[1]) === norm(serverModels[1]),
  `${norm(frontModels && frontModels[1])} vs ${norm(serverModels && serverModels[1])}`);
ok('两端历史模型别名表逐值一致',
  ["'deepseek-v4-flash': 'deepseek-flash'", "'deepseek-v4-flash-vision-exp': 'deepseek-flash'"]
    .every((s) => edit.includes(s) && server.includes(s)));
ok('前端有 normalizeDeepseekModel 且被提交前校验调用',
  /function normalizeDeepseekModel\(/.test(edit) && /DEEPSEEK_MODEL_OPTIONS\.includes\(normalizeDeepseekModel\(form\.model\)\)/.test(edit));
ok('模型无效时前端直接提示，不再把 500 抛给主人', edit.includes('DeepSeek 模型无效，请重新选择模型'));
ok('DeepSeek select 的选项来自常量（不再硬编码两份）',
  /DEEPSEEK_MODEL_OPTIONS\.map\(m => <option key=\{m\}/.test(edit));

// ── 3. 服务端：校验失败回 400 + 原因 ───────────────────────────────────────
ok('put-config 定义 400 校验错误工厂', /const invalidConfig = \(msg\) => Object\.assign\(new Error\(msg\), \{ statusCode: 400 \}\)/.test(server));
const deepseekBlock = /if \(key === 'agents'\) \{[\s\S]*?\n        \}/.exec(server);
ok('DeepSeek 校验块存在', Boolean(deepseekBlock));
const block = deepseekBlock ? deepseekBlock[0] : '';
ok('四条 DeepSeek 校验全部改用 invalidConfig（不再走 500）',
  (block.match(/throw invalidConfig\(/g) || []).length === 4 && !/throw new Error\(`原生模型智能体/.test(block));
ok('catch 按 statusCode 区分 400 / 500', /res\.statusCode = invalid \? 400 : 500/.test(server));
ok('400 响应体回传具体原因', /msg: invalid \? e\.message/.test(server));
ok('500 仍打堆栈到 journal（保留可排查性）', /if \(!invalid\) console\.error\('\[put-config\] CRASH/.test(server));

// ── 4. 前台把服务端原因显示出来 ────────────────────────────────────────────
const persistFn = /const persistAdminKey = useCallback\(async \(key, value\) => \{[\s\S]*?\n  \}, \[\]\);/.exec(store);
ok('persistAdminKey 失败时解析服务端 msg', Boolean(persistFn)
  && /await r\.json\(\)/.test(persistFn[0]) && /'：' \+ e\.msg/.test(persistFn[0]));
ok('错误文案仍保留 HTTP 状态码前缀', Boolean(persistFn) && /'HTTP ' \+ r\.status \+ detail/.test(persistFn[0]));

console.log(`\n===== ${pass} 通过 / ${fails.length} 失败 =====`);
if (fails.length) {
  console.error('\n失败项：\n' + fails.map((f) => ' - ' + f).join('\n'));
  process.exit(1);
}
