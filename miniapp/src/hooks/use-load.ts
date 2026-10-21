import { useCallback, useEffect, useState } from 'react';

export function useLoad<T>(loader: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  // silent：静默重载（用于「切回前台自动刷新」）。不切 loading，避免页面骨架屏闪一下；
  // 数据到达后正常 setData，用户只会看到内容原地更新。
  const reload = useCallback(async (options: { silent?: boolean } = {}) => {
    const silent = options.silent === true;
    if (!silent) setLoading(true);
    setError('');
    try { setData(await loader()); }
    catch (reason) {
      // 静默刷新失败时保留旧数据，不要把已经渲染好的页面换成错误页
      if (!silent) setError(reason instanceof Error ? reason.message : '加载失败，请稍后重试');
    } finally { if (!silent) setLoading(false); }
  }, deps);
  useEffect(() => { void reload(); }, [reload]);
  return { data, loading, error, reload };
}
