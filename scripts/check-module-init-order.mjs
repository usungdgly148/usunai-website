// 模块顶层「初始化顺序」守卫（TDZ 静态检查）。
//
// 为什么需要它：ES 模块顶层的 `const`/`let`/`class` 存在暂时性死区（TDZ）。
// 若某个顶层声明的**初始化表达式在创建时就求值**，并且引用了**声明更靠后**的同级 const，
// 运行时就会抛 `ReferenceError: Cannot access 'X' before initialization`。
// 这类错误**语法完全合法** —— `node --check`、eslint 基础规则、构建全部通过，
// 只有真正把进程拉起来才会炸（2026-10-16 就是这样把线上服务打挂的）。
//
// 判定口径（有意保守，宁可漏报不误报）：
//   取每个顶层 `const/let/class NAME = <初始化式>` 的初始化文本；
//   若其中**不含** `function` / `=>` / `async` 关键字 ⇒ 该表达式内的标识符是**立即求值**的；
//   此时凡是引用了「在本声明之后才声明的同级 const/let/class」的标识符 ⇒ 记为违规。
//   含函数关键字的初始化式一律跳过（函数体是延迟执行的，属正常前向引用）。
//
// 用法：node scripts/check-module-init-order.mjs [目录或文件…]   默认扫 server/

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

// 默认扫描目标一律**按脚本自身位置**推导仓库根，不依赖 process.cwd()。
// ⚠️ 否则从别的目录调用时会「一个文件都没扫到」却打印 PASS —— 静默空跑的守卫比没有守卫更坏。
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const TOKEN_RE = /[A-Za-z_$][\w$]*/g;

// 把字符串/模板串的内容与注释换成等长空格（不改变长度与换行），
// 避免把字符串里的词误当成标识符 —— 典型误报：'usun.db' 里的 `db`。
function stripLiterals(text) {
  let out = '';
  let i = 0;
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (ch === '/' && text[i + 1] === '/') {
      while (i < n && text[i] !== '\n') { out += ' '; i += 1; }
      continue;
    }
    if (ch === '/' && text[i + 1] === '*') {
      out += '  '; i += 2;
      while (i < n && !(text[i] === '*' && text[i + 1] === '/')) { out += text[i] === '\n' ? '\n' : ' '; i += 1; }
      out += '  '; i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const q = ch;
      out += q; i += 1;
      while (i < n) {
        if (text[i] === '\\') { out += '  '; i += 2; continue; }
        if (text[i] === q) { out += q; i += 1; break; }
        out += text[i] === '\n' ? '\n' : ' ';
        i += 1;
      }
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

// 扫描器：跳过字符串 / 模板串 / 注释，并跟踪括号深度，用来切出「一条顶层声明」。
function scanTopLevelDeclarations(src) {
  const decls = [];
  let i = 0;
  const n = src.length;
  let depth = 0;            // (){}[] 总深度
  let line = 1;

  const bumpLine = (ch) => { if (ch === '\n') line += 1; };

  while (i < n) {
    const ch = src[i];

    // 行注释
    if (ch === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i += 1;
      continue;
    }
    // 块注释
    if (ch === '/' && src[i + 1] === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) { bumpLine(src[i]); i += 1; }
      i += 2;
      continue;
    }
    // 字符串 / 模板串（模板串里的 ${} 简化处理为整体跳过，可能漏报，可接受）
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      i += 1;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i += 1; break; }
        bumpLine(src[i]);
        i += 1;
      }
      continue;
    }

    // 只有在深度 0 且位于行首（允许缩进）时，才可能是「顶层声明」
    if (depth === 0) {
      const atLineStart = i === 0 || src[i - 1] === '\n';
      if (atLineStart) {
        const m = /^[ \t]*(?:export\s+)?(const|let|class)\s+([A-Za-z_$][\w$]*)/.exec(src.slice(i, i + 200));
        if (m) {
          const kind = m[1];
          const name = m[2];
          let j = i + m[0].length;
          let d = 0;
          let seenEq = false;
          // 切到这条语句的结尾（深度 0 的 `;`）或下一个顶层声明之前
          while (j < n) {
            const c = src[j];
            if (c === '/' && src[j + 1] === '/') { while (j < n && src[j] !== '\n') j += 1; continue; }
            if (c === '/' && src[j + 1] === '*') {
              j += 2;
              while (j < n && !(src[j] === '*' && src[j + 1] === '/')) j += 1;
              j += 2;
              continue;
            }
            if (c === '"' || c === "'" || c === '`') {
              const q = c; j += 1;
              while (j < n) { if (src[j] === '\\') { j += 2; continue; } if (src[j] === q) { j += 1; break; } j += 1; }
              continue;
            }
            if (c === '=' && d === 0 && !seenEq && src[j + 1] !== '=' && src[j - 1] !== '=') seenEq = true;
            if ('([{'.includes(c)) d += 1;
            else if (')]}'.includes(c)) d -= 1;
            else if (c === ';' && d === 0) break;
            else if (c === '\n' && d === 0 && seenEq && /^[ \t]*(?:export\s+)?(?:const|let|var|class|function|async|import|export|\/\/|\/\*)/.test(src.slice(j + 1, j + 220))) {
              break;
            }
            j += 1;
          }
          const initStart = src.indexOf('=', i);
          const raw = src.slice(initStart + 1, j);
          decls.push({ kind, name, line, raw, endIndex: j, startIndex: i });
          i = j;
          continue;
        }
      }
    }

    if ('([{'.includes(ch)) depth += 1;
    else if (')]}'.includes(ch)) depth = Math.max(0, depth - 1);
    bumpLine(ch);
    i += 1;
  }
  return decls;
}

function checkFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const decls = scanTopLevelDeclarations(src);
  const order = new Map();
  decls.forEach((d, idx) => { if (!order.has(d.name)) order.set(d.name, { idx, ...d }); });

  const findings = [];
  decls.forEach((d, idx) => {
    const init = d.raw;
    if (!init) return;
    // 先剥掉字符串与注释，再判断是否含函数 —— 只用真正的代码来判定
    const code = stripLiterals(init);
    // 含函数/箭头函数的初始化式 → 内部为延迟执行，跳过（保守）
    if (/\bfunction\b|=>|\basync\b/.test(code)) return;
    const seen = new Set();
    for (const m of code.matchAll(TOKEN_RE)) {
      const id = m[0];
      if (seen.has(id)) continue;
      seen.add(id);
      const target = order.get(id);
      if (!target) continue;
      if (target.idx <= idx) continue;            // 已声明过，正常
      findings.push({
        file, name: d.name, line: d.line,
        referenced: id, referencedLine: target.line,
        kind: target.kind,
        snippet: init.trim().replace(/\s+/g, ' ').slice(0, 120),
      });
    }
  });
  return { decls: decls.length, findings };
}

function collectTargets(args) {
  const roots = args.length
    ? args.map((a) => path.resolve(process.cwd(), a))
    : [path.join(REPO_ROOT, 'server')];
  const out = [];
  for (const abs of roots) {
    if (!fs.existsSync(abs)) {
      console.error(`[FAIL] 目标不存在：${abs}`);
      process.exit(1);
    }
    const st = fs.statSync(abs);
    if (st.isFile()) { out.push(abs); continue; }
    for (const name of fs.readdirSync(abs)) {
      if (!/\.m?js$/.test(name)) continue;
      out.push(path.join(abs, name));
    }
  }
  return out;
}

const files = collectTargets(process.argv.slice(2));
if (!files.length) {
  console.error('[FAIL] 没找到要检查的文件');
  process.exit(1);
}

let totalViolations = 0;
let totalDecls = 0;
for (const f of files) {
  const { decls, findings } = checkFile(f);
  totalDecls += decls;
  const rel = path.relative(REPO_ROOT, f).replace(/\\/g, '/');
  if (findings.length) {
    totalViolations += findings.length;
    for (const v of findings) {
      console.error(`[FAIL] ${rel}:${v.line}  顶层 ${v.kind} '${v.name}' 在初始化时引用了更晚声明的 '${v.referenced}'（第 ${v.referencedLine} 行）`);
      console.error(`       初始化式: ${v.snippet}`);
      console.error(`       → 启动即抛 ReferenceError: Cannot access '${v.referenced}' before initialization`);
    }
  }
}

console.log(`\n检查文件 ${files.length} 个 / 顶层声明 ${totalDecls} 条`);
if (totalViolations) {
  console.error(`[FAIL] 发现 ${totalViolations} 处「顶层初始化顺序」违规 —— 语法合法但启动会崩，必须修`);
  process.exit(1);
}
console.log('[PASS] 未发现顶层初始化顺序违规');
