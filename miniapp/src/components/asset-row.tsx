import { Text, View } from '@tarojs/components';
import { TdIcon } from './td-icon';
import { formatAssetCost, formatAssetType, formatDuration, formatTime, statusClass, statusText } from '../utils/asset-format';

/**
 * 资产行：7 列，与网页端「我的资产 → 任务」表格对齐。
 * 列宽由 app.scss 固定（总宽超屏，外层横向 ScrollView 可左右滑动查看）。
 */
export function AssetRow({ item, onView, onDelete }: {
  item: Record<string, unknown>;
  onView?: (item: Record<string, unknown>) => void;
  onDelete?: (item: Record<string, unknown>) => void;
}) {
  const title = String(item.name ?? item.title ?? item.taskName ?? item.displayName ?? '') || '未命名任务';
  // 副标题（sourceName）已移除：它恒为 title 的「相同内容或前缀」——
  // 任务记录里两者完全相等、资源记录里 name 是「来源名 · 类型」，两行必然重复（与网页端「我的资产」表格保持一致）。
  const type = formatAssetType(item);
  const status = String(item.status ?? item.state ?? '') || '成功';
  const time = formatTime(item.createdAt ?? item.completedAt ?? item.updatedAt ?? item.time);
  const duration = formatDuration(item.duration ?? item.elapsed ?? item.costTime);
  const compute = formatAssetCost(item);

  const handleView = () => { if (onView) onView(item); };
  const handleDelete = () => { if (onDelete) onDelete(item); };

  return <View className='mini-asset-row'>
    {/* 任务名称：只渲染一次 */}
    <View className='mini-asset-cell mini-asset-cell-name'>
      <Text className='mini-asset-name'>{title}</Text>
    </View>
    {/* 类型 */}
    <View className='mini-asset-cell mini-asset-cell-type'>
      <Text className='mini-asset-cell-text'>{type}</Text>
    </View>
    {/* 状态 */}
    <View className='mini-asset-cell mini-asset-cell-status'>
      <Text className={`mini-asset-status ${statusClass(status)}`}>{statusText(status)}</Text>
    </View>
    {/* 创建时间 */}
    <View className='mini-asset-cell mini-asset-cell-time'>
      <Text className='mini-asset-cell-text'>{time}</Text>
    </View>
    {/* 耗时 */}
    <View className='mini-asset-cell mini-asset-cell-duration'>
      <Text className='mini-asset-cell-text'>{duration}</Text>
    </View>
    {/* 消耗算力 */}
    <View className='mini-asset-cell mini-asset-cell-cost'>
      <Text className='mini-asset-cell-text'>{compute}</Text>
    </View>
    {/* 操作 */}
    <View className='mini-asset-cell mini-asset-cell-actions'>
      <Text className='mini-asset-action-link' onClick={handleView}>任务详情</Text>
      <Text className='mini-asset-action-delete' onClick={handleDelete}>
        <TdIcon name='close' className='mini-asset-action-icon' />
      </Text>
    </View>
  </View>;
}

export default AssetRow;
