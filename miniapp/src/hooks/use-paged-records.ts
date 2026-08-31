import { useCallback, useEffect, useState } from 'react';
import { getPagedRecords } from '../services/api';

type RecordPath = 'assets' | 'compute-records' | 'orders';

export function usePagedRecords(path: RecordPath) {
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (targetPage = 1, append = false) => {
    append ? setLoadingMore(true) : setLoading(true);
    setError('');
    try {
      const result = await getPagedRecords(path, targetPage);
      setItems((current) => append ? [...current, ...result.items] : result.items);
      setPage(targetPage);
      setTotalPages(Number(result.pagination.totalPages) || 1);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败，请稍后重试');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  }, [path]);

  useEffect(() => { void load(1); }, [load]);
  return {
    items,
    loading,
    loadingMore,
    error,
    hasMore: page < totalPages,
    reload: () => load(1),
    loadMore: () => load(page + 1, true),
  };
}
