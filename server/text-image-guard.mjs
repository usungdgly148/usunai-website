// 「文字排版图」识别 —— 生图结果的最后一道内容校验。
//
// 线上故障（2026-11-13，用户报「提示词被叠加渲染到图片上」）：
//   用户在「AI全能设计」用**分节结构**的提示词生图（【构图与空间】…【光影与气氛】…【人物与细节】…【色彩与色调】），
//   上游 gemini-nano-banana-2.1 没有画场景，而是把**整段提示词当成要排版的内容**，
//   输出了一张「深灰底 + 浅色正文」的图文文档图；服务端对上游字节不做任何内容判定、原样落盘，
//   小程序 <Image> 原样展示 ⇒ 用户看到的现象就像「提示词被叠到图上」。
//
// 实测复现（同一授权 / 同一比例 16:9 / 1K，各跑一次）：
//   · 分节长提示词（599 字）→ 稳定返回文字排版图；
//   · 「一只橘猫趴在窗台上晒太阳」→ 正常出图。
//   ⇒ 触发条件是**提示词结构**（分节文档形态），不是渲染器、也不是取图逻辑。
//   图内文字还会被模型「润色」增删（实测多出「画面采用」「一个」「暗部细节丰富」「宽画幅」），
//   长段落甚至乱码（用户那张里出现「曾面正细和若有若无的白烟」）—— 这是 AI 绘制文本的典型特征。
//
// 本模块只做两件事，且**都是纯函数**（不碰网络、不碰文件、不依赖 sharp）：
//   ① wantsTextInImage()        —— 用户 prompt 里是否**本来就想要字**（海报/标题/书法…）。
//                                  命中就完全跳过重试：否则「咖啡店开业海报」这种正确结果会被
//                                  误重试成一张没有标题的空海报，比原问题更糟。
//   ② looksLikeTextDocumentImage() —— 判定「整张图是不是一页文字排版」。
//
// 判定特征来自真实样本（256×256 采样、4bit/通道量化）实测：
//   样本                        colors  edge   flat  textRow
//   文字排版图（用户那张）            94   0.371  0.203   0.62
//   文字排版图（复现图）              81   0.400  0.238   0.63
//   文字叠在大殿背景上（第三种变体）    110   0.385  0.051   0.61   ← flat 很低，不能用它当判据
//   相机爆炸图（含中文标注）          305   0.162  0.023   0.84   ← 有字但不是文档，必须放过
//   雨夜人像                       721   0.091  0.047   0.61
//   早前正常图                      194   0.023  0.246   0.11
// ⇒ 只有「用色种类」+「边缘密度」这一对能把三个文字图与三个正常图**同时**分开；
//   flatRowRatio 看似直观，但文字叠背景那种变体几乎没有空白行（0.051），用了就会漏判，
//   所以它只记录进 metrics 便于排查，**不参与判定**。

/** 采样尺寸：固定方形采样，让阈值与图片原始宽高比无关。 */
export const TEXT_IMAGE_SAMPLE_SIZE = 256;

/** 量化到 4bit/通道（4096 个色桶）后，不同颜色种类的上限。文字图实测 ≤110，正常图最低 194。 */
export const TEXT_IMAGE_MAX_COLORS = 140;

/** 相邻像素灰度跳变 > 32 的比例（横 + 纵）。文字笔画密集，实测文字图 ≥0.37，正常图 ≤0.16。 */
export const TEXT_IMAGE_MIN_EDGE = 0.22;

/**
 * 用户是否**明确要求画面里出现文字**。
 *
 * 命中就跳过文字图重试 —— 这是本机制的安全阀：
 * 海报 / 标题 / 书法 / 招牌这类需求，输出本来就应该有字，重试反而会毁掉正确结果。
 * 宁可放过（用户偶尔仍会看到文字图），也不能把海报改成空海报。
 */
const WANTS_TEXT_RE = /海报|宣传图|封面|主视觉|banner|文字|标题|字体|排版|文案|标语|招牌|题字|书法|春联|对联|字样|写着|写上|印有|标注|水印|logo|slogan|kv/i;

export function wantsTextInImage(prompt) {
  return WANTS_TEXT_RE.test(String(prompt || ''));
}

/**
 * 重试时追加的输出约束。
 *
 * 只在**已经判定为文字排版图之后**才拼上，所以不会影响任何正常请求，
 * 更不会干扰「用户本来就要海报」的场景（那种情况压根不会走到重试）。
 */
export const TEXT_IMAGE_RETRY_HINT = '\n\n【输出要求·必须遵守】只输出画面本体（一张完整的摄影画面/绘画/设计成图）：'
  + '画面内不要渲染任何文字、标题、段落、编号、说明、标注，也不要做文档式排版。'
  + '上面分节写的「构图/光影/人物/色彩」等条目，是用来帮你理解画面的描述，'
  + '请把它们转化成视觉元素，不要把这些字本身写进画面。';

/**
 * 纯计算：输入 RGBA/RGB 原始像素，输出特征值与判定。
 *
 * @param {{ width: number, height: number, rgb: Uint8Array|Buffer }} input
 *        `rgb` 必须是**去 alpha 的连续 RGB**（3 字节/像素），即 sharp 的 `.removeAlpha().raw()`。
 * @returns {{ suspected: boolean, metrics: { colors: number, edgeSum: number, flatRowRatio: number, dominantRatio: number, pixels: number } }}
 */
export function analyzeTextDocumentPixels({ width, height, rgb } = {}) {
  const w = Math.max(1, Math.floor(Number(width) || 0));
  const h = Math.max(1, Math.floor(Number(height) || 0));
  const pixels = w * h;
  const empty = { suspected: false, metrics: { colors: 0, edgeSum: 0, flatRowRatio: 0, dominantRatio: 0, pixels } };
  if (!rgb || rgb.length < pixels * 3) return empty;

  const gray = new Uint8Array(pixels);
  const buckets = new Map();
  for (let i = 0; i < pixels; i += 1) {
    const r = rgb[i * 3];
    const g = rgb[i * 3 + 1];
    const b = rgb[i * 3 + 2];
    gray[i] = (299 * r + 587 * g + 114 * b) / 1000;
    const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4);
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }

  let top = 0;
  for (const count of buckets.values()) if (count > top) top = count;

  // 边缘：横向相邻（字间/笔画内）+ 纵向相邻（行间）都算，两类合计更能区分「文字墙」与「照片」。
  let edges = 0;
  for (let y = 0; y < h; y += 1) {
    for (let x = 0; x < w; x += 1) {
      const i = y * w + x;
      if (x + 1 < w && Math.abs(gray[i] - gray[i + 1]) > 32) edges += 1;
      if (y + 1 < h && Math.abs(gray[i] - gray[i + w]) > 32) edges += 1;
    }
  }

  let flatRows = 0;
  for (let y = 0; y < h; y += 1) {
    let min = 255;
    let max = 0;
    for (let x = 0; x < w; x += 1) {
      const v = gray[y * w + x];
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min < 24) flatRows += 1;
  }

  const metrics = {
    colors: buckets.size,
    edgeSum: edges / pixels,
    flatRowRatio: flatRows / h,
    dominantRatio: top / pixels,
    pixels,
  };
  // 只认「用色极少 + 边缘极密」这一对特征（理由见文件头样本表）。
  // 宁可漏判也不能误判：漏判只是维持现状，误判会把用户要的图换掉（还多花一次上游费用）。
  const suspected = metrics.colors <= TEXT_IMAGE_MAX_COLORS
    && metrics.edgeSum >= TEXT_IMAGE_MIN_EDGE;
  return { suspected, metrics };
}

/**
 * 便捷封装：直接吃图片字节。sharp 用**动态** import，装不上/解码失败时一律返回「不疑似」——
 * 这条校验属于自愈增强，**任何异常都不能影响生图主流程**（宁可放过，不能把成功请求变成报错）。
 */
export async function looksLikeTextDocumentImage(buffer) {
  if (!buffer || !buffer.length) return { suspected: false, metrics: {} };
  let sharp;
  try {
    sharp = (await import('sharp')).default;
  } catch {
    return { suspected: false, metrics: {}, skipped: 'sharp-unavailable' };
  }
  try {
    const size = TEXT_IMAGE_SAMPLE_SIZE;
    const { data } = await sharp(buffer)
      .resize(size, size, { fit: 'fill' })
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return analyzeTextDocumentPixels({ width: size, height: size, rgb: data });
  } catch (error) {
    return { suspected: false, metrics: {}, skipped: String((error && error.message) || error).slice(0, 120) };
  }
}
