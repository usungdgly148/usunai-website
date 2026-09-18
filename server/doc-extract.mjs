/**
 * 文档解析：把用户上传的文档转成纯文本，供对话注入（「路线 A」）。
 *
 * 支持：docx / xlsx / pptx / pdf / txt
 *
 * 设计要点：
 *  1. **依赖懒加载**（jszip / pdf-parse）：缺依赖时不影响服务启动，只在真正解析该类型时抛错；
 *  2. **依赖可注入**（第三参 `deps`）：单测无需安装任何包即可跑真实逻辑；
 *  3. **统一出口截断**：正文会直接进 prompt，不截断会烧掉大量算力，且可能撑爆上游上下文。
 *  4. 解析失败一律抛带 `code` 的 Error，调用方据此给用户可读提示（不要把上游原始报错甩给用户）。
 */

/** 注入对话的正文上限（字符）。超出部分截断，并在文末显式标注，避免模型以为文件就这么短。 */
export const DOC_TEXT_LIMIT = Number(process.env.DOC_TEXT_LIMIT || 20000);

/** 单文件字节上限：这里限制的是「要读进内存做解析」的大小，与上传通道的 25MB 无关。 */
export const DOC_SIZE_LIMIT = Number(process.env.DOC_SIZE_LIMIT || 8 * 1024 * 1024);

/** 允许解析的扩展名（对话附件白名单） */
export const SUPPORTED_DOC_EXTS = ['docx', 'xlsx', 'pptx', 'pdf', 'txt'];

const MIME_TO_EXT = {
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
};

/** 取扩展名；没有扩展名时退回 mime 推断。返回小写、不含点。 */
export function docExtOf(name = '', mimeType = '') {
  const clean = String(name || '').split(/[?#]/)[0];
  const matched = clean.match(/\.([a-zA-Z0-9]+)$/);
  if (matched) return matched[1].toLowerCase();
  return MIME_TO_EXT[String(mimeType || '').toLowerCase()] || '';
}

export function isSupportedDoc(name, mimeType) {
  return SUPPORTED_DOC_EXTS.includes(docExtOf(name, mimeType));
}

/** 中文名，用于提示语 */
export function docFormatLabel(ext) {
  return ({ docx: 'Word', xlsx: 'Excel', pptx: 'PPT', pdf: 'PDF', txt: '文本' })[ext] || ext.toUpperCase();
}

/** 去掉 XML 标签并解码实体。`&amp;` 必须最后处理，否则 `&amp;lt;` 会被二次解码成 `<`。 */
function stripTags(xml = '') {
  return decodeEntities(String(xml).replace(/<[^>]*>/g, ''));
}

function decodeEntities(text = '') {
  return String(text)
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .replace(/&amp;/g, '&');
}

/**
 * 压缩连续空白：保留换行与制表符结构，只收敛多余空格与三连换行。
 *
 * ⚠️ 这里**绝不能**把连续制表符收敛成空格：xlsx 靠 tab 补齐空列（`100\t\t\t备注` = A 列 100、D 列 备注），
 * 一旦被吞成单个空格，表格的列对齐信息就没了，模型会把「备注」当成 B 列。故只收敛连续**空格**。
 */
function tidy(text = '') {
  return String(text)
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n') // 行尾空白（含单元格补齐后多余的尾随 tab）
    .replace(/\n[ \t]+/g, '\n') // 行首空白（表格首列为空时补齐出的前导 tab，留着只会误导模型）
    .replace(/\n{3,}/g, '\n\n')
    .replace(/ {2,}/g, ' ')
    .trim();
}

/** Excel 列引用（A / B / AA）转 0 基列号；解析不出返回 -1。 */
function colIndexOf(ref = '') {
  const letters = String(ref).match(/^[A-Z]+/i);
  if (!letters) return -1;
  let n = 0;
  for (const ch of letters[0].toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

/* ---------------------------------- 各格式实现 ---------------------------------- */

/** docx：`word/document.xml` 里 `<w:p>` 是段落、`<w:t>` 是文本。 */
async function parseDocx(zip) {
  const entry = zip.file('word/document.xml');
  if (!entry) throw fail('DOC_INVALID', '该文件不是有效的 Word 文档（缺少正文）');
  let xml = await entry.async('string');
  xml = xml
    .replace(/<w:tab\b[^>]*\/>/g, '\t')
    .replace(/<w:br\b[^>]*\/>/g, '\n')
    // ⚠️ 表格结构必须在 `</w:p>` → 换行**之前**处理，且单元格内最后一个段落的收尾换行要先吃掉：
    //    否则单元格里的段落换行会插到制表符前面，输出成「单元格A\n\t单元格B」，一行表格散成两行。
    .replace(/<\/w:p>(?=\s*<\/w:tc>)/g, '')
    .replace(/<\/w:tc>/g, '\t') // 单元格边界 → 制表符，避免相邻单元格粘成一句
    .replace(/<\/w:tr>/g, '\n') // 表格行边界 → 换行
    .replace(/<\/w:p>/g, '\n');
  return tidy(stripTags(xml));
}

/** xlsx：共享字符串表 + 各 sheet 的行列；按 `r` 引用补齐空列，避免表格错位。 */
async function parseXlsx(zip) {
  const shared = [];
  const sharedEntry = zip.file('xl/sharedStrings.xml');
  if (sharedEntry) {
    const xml = await sharedEntry.async('string');
    for (const si of xml.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(stripTags(si[1]));
  }

  const sheetNames = Object.keys(zip.files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  if (!sheetNames.length) throw fail('DOC_INVALID', '该文件不是有效的 Excel 表格（缺少工作表）');

  const chunks = [];
  for (const sheetName of sheetNames) {
    const xml = await zip.file(sheetName).async('string');
    const lines = [];
    for (const row of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
      const cells = [];
      for (const cell of row[1].matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
        const attrs = cell[1];
        const body = cell[2];
        const refMatch = attrs.match(/r="([A-Z]+\d+)"/i);
        const col = refMatch ? colIndexOf(refMatch[1]) : cells.length;
        const valueMatch = body.match(/<v>([\s\S]*?)<\/v>/);
        let value = valueMatch ? valueMatch[1] : stripTags(body);
        if (/t="s"/.test(attrs)) value = shared[Number(value)] ?? '';
        const at = col >= 0 ? col : cells.length;
        while (cells.length < at) cells.push('');
        cells[at] = tidy(value).replace(/\n/g, ' ');
      }
      const line = cells.join('\t').replace(/\t+$/, '');
      if (line.trim()) lines.push(line);
    }
    if (lines.length) chunks.push(sheetNames.length > 1 ? `【工作表 ${sheetName.match(/(\d+)/)[1]}】\n${lines.join('\n')}` : lines.join('\n'));
  }
  return tidy(chunks.join('\n\n'));
}

/** pptx：每页 `ppt/slides/slideN.xml`，`<a:t>` 为文本框内容。 */
async function parsePptx(zip) {
  const slideNames = Object.keys(zip.files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort((a, b) => Number(a.match(/(\d+)/)[1]) - Number(b.match(/(\d+)/)[1]));
  if (!slideNames.length) throw fail('DOC_INVALID', '该文件不是有效的 PPT（缺少幻灯片）');

  const slides = [];
  for (const [index, name] of slideNames.entries()) {
    const xml = await zip.file(name).async('string');
    const text = tidy(stripTags(xml.replace(/<\/a:p>/g, '\n')));
    if (text) slides.push(`【第 ${index + 1} 页】\n${text}`);
  }
  return tidy(slides.join('\n\n'));
}

/** pdf：交给 pdf-parse（内部基于 pdfjs）。 */
async function parsePdf(buffer, loadPdfParse) {
  const { PDFParse } = await loadPdfParse();
  if (typeof PDFParse !== 'function') throw fail('DOC_ENGINE_MISSING', 'PDF 解析组件不可用');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    // pdf-parse 会在每页之间插入 `-- N of M --` 分页标记，进 prompt 是纯噪音，剔除。
    // 行锚定 + 要求两侧带 `--`，正文里几乎不可能天然出现这种行。
    const text = String(result?.text || '').replace(/^--\s*\d+\s+of\s+\d+\s*--$/gm, '');
    return tidy(text);
  } finally {
    // v2 的实例持有 pdfjs 资源，能释放就释放，避免大文件反复解析时堆积
    if (typeof parser.destroy === 'function') await parser.destroy().catch(() => {});
  }
}

/* ---------------------------------- 统一出口 ---------------------------------- */

/**
 * 解析文档为纯文本。
 * @param {Buffer|Uint8Array} buffer 文件内容
 * @param {{ name?: string, mimeType?: string, maxChars?: number }} options
 * @param {{ loadZip?: Function, loadPdfParse?: Function }} deps 单测注入点
 * @returns {Promise<{ text: string, ext: string, chars: number, truncated: boolean }>}
 */
export async function extractDocumentText(buffer, options = {}, deps = {}) {
  const { name = '', mimeType = '', maxChars = DOC_TEXT_LIMIT } = options;
  const ext = docExtOf(name, mimeType);
  if (!SUPPORTED_DOC_EXTS.includes(ext)) {
    throw fail('DOC_UNSUPPORTED', `暂不支持该文件格式${ext ? `（.${ext}）` : ''}`);
  }

  const size = Number(buffer?.length || 0);
  if (!size) throw fail('DOC_EMPTY', '文件内容为空');
  if (size > DOC_SIZE_LIMIT) {
    throw fail('DOC_TOO_LARGE', `文件过大（上限 ${Math.round(DOC_SIZE_LIMIT / 1024 / 1024)}MB）`);
  }

  let text = '';
  if (ext === 'txt') {
    text = tidy(Buffer.from(buffer).toString('utf8'));
  } else if (ext === 'pdf') {
    const loadPdfParse = deps.loadPdfParse || (async () => import('pdf-parse'));
    text = await parsePdf(Buffer.from(buffer), loadPdfParse);
  } else {
    const loadZip = deps.loadZip || (async () => (await import('jszip')).default);
    const JSZip = await loadZip();
    let zip;
    try {
      zip = await JSZip.loadAsync(buffer);
    } catch {
      throw fail('DOC_INVALID', '文件已损坏或不是有效的 Office 文档');
    }
    if (ext === 'docx') text = await parseDocx(zip);
    else if (ext === 'xlsx') text = await parseXlsx(zip);
    else text = await parsePptx(zip);
  }

  if (!text) throw fail('DOC_NO_TEXT', '未能从该文件中提取到文字（可能是扫描件或纯图片文档）');

  const truncated = text.length > maxChars;
  return {
    text: truncated ? text.slice(0, maxChars) : text,
    ext,
    chars: text.length,
    truncated,
  };
}

/** 把解析结果拼成注入 prompt 的一段。 */
export function buildDocPromptBlock({ fileName, ext, text, truncated }, index = 0) {
  const label = docFormatLabel(ext);
  const tail = truncated ? '\n\n（注：文件内容较长，以上仅为前一部分。）' : '';
  return `【用户上传的文件 ${index + 1}：${fileName}（${label}）】\n${text}${tail}\n【文件内容结束】`;
}
