import { Text, View } from '@tarojs/components';

const textOf = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';

export function RecordList({ items, kind }: { items: Array<Record<string, unknown>>; kind: 'compute' | 'asset' | 'order' }) {
  return <View>{items.map((item, index) => {
    const title = textOf(item.name || item.title || item.taskName || item.productName || item.remark || `${kind === 'asset' ? '资产' : kind === 'order' ? '订单' : '算力记录'} ${index + 1}`);
    const value = textOf(item.delta ?? item.points ?? item.amount ?? item.status ?? '');
    const time = textOf(item.createdAt || item.updatedAt || item.time || item.timestamp || '');
    return <View className='card' key={textOf(item.id) || `${kind}-${index}`}>
      <View className='record-main'><Text className='card-title'>{title}</Text><Text className='record-value'>{value}</Text></View>
      {time && <Text className='muted'>{time}</Text>}
    </View>;
  })}</View>;
}
