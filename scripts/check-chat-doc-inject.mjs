import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * 回归（纯单元、零网络）：对话文档附件的「上传落盘 → 解析 → 注入 prompt」链路。
 *
 * 守的是四件容易**悄悄**坏掉的事：
 *  ① 附件字节读得回来 —— 注入靠 `/api/blob/serve?key=uploads/…` → 本地文件这条路，
 *     key 的形态（中文名被压成下划线、尾部扩展名必须保住）一变，解析就会拿到错的内容；
 *  ② 注入块必须自带边界与编号 —— 「用户上传的文件 N：名字（格式）」+「文件内容结束」，
 *     少了它，多文件会串台、被截断的文件会被模型当成完整内容；
 *  ③ 文档必须先被剥离再交给各平台分支 —— DeepSeek 分支收到 kind='file' 会直接报
 *     「仅支持图片附件」，把一次正常提问变成报错；
 *  ④ 目录穿越仍然被挡着 —— key 是从 HTTP 请求体里来的，`uploads/../index.mjs` 必须读不到。
 *
 * ⚠️ 本脚本**不复制** index.mjs 的实现，而是把真实源码里的 `localUploadPathFromUrl` 与
 *    `resolveDocAttachments` 按大括号配平切出来现场执行 —— 测的就是将来要上线的那个函数。
 *    代价是：这两个函数一旦改名，本脚本会立刻报错要求同步，而不是静默测了个寂寞。
 *
 * 依赖：jszip（造真实 OOXML fixture）。缺失时解析类断言自动跳过并提示上服务器补跑。
 * 跑法：node scripts/check-chat-doc-inject.mjs
 */

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const SERVER_DIR = path.join(ROOT, 'server');
const INDEX_SRC = path.join(SERVER_DIR, 'index.mjs');
const DOC_EXTRACT = path.join(SERVER_DIR, 'doc-extract.mjs');

let pass = 0;
let fail = 0;
let skipped = 0;
async function check(label, run) {
  try {
    await run();
    pass += 1;
    console.log(`PASS  ${label}`);
  } catch (error) {
    fail += 1;
    console.log(`FAIL  ${label}\n      ${String(error?.message || error).split('\n').join('\n      ')}`);
  }
}
const skip = (label, why) => {
  skipped += 1;
  console.log(`SKIP  ${label}\n      ${why}`);
};

/* ---------------------- 从真实源码里切出待测函数 ---------------------- */

const source = fs.readFileSync(INDEX_SRC, 'utf8');

/** 按大括号配平切出以 marker 开头的那个函数（含 marker 本身）。 */
function extractFunction(marker) {
  const start = source.indexOf(marker);
  assert.ok(start >= 0, `server/index.mjs 里找不到「${marker}」—— 函数被改名/删除后请同步本脚本`);
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) { end = i; break; }
    }
  }
  assert.ok(end > 0, `「${marker}」的大括号不配平，抽取失败`);
  return source.slice(start, end + 1);
}

const limitLine = source.match(/const MAX_DOC_ATTACHMENTS = [^;]+;/);
assert.ok(limitLine, 'server/index.mjs 里找不到 MAX_DOC_ATTACHMENTS 常量声明');

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'usun-doc-inject-'));
const uploadsDir = path.join(workDir, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });

const resolverPath = path.join(workDir, '_resolver.mjs');
fs.writeFileSync(resolverPath, [
  "import fs from 'node:fs';",
  "import path from 'node:path';",
  `import { docExtOf, isSupportedDoc, docFormatLabel, extractDocumentText, buildDocPromptBlock, SUPPORTED_DOC_EXTS } from ${JSON.stringify(pathToFileURL(DOC_EXTRACT).href)};`,
  `const DATA_DIR = ${JSON.stringify(workDir)};`,
  limitLine[0],
  extractFunction('function localUploadPathFromUrl'),
  extractFunction('async function resolveDocAttachments'),
  'export { resolveDocAttachments };',
].join('\n'), 'utf8');

const { resolveDocAttachments } = await import(pathToFileURL(resolverPath).href);

/* ------------------------------- 依赖探测 ------------------------------- */

// 以 server/ 为基准解析，命中 server/node_modules（与线上同一份依赖树）
const serverRequire = createRequire(path.join(SERVER_DIR, 'index.mjs'));
let JSZip = null;
try { JSZip = serverRequire('jszip'); } catch { JSZip = null; }

/* -------------------------------- fixtures -------------------------------- */

/** URL 里那条 blob 路径（占位符与线上 upload-url 生成的 key 同形态：uploads/<ts>-<rand>-<safeName>） */
const blobUrl = (key) => `/api/blob/serve?key=${encodeURIComponent(key)}`;

/** 造一个真实 OOXML 结构的 docx（段落 + 一张 2 列的表）。 */
async function makeDocx() {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
<w:p><w:r><w:t>第一段正文 合同金额 12 万元</w:t></w:r></w:p>
<w:p><w:r><w:t>第二段正文 含 &amp; 符号</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>单元格A</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>单元格B</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
<w:p><w:r><w:t>末段正文</w:t></w:r></w:p>
</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

// 模拟线上 key：中文名被 replace(/[^\w.\-]+/g,'_') 压成下划线，但尾部扩展名保住
const docxKey = 'uploads/1700000000000-ab12cd-______.docx';
const txtKey = 'uploads/1700000000001-ef34gh-report.txt';

if (JSZip) {
  fs.writeFileSync(path.join(workDir, docxKey), await makeDocx());
} else {
  fs.writeFileSync(path.join(workDir, txtKey), '纯文本文档正文\n第二行', 'utf8');
}

/* ------------------------------ ① 正常注入 ------------------------------ */

if (JSZip) {
  await check('docx：注入块带文件名 / 格式 / 结束标记', async () => {
    const result = await resolveDocAttachments([
      { kind: 'file', name: '合同模板.docx', url: blobUrl(docxKey) },
    ]);
    assert.match(result.docBlock, /【用户上传的文件 1：合同模板\.docx（Word）】/);
    assert.match(result.docBlock, /第一段正文 合同金额 12 万元/);
    assert.match(result.docBlock, /末段正文/);
    assert.match(result.docBlock, /【文件内容结束】/);
    assert.equal(result.files.length, 1);
    assert.equal(result.files[0].ext, 'docx');
    assert.equal(result.files[0].truncated, false);
  });

  await check('docx：表格单元格保留制表符（否则一行表格会散成两行）', async () => {
    const result = await resolveDocAttachments([{ kind: 'file', name: '合同模板.docx', url: blobUrl(docxKey) }]);
    assert.ok(result.docBlock.includes('单元格A\t单元格B'), `实际未用制表符分隔：${JSON.stringify(result.docBlock)}`);
  });

  await check('docx：附件名缺省时能从 key 尾部取回扩展名', async () => {
    // 前端没给 name（或给了空串）时，扩展名只能从上传键里拿 —— 丢了就整条链路失效
    const result = await resolveDocAttachments([{ kind: 'file', url: blobUrl(docxKey) }]);
    assert.match(result.docBlock, /【用户上传的文件 1：/);
    assert.equal(result.files[0].ext, 'docx');
  });
} else {
  skip('docx 解析类断言', '本机 server/node_modules 里没有 jszip → 请上服务器补跑本脚本');
}

/* ---------------------- ② 文档与图片的分离 / 零副作用 ---------------------- */

await check('文档被剥离，图片原样留给平台分支', async () => {
  const attachments = [
    { kind: 'image', url: blobUrl('uploads/1700000000002-aa11bb-pic.png'), name: 'pic.png' },
    ...(JSZip ? [{ kind: 'file', name: '合同模板.docx', url: blobUrl(docxKey) }] : []),
    { kind: 'image', url: blobUrl('uploads/1700000000003-cc22dd-pic2.jpg'), name: 'pic2.jpg' },
  ];
  const result = await resolveDocAttachments(attachments);
  assert.equal(result.attachments.length, 2, '图片必须全部保留');
  assert.ok(result.attachments.every((item) => item.kind === 'image'), '剥离后不该再有 kind=file');
  assert.equal(result.docBlock.includes('pic.png'), false, '图片地址不能混进文档注入块');
});

await check('没有文档时：docBlock 为空且附件原样返回（存量行为零变化）', async () => {
  const images = [{ kind: 'image', url: blobUrl('uploads/1700000000004-ee55ff-pic.png'), name: 'a.png' }];
  for (const input of [images, [], undefined, null, 'not-an-array']) {
    const result = await resolveDocAttachments(input);
    assert.equal(result.docBlock, '', `输入 ${JSON.stringify(input)} 不该产出注入块`);
    assert.equal(result.files.length, 0);
  }
  const kept = await resolveDocAttachments(images);
  assert.equal(kept.attachments.length, 1, '图片必须原样返回');
});

/* ------------------------------ ③ 错误分支 ------------------------------ */

await check('非白名单格式 → 400 并点名格式', async () => {
  await assert.rejects(
    () => resolveDocAttachments([{ kind: 'file', name: '安装包.zip', url: blobUrl('uploads/1700000000005-gg66hh-a.zip') }]),
    (error) => error.statusCode === 400 && /暂不支持/.test(error.message) && /zip/.test(error.message),
  );
});

await check('文件不存在 → 400（不是 500、也不是静默吞掉）', async () => {
  await assert.rejects(
    () => resolveDocAttachments([{ kind: 'file', name: '合同.docx', url: blobUrl('uploads/1700000000006-ii77jj-missing.docx') }]),
    (error) => error.statusCode === 400,
  );
});

await check('目录穿越仍然读不到文件（key 来自请求体，是不可信输入）', async () => {
  for (const key of ['uploads/../index.mjs', '../index.mjs', 'uploads/../../etc/passwd.docx']) {
    await assert.rejects(
      () => resolveDocAttachments([{ kind: 'file', name: '合同.docx', url: blobUrl(key) }]),
      (error) => error.statusCode === 400,
      `key=${key} 必须被挡下`,
    );
  }
});

await check('超过单次文档上限 → 400', async () => {
  const many = Array.from({ length: 4 }, (_, i) => ({ kind: 'file', name: `a${i}.txt`, url: blobUrl(`uploads/170000000000${i}-kk88ll-a${i}.txt`) }));
  await assert.rejects(
    () => resolveDocAttachments(many),
    (error) => error.statusCode === 400 && /最多上传/.test(error.message),
  );
});

/* --------------------------- ④ data URL 兜底 --------------------------- */

await check('Blob 通道不可用时的 base64 兜底：txt 直接内联解析', async () => {
  const dataUrl = `data:application/octet-stream;base64,${Buffer.from('兜底正文 甲乙丙', 'utf8').toString('base64')}`;
  const result = await resolveDocAttachments([{ kind: 'file', name: '笔记.txt', url: dataUrl }]);
  assert.match(result.docBlock, /笔记\.txt（文本）/);
  assert.match(result.docBlock, /兜底正文 甲乙丙/);
});

await check('data URL 同样受白名单约束', async () => {
  const dataUrl = `data:application/zip;base64,${Buffer.from('PK', 'utf8').toString('base64')}`;
  await assert.rejects(
    () => resolveDocAttachments([{ kind: 'file', name: 'x.zip', url: dataUrl }]),
    (error) => error.statusCode === 400,
  );
});

/* ------------------------- ⑤ 多文件编号与截断提示 ------------------------- */

await check('多个文档各自编号，便于模型区分', async () => {
  const first = `data:text/plain;base64,${Buffer.from('第一份内容', 'utf8').toString('base64')}`;
  const second = `data:text/plain;base64,${Buffer.from('第二份内容', 'utf8').toString('base64')}`;
  const result = await resolveDocAttachments([
    { kind: 'file', name: '甲.txt', url: first },
    { kind: 'file', name: '乙.txt', url: second },
  ]);
  assert.match(result.docBlock, /【用户上传的文件 1：甲\.txt（文本）】/);
  assert.match(result.docBlock, /【用户上传的文件 2：乙\.txt（文本）】/);
  assert.equal(result.files.length, 2);
});

await check('超长文档被截断且显式告知模型（否则它会以为文件就这么短）', async () => {
  const longText = '长'.repeat(25000);
  const dataUrl = `data:text/plain;base64,${Buffer.from(longText, 'utf8').toString('base64')}`;
  const result = await resolveDocAttachments([{ kind: 'file', name: '长文.txt', url: dataUrl }]);
  assert.equal(result.files[0].truncated, true);
  assert.match(result.docBlock, /仅为前一部分/);
});

/* --------------------------------- 收尾 --------------------------------- */

/* ------------------- 端点响应契约（2026-09-18 线上真实事故） ------------------- */

// 事故：`/api/doc/upload` 原来平铺返回 `{ok, key, url, …}`，而小程序 `apiRequest` 取的是 `.data`
// ⇒ `uploaded.url` 恒为 undefined ⇒ 客户端报「上传失败」，但服务端其实已经 200 写盘成功。
// nginx 访问日志里一排 200、客户端却提示失败，排查方向一度被带偏到「请求没到服务端」。
// 这里对**源码文本**断言，防止有人再把它改回平铺形态。
const docUploadBlock = source.slice(
  source.indexOf("p === '/api/doc/upload'"),
  source.indexOf("'/api/blob/upload-url'"),
);

await check('上传端点用 successEnvelope 包裹返回值（小程序取的是 .data）', () => {
  assert.ok(docUploadBlock.length > 200, '抽取 /api/doc/upload 处理块失败 —— 路由被改名或挪走了，请同步本脚本');
  assert.ok(docUploadBlock.includes('successEnvelope('), '成功分支必须用 successEnvelope 包成 {ok, data, meta}');
});

await check('上传端点没有残留的平铺 {ok, …} 返回', () => {
  const flat = docUploadBlock.match(/JSON\.stringify\(\{\s*ok:/g) || [];
  assert.equal(flat.length, 0, `仍有 ${flat.length} 处平铺 JSON.stringify({ ok: … }) —— .data 会是 undefined`);
});

await check('上传端点的错误分支用 errorEnvelope（客户端读的是 error.message）', () => {
  const flatError = docUploadBlock.match(/error:\s*['"`]/g) || [];
  assert.equal(flatError.length, 0, `仍有 ${flatError.length} 处把 error 写成字符串；rawRequest 读的是 error.message，用户会看不到具体原因`);
  assert.ok(docUploadBlock.includes('errorEnvelope('), '错误分支必须用 errorEnvelope 产出 {code, message}');
});

try { fs.rmSync(workDir, { recursive: true, force: true }); } catch { /* 临时目录清理失败不影响结论 */ }

console.log(`\n合计：${pass} PASS / ${fail} FAIL${skipped ? ` / ${skipped} SKIP` : ''}`);
process.exit(fail ? 1 : 0);
