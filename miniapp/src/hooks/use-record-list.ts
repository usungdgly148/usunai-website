import { useCallback, useEffect, useState } from 'react';
import { fetchAllRecords, getMe } from '../services/api';

/**
 * 记录列表数据源（算力 / 订单）：
 *  - 全量拉取记录 + 当前用户算力（getMe），与网页端「加载全部后客户端过滤分页」一致。
 *  - 返回 allItems（按时间倒序）与 points（算力记录倒推「剩余」用）。
 */
export function useRecordList(path: 'compute-records' | 'orders') {
  const [allItems, setAllItems] = useState<Array<Record<string, unknown>>>([]);
  const [points, setPoints] = useState<number>(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [me, records] = await Promise.all([getMe(), fetchAllRecords(path)]);
      setPoints(Number(me.points) || 0);
      setAllItems(records);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [path]);

  useEffect(() => { void load(); }, [load]);

  return { allItems, points, loading, error, reload: load };
}
