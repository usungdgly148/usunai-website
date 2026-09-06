import { Text, View } from '@tarojs/components';

/**
 * 通用分页器：
 *  - 输入 page / totalPages / onChange
 *  - 输出「‹ 上一页 · 1 2 3 · 下一页 ›」形态（与网页端「< 1/12 >」一致）
 *  - 可见页码窗口：当前页 ±2（共最多 5 个），首尾页时分别吸边
 *  - 总页数 ≤ 1 时整个组件隐藏
 */
export function Pagination({ page, totalPages, onChange, loading }: {
  page: number;
  totalPages: number;
  onChange: (next: number) => void;
  loading?: boolean;
}) {
  if (totalPages <= 1) return null;
  const pages = computePageWindow(page, totalPages);
  const goPrev = () => { if (page > 1 && !loading) onChange(page - 1); };
  const goNext = () => { if (page < totalPages && !loading) onChange(page + 1); };
  return <View className='mini-pagination'>
    <View className={`mini-pagination-arrow ${page <= 1 || loading ? 'is-disabled' : ''}`} onClick={goPrev}>
      <Text className='mini-pagination-arrow-glyph'>‹</Text>
      <Text className='mini-pagination-arrow-text'>上一页</Text>
    </View>
    <View className='mini-pagination-pages'>
      {pages.map((it) => (
        <Text
          key={it}
          className={`mini-pagination-page ${it === page ? 'mini-pagination-page-active' : ''}`}
          onClick={() => { if (!loading && it !== page) onChange(it); }}
        >{it}</Text>
      ))}
    </View>
    <View className={`mini-pagination-arrow ${page >= totalPages || loading ? 'is-disabled' : ''}`} onClick={goNext}>
      <Text className='mini-pagination-arrow-text'>下一页</Text>
      <Text className='mini-pagination-arrow-glyph'>›</Text>
    </View>
  </View>;
}

/** 计算可见页码窗口：首尾页吸边，中间窗口为 [page-2, page+2]。 */
function computePageWindow(page: number, total: number): number[] {
  const windowSize = 5;
  if (total <= windowSize) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  let start = Math.max(1, page - 2);
  let end = Math.min(total, start + windowSize - 1);
  if (end - start < windowSize - 1) start = Math.max(1, end - windowSize + 1);
  const list: number[] = [];
  for (let i = start; i <= end; i += 1) list.push(i);
  return list;
}

export default Pagination;