import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { useCallback, useEffect, useState } from 'react';
import { Input, ScrollView, Text, View } from '@tarojs/components';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { PageState } from '../../components/page-state';
import { AssetRow } from '../../components/asset-row';
import { Pagination } from '../../components/pagination';
import { getPagedRecords } from '../../services/api';
import { useThemePage } from '../../hooks/use-theme-page';

/**
 * 我的资产页：与网页端「我的资产」表格视觉对齐。
 *  - 标题 + 副标题
 *  - 6 个分类 tabs：任务 / 文案 / 图片 / 视频 / 音频 / 图文
 *  - 搜索输入框（点击软键盘「搜索」提交，按名称模糊过滤）
 *  - 7 列表格：任务名称 / 类型 / 状态 / 创建时间 / 耗时 / 消耗算力 / 操作
 *  - 翻页器：每页 12 条，按页号替换式加载
 */

const PAGE_SIZE = 12;

const TABS: Array<{ key: string; label: string }> = [
  { key: 'task', label: '任务' },
  { key: 'copy', label: '文案' },
  { key: 'image', label: '图片' },
  { key: 'video', label: '视频' },
  { key: 'audio', label: '音频' },
  { key: 'article', label: '图文' },
];

const COLUMN_LABELS = ['任务名称', '类型', '状态', '创建时间', '耗时', '消耗算力', '操作'];

export default function AssetsPage() {
  const { pageStyle } = useThemePage();
  const [activeTab, setActiveTab] = useState('task');
  const [keyword, setKeyword] = useState('');
  const [pendingKeyword, setPendingKeyword] = useState('');
  const [items, setItems] = useState<Array<Record<string, unknown>>>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const reload = useCallback(async (targetPage: number) => {
    setLoading(true);
    setError('');
    // 仅把 category / keyword 这种 getPagedRecords 不自带的参数放进 extraQuery；
    // page / pageSize 由 getPagedRecords 自己拼到 base URL 上，重复会让服务端返回「该接口不支持当前请求方法」。
    const buildExtra = (withFilter: boolean) => {
      const extra: Record<string, string> = {};
      if (withFilter && activeTab !== 'task') extra.category = activeTab;
      if (withFilter && keyword) extra.keyword = keyword;
      return new URLSearchParams(extra).toString();
    };
    // 先带筛选参数拉一次；失败时不直接抛错，用基础参数（仅 page / pageSize）再试一次，
    // 服务端没实现 category / keyword 时静默降级，保证页面永远能加载出列表。
    try {
      let result;
      try {
        result = await getPagedRecords('assets', targetPage, PAGE_SIZE, buildExtra(true));
      } catch (innerErr) {
        if (!buildExtra(true)) throw innerErr;
        result = await getPagedRecords('assets', targetPage, PAGE_SIZE, '');
      }
      setItems(result.items);
      setPage(targetPage);
      setTotalPages(Number(result.pagination.totalPages) || 1);
      setTotal(Number(result.pagination.total) || result.items.length);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [activeTab, keyword]);

  useEffect(() => { void reload(1); }, [reload]);
  usePullDownRefresh(async () => { await reload(1); Taro.stopPullDownRefresh(); });

  const onTabChange = (key: string) => {
    if (key === activeTab) return;
    setActiveTab(key);
  };

  const onSearchSubmit = () => {
    if (pendingKeyword === keyword) return;
    setKeyword(pendingKeyword);
  };

  const onClearKeyword = () => {
    setPendingKeyword('');
    if (keyword) setKeyword('');
  };

  const onPageChange = (nextPage: number) => {
    if (nextPage < 1 || nextPage > totalPages || nextPage === page || loading) return;
    void reload(nextPage);
  };

  return <View className='page mini-assets-page' style={pageStyle}>
    {/* 顶部标题 + 副标题 */}
    <View className='mini-page-topbar'>
      <Text className='mini-page-heading'>我的资产</Text>
      <Text className='mini-page-caption'>管理您的所有创作资产与任务记录</Text>
    </View>

    {/* Tabs + 搜索 */}
    <View className='mini-asset-toolbar'>
      <ScrollView className='mini-asset-tabs' scrollX enableFlex enhanced showScrollbar={false}>
        <View className='mini-asset-tab-row'>
          {TABS.map((tab) => (
            <Text
              key={tab.key}
              className={`mini-asset-tab ${tab.key === activeTab ? 'mini-asset-tab-active' : ''}`}
              onClick={() => onTabChange(tab.key)}
            >
              {tab.key === activeTab ? '☑ ' : ''}{tab.label}
            </Text>
          ))}
        </View>
      </ScrollView>
      <View className='mini-asset-search'>
        <Text className='mini-asset-search-icon'>⌕</Text>
        <Input
          className='mini-asset-search-input'
          placeholder='搜索资产...'
          placeholderClass='mini-asset-search-placeholder'
          value={pendingKeyword}
          confirmType='search'
          onInput={(e) => setPendingKeyword(e.detail.value)}
          onConfirm={onSearchSubmit}
        />
        {pendingKeyword
          ? <Text className='mini-asset-search-clear' onClick={onClearKeyword}>×</Text>
          : null}
      </View>
    </View>

    {/* 表格区 */}
    <View className='mini-asset-panel'>
      <PageState loading={loading} error={error} empty={!loading && !error && items.length === 0} onRetry={() => void reload(1)} />
      {!loading && !error && items.length > 0 && (
        <>
          <View className='mini-asset-head'>
            {COLUMN_LABELS.map((label, i) => (
              <Text key={label} className={`mini-asset-th th-${i}`}>{label}</Text>
            ))}
          </View>
          {items.map((item, index) => (
            <AssetRow key={String(item.id || `asset-${index}`)} item={item} />
          ))}
        </>
      )}
    </View>

    {/* 分页器（每页 12 条） */}
    {!loading && !error && items.length > 0 && totalPages > 0 && (
      <View className='mini-asset-pagination-wrap'>
        <Text className='mini-asset-total'>{total > 0 ? `共 ${total} 条` : ''}</Text>
        <Pagination page={page} totalPages={totalPages} onChange={onPageChange} loading={loading} />
      </View>
    )}

    <MiniappTabBar active='assets' />
  </View>;
}