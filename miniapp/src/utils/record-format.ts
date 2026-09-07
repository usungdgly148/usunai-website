// 算力记录 / 订单记录的展示工具：与网页端（ComputeRecords.jsx / Orders.jsx）字段、标签、配色对齐。
import { formatTime } from './asset-format';

export { formatTime };

/** 金额/点数：数字统一 toFixed(2)（与网页端 fmt 一致），非数字原样返回。 */
export function fmt(value: unknown): string {
  return typeof value === 'number' ? value.toFixed(2) : String(value ?? '');
}

/** 算力类型 → 标签 / 徽标配色 / 变动符号 / 变动配色。 */
export function computeTypeInfo(type: unknown): {
  label: string;
  badgeCls: string;
  sign: string;
  amountCls: string;
} {
  const t = String(type ?? '').toLowerCase();
  if (t === 'recharge') {
    return { label: '充值', badgeCls: 'mini-badge-green', sign: '+', amountCls: 'mini-amount-up' };
  }
  return { label: '消耗', badgeCls: 'mini-badge-red', sign: '-', amountCls: 'mini-amount-down' };
}

/** 订单类型 → 中文标签（网页端 ORDER_TYPE_LABELS：compute 算力 / source 源码）。 */
export function orderTypeLabel(type: unknown): string {
  const t = String(type ?? '').toLowerCase();
  if (t === 'compute') return '算力';
  if (t === 'source') return '源码';
  return String(type ?? '-');
}

/** 订单状态 → 中文标签 + 徽标配色（网页端 STATUS_LABEL / STATUS_STYLE）。 */
export function orderStatusInfo(status: unknown): { label: string; cls: string } {
  const s = String(status ?? '').toLowerCase();
  if (s === 'paid') return { label: '已支付', cls: 'mini-badge-green' };
  if (s === 'pending') return { label: '待支付', cls: 'mini-badge-amber' };
  if (s === 'refunded') return { label: '已退款', cls: 'mini-badge-gray' };
  if (s === 'closed') return { label: '已关闭', cls: 'mini-badge-red' };
  return { label: String(status ?? '-'), cls: 'mini-badge-gray' };
}

/** 客户端分页（网页端 paginate 同款：全部加载后按页切片）。 */
export function paginateClient<T>(items: T[], page: number, pageSize = 12) {
  const total = items.length;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const start = (page - 1) * pageSize;
  return { items: items.slice(start, start + pageSize), total, totalPages };
}
