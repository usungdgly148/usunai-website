// 计费与 Token 预估规则（全平台唯一真值来源）
// 扣子新版不返回 Token 消耗，因此统一在此用本地分词算法估算。
// 规则：1000 token = 6 点算力；并预留 15% buffer 吸收扣子后台的隐性消耗
// （插件 / 知识库检索 / 格式开销等前端不可见部分）。
// 前端 src/billing.js 为同一套规则的镜像，用于后端不可达时的兜底，
// 两者常量必须保持一致，以保证前后端、算力中心计费规则同步。

export const BILLING = {
  // 默认 token 单价（点/千 token），智能体可在自己配置里通过 priceRate 覆盖
  defaultTokenToPoint: 6 / 1000,
  bufferCoef: 1.15, // 平台隐性消耗 buffer（估算 token 先乘此系数再换算为点）
  messageOverhead: 4, // 每条消息的固定结构开销（role + 分隔符等）
  note: '默认 1000 token = 6 点（含 15% 平台隐性消耗 buffer），实际扣点按智能体/工作流的 priceRate（点/千 token）计算',
};

// 旧字段名兼容
export const tokenToPoint = BILLING.defaultTokenToPoint;

// 分词估算（豆包近似规则）：
// - 中日韩表意文字（含 CJK 标点）：约 1 token / 字
// - 其它字符（拉丁字母 / 数字 / 符号 / 空格）：约 4 字符 = 1 token
export function estimateTokens(text) {
  if (!text) return 0;
  const str = String(text);
  let cjk = 0;
  let other = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    const isCJK =
      (code >= 0x4e00 && code <= 0x9fff) || // CJK 统一表意文字
      (code >= 0x3400 && code <= 0x4dbf) || // 扩展 A
      (code >= 0x3000 && code <= 0x303f) || // CJK 符号和标点
      (code >= 0xff00 && code <= 0xffef) || // 全角字符
      (code >= 0x3040 && code <= 0x30ff);   // 日文假名
    if (isCJK) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 4);
}

// 一轮对话的输入 token = 系统提示词 + 历史 + 本次用户消息（各含消息开销）
export function estimateInputTokens({ system = '', history = [], message = '' } = {}) {
  let total = 0;
  if (system) total += estimateTokens(system) + BILLING.messageOverhead;
  for (const m of history || []) {
    if (m && m.content) total += estimateTokens(m.content) + BILLING.messageOverhead;
  }
  total += estimateTokens(message) + BILLING.messageOverhead;
  return total;
}

// 由输入/输出 token 计算应扣算力点（含 buffer，按智能体/工作流的 priceRate 单价）
export function computeCost({ inputTokens = 0, outputTokens = 0, priceRate } = {}) {
  const rate = Number(priceRate) > 0 ? Number(priceRate) : 6;
  const totalTokens = inputTokens + outputTokens;
  const bufferedTokens = Math.ceil(totalTokens * BILLING.bufferCoef);
  const points = Math.max(1, Math.ceil(bufferedTokens * rate / 1000));
  return {
    inputTokens,
    outputTokens,
    totalTokens,
    bufferedTokens,
    bufferCoef: BILLING.bufferCoef,
    tokenToPoint: rate / 1000,
    priceRate: rate,
    points,
  };
}

// 原生模型返回真实 usage 时不再叠加 Coze 的 15% 隐性消耗 buffer。
export function computeExactCost({ inputTokens = 0, outputTokens = 0, priceRate } = {}) {
  const rate = Number(priceRate) > 0 ? Number(priceRate) : 6;
  const totalTokens = Math.max(0, Number(inputTokens) || 0) + Math.max(0, Number(outputTokens) || 0);
  return {
    inputTokens: Math.max(0, Number(inputTokens) || 0),
    outputTokens: Math.max(0, Number(outputTokens) || 0),
    totalTokens,
    bufferedTokens: totalTokens,
    bufferCoef: 1,
    tokenToPoint: rate / 1000,
    priceRate: rate,
    points: Math.max(1, Math.ceil(totalTokens * rate / 1000)),
  };
}

// 统一入口：给定上下文与回复，返回完整估算结果
export function estimateUsage({ system = '', history = [], message = '', answer = '', priceRate = 6 } = {}) {
  const inputTokens = estimateInputTokens({ system, history, message });
  const outputTokens = estimateTokens(answer);
  return computeCost({ inputTokens, outputTokens, priceRate });
}
