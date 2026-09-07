import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import { Input, ScrollView, Text, View } from '@tarojs/components';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { PageState } from '../../components/page-state';
import { Pagination } from '../../components/pagination';
import { HScrollTable, type TableColumn } from '../../components/h-scroll-table';
import { useRecordList } from '../../hooks/use-record-list';
import { useThemePage } from '../../hooks/use-theme-page';
import { formatTime, orderStatusInfo, orderTypeLabel, paginateClient } from '../../utils/record-format';

const PAGE_SIZE = 12;

const TYPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'compute', label: '算力' },
  { key: 'source', label: '源码' },
];

const COLUMNS: TableColumn[] = [
  { key: 'id', label: '订单号', width: 200 },
  { key: 'type', label: '类型', width: 130 },
  { key: 'action', label: '动作', width: 240 },
  { key: 'name', label: '商品名称', width: 320 },
  { key: 'amount', label: '金额', width: 150 },
  { key: 'status', label: '状态', width: 160 },
  { key: 'time', label: '创建时间', width: 320 },
];

export default function OrdersPage() {
  const { pageStyle } = useThemePage();
  const { allItems, loading, error, reload } = useRecordList('orders');
  const [activeTab, setActiveTab] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [pendingKeyword, setPendingKeyword] = useState('');
  const [page, setPage] = useState(1);

  usePullDownRefresh(async () => { await reload(); Taro.stopPullDownRefresh(); });

  const filtered = useMemo(() => {
    return allItems
      .filter((item) => activeTab === 'all' || String(item.type).toLowerCase() === activeTab)
      .filter((item) => {
        if (!keyword) return true;
        const haystack = `${item.name || ''} ${item.id || ''}`.toLowerCase();
        return haystack.includes(keyword.toLowerCase());
      });
  }, [allItems, activeTab, keyword]);

  const { items, total, totalPages } = paginateClient(filtered, page);

  const onTabChange = (key: string) => {
    if (key === activeTab) return;
    setActiveTab(key);
    setPage(1);
  };

  const onSearchSubmit = () => {
    if (pendingKeyword === keyword) return;
    setKeyword(pendingKeyword);
    setPage(1);
  };

  const onClearKeyword = () => {
    setPendingKeyword('');
    if (keyword) { setKeyword(''); setPage(1); }
  };

  return <View className='page mini-records-page' style={pageStyle}>
    <View className='mini-page-topbar'>
      <Text className='mini-page-heading'>订单记录</Text>
      <Text className='mini-page-caption'>查看您的历史订单</Text>
    </View>

    <View className='mini-record-toolbar'>
      <ScrollView className='mini-asset-tabs' scrollX enableFlex enhanced showScrollbar={false}>
        <View className='mini-asset-tab-row'>
          {TYPE_TABS.map((tab) => (
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
          placeholder='搜索订单号 / 商品...'
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

    <View className='mini-record-panel'>
      <PageState loading={loading} error={error} empty={!loading && !error && filtered.length === 0} onRetry={reload} />
      {!loading && !error && items.length > 0 && (
        <HScrollTable
          columns={COLUMNS}
          rows={items}
          rowKey={(row, index) => String(row.id || `order-${index}`)}
          renderCell={(row, col) => {
            const status = orderStatusInfo(row.status);
            switch (col.key) {
              case 'id':
                return <Text className='mini-mono'>{String(row.id ?? '-')}</Text>;
              case 'type':
                return <Text className='mini-table-cell-text'>{orderTypeLabel(row.type)}</Text>;
              case 'action':
                return <Text className='mini-table-cell-text'>{String(row.action || '充值')}</Text>;
              case 'name':
                return <Text className='mini-table-cell-text mini-table-cell-strong'>{String(row.name || '-')}</Text>;
              case 'amount':
                return <Text className='mini-table-cell-text mini-table-cell-strong'>¥{String(row.amount ?? 0)}</Text>;
              case 'status':
                return <Text className={`mini-badge ${status.cls}`}>{status.label}</Text>;
              case 'time':
                return <Text className='mini-table-cell-text'>{formatTime(row.createdAt)}</Text>;
              default:
                return null;
            }
          }}
        />
      )}
    </View>

    {!loading && !error && items.length > 0 && totalPages > 0 && (
      <View className='mini-asset-pagination-wrap'>
        <Text className='mini-asset-total'>{total > 0 ? `共 ${total} 条` : ''}</Text>
        <Pagination page={page} totalPages={totalPages} onChange={(next) => setPage(next)} loading={loading} />
      </View>
    )}

    <MiniappTabBar active='profile' />
  </View>;
}
