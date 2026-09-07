import Taro, { usePullDownRefresh } from '@tarojs/taro';
import { useMemo, useState } from 'react';
import { Input, ScrollView, Text, View } from '@tarojs/components';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { PageState } from '../../components/page-state';
import { Pagination } from '../../components/pagination';
import { HScrollTable, type TableColumn } from '../../components/h-scroll-table';
import { useRecordList } from '../../hooks/use-record-list';
import { useThemePage } from '../../hooks/use-theme-page';
import { isLoggedOut } from '../../services/api';
import { computeTypeInfo, fmt, formatTime, paginateClient } from '../../utils/record-format';

const PAGE_SIZE = 12;

const TYPE_TABS = [
  { key: 'all', label: '全部' },
  { key: 'recharge', label: '充值' },
  { key: 'consume', label: '消耗' },
];

const COLUMNS: TableColumn[] = [
  { key: 'id', label: '流水号', width: 220 },
  { key: 'type', label: '类型', width: 150 },
  { key: 'task', label: '任务', width: 300 },
  { key: 'delta', label: '变动', width: 160 },
  { key: 'remaining', label: '剩余', width: 160 },
  { key: 'time', label: '时间', width: 320 },
];

export default function ComputePage() {
  const { pageStyle } = useThemePage();
  const { allItems, points, loading, error, reload } = useRecordList('compute-records');
  const [activeTab, setActiveTab] = useState('all');
  const [keyword, setKeyword] = useState('');
  const [pendingKeyword, setPendingKeyword] = useState('');
  const [page, setPage] = useState(1);

  usePullDownRefresh(async () => { await reload(); Taro.stopPullDownRefresh(); });

  // 剩余：当前余额倒推每条记录发生后的剩余（网页端同款算法）
  const withRemaining = useMemo<Array<Record<string, unknown>>>(() => {
    let balance = points;
    return allItems.map((item) => {
      const row: Record<string, unknown> = { ...item, remaining: balance };
      const amount = Number(item.amount) || 0;
      if (String(item.type).toLowerCase() === 'consume') balance += amount;
      else balance -= amount;
      return row;
    });
  }, [allItems, points]);

  const filtered = useMemo(() => {
    return withRemaining
      .filter((item) => activeTab === 'all' || String(item.type).toLowerCase() === activeTab)
      .filter((item) => {
        if (!keyword) return true;
        const haystack = `${item.title || item.reason || ''} ${item.id || ''}`.toLowerCase();
        return haystack.includes(keyword.toLowerCase());
      });
  }, [withRemaining, activeTab, keyword]);

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
      <Text className='mini-page-heading'>算力记录</Text>
      <Text className='mini-page-caption'>查看您的算力充值与消耗流水</Text>
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
          placeholder='搜索流水号 / 任务...'
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
      <PageState
        loading={loading}
        error={error}
        empty={!loading && !error && filtered.length === 0}
        loginFallback={!!error && isLoggedOut()}
        onGoLogin={() => Taro.reLaunch({ url: '/pages/profile/index' })}
        onRetry={reload}
      />
      {!loading && !error && items.length > 0 && (
        <HScrollTable
          columns={COLUMNS}
          rows={items}
          rowKey={(row, index) => String(row.id || `compute-${index}`)}
          renderCell={(row, col) => {
            const typeInfo = computeTypeInfo(row.type);
            const title = String(row.title || row.reason || '-');
            switch (col.key) {
              case 'id':
                return <Text className='mini-mono'>{String(row.id ?? '-')}</Text>;
              case 'type':
                return <Text className={`mini-badge ${typeInfo.badgeCls}`}>{typeInfo.sign === '+' ? '↑ ' : '↓ '}{typeInfo.label}</Text>;
              case 'task':
                return <Text className='mini-table-cell-text'>{title}</Text>;
              case 'delta':
                return <Text className={typeInfo.amountCls}>{typeInfo.sign}{fmt(row.amount)}</Text>;
              case 'remaining':
                return <Text className='mini-table-cell-text'>{fmt(row.remaining)}</Text>;
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
