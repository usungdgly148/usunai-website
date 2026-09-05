// 前端计费镜像模块
// 与 server/billing.js 保持同一套规则与常量，保证前后端、算力中心计费一致。
// 优先调用后端 /api/estimate-tokens（唯一真值来源），后端不可达时本地兜底。

export const BILLING = {
  // 默认 token 单价（点/千 token），智能体可在自己配置里通过 priceRate 覆盖
  // —— 之前 computeCost 硬编码用了这个值，导致主人设的 20 点/千 token 完全失效，
  // 实际只按默认 6/千 扣。修法：computeCost 真正使用入参 priceRate/1000。
  defaultTokenToPoint: 6 / 1000,
  bufferCoef: 1.15,       // 平台隐性消耗 buffer
  messageOverhead: 4,
  note: '默认 1000 token = 6 点（含 15% 平台隐性消耗 buffer），实际扣点按智能体/工作流的 priceRate（点/千 token）计算',
};

// 旧字段名兼容（避免外部 import 报错），指向默认值
export const tokenToPoint = BILLING.defaultTokenToPoint;

export function estimateTokens(text) {
  if (!text) return 0;
  const str = String(text);
  let cjk = 0;
  let other = 0;
  for (const ch of str) {
    const code = ch.codePointAt(0);
    const isCJK =
      (code >= 0x4e00 && code <= 0x9fff) ||
      (code >= 0x3400 && code <= 0x4dbf) ||
      (code >= 0x3000 && code <= 0x303f) ||
      (code >= 0xff00 && code <= 0xffef) ||
      (code >= 0x3040 && code <= 0x30ff);
    if (isCJK) cjk++;
    else other++;
  }
  return cjk + Math.ceil(other / 4);
}

export function estimateInputTokens({ system = '', history = [], message = '' } = {}) {
  let total = 0;
  if (system) total += estimateTokens(system) + BILLING.messageOverhead;
  for (const m of history || []) {
    if (m && m.content) total += estimateTokens(m.content) + BILLING.messageOverhead;
  }
  total += estimateTokens(message) + BILLING.messageOverhead;
  return total;
}

export function computeCost({ inputTokens = 0, outputTokens = 0, priceRate } = {}) {
  // priceRate = 智能体/工作流配置的"点/千 token"单价（默认 6）。
  // 之前 bug：硬编码用了 BILLING.tokenToPoint，priceRate 形同虚设。
  // 修后：实际扣点 = ceil(totalTokens * 1.15 * priceRate / 1000)
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
    tokenToPoint: rate / 1000, // 当前实际使用的换算系数（与 priceRate 对齐）
    priceRate: rate,
    points,
  };
}

// 调用后端估算；失败时用本地镜像兜底，保证离线原型也能跑出一致结果。
export async function fetchEstimate({ system = '', history = [], message = '', answer = '', priceRate = 6 } = {}) {
  try {
    const res = await fetch('/api/estimate-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system, history, message, answer, priceRate }),
    });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.points === 'number') return data;
    }
  } catch {
    // 后端不可达，走本地兜底
  }
  const inputTokens = estimateInputTokens({ system, history, message });
  const outputTokens = estimateTokens(answer || '');
  return computeCost({ inputTokens, outputTokens, priceRate });
}
