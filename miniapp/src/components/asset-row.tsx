import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { TdIcon } from './td-icon';

const textOf = (value: unknown) => typeof value === 'string' || typeof value === 'number' ? String(value) : '';

/** 把任意形态的时间字段规范化为「YYYY/M/D HH:mm:ss」展示串。 */
function formatTime(value: unknown): string {
  const raw = textOf(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** 把毫秒 / 秒 / 时长串规范化为「22s」「1m03s」展示串。 */
function formatDuration(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  const n = Number(value);
  if (!Number.isFinite(n)) return textOf(value);
  const seconds = n > 1000 ? Math.round(n / 1000) : Math.round(n);
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return `${m}m${String(s).padStart(2, '0')}s`;
}

/** 算力消耗：tokens → 「7757 Tokens」；points → 「6 点」。 */
function formatCompute(item: Record<string, unknown>): string {
  const tokens = item.tokens ?? item.computeTokens ?? item.consumeTokens;
  if (typeof tokens === 'number' && tokens > 0) return `${tokens} Tokens`;
  if (typeof tokens === 'string' && tokens && tokens !== '0') return `${tokens} Tokens`;
  const points = item.points ?? item.delta ?? item.costPoints ?? item.amount;
  if (points === null || points === undefined || points === '') return '';
  const n = Number(points);
  if (Number.isFinite(n)) return `${n} 点`;
  return `${textOf(points)} 点`;
}

/** 类型映射：英文 / 中文枚举 → 中文展示文本。 */
function formatType(item: Record<string, unknown>): string {
  const raw = textOf(item.kind ?? item.type ?? item.category ?? '').trim();
  if (!raw) return '';
  const key = raw.toLowerCase();
  const map: Record<string, string> = {
    agent: 'AI 对话',
    chat: 'AI 对话',
    workflow: '工作流',
    copy: '文案',
    text: '文案',
    image: '图片',
    picture: '图片',
    photo: '图片',
    video: '视频',
    audio: '音频',
    voice: '音频',
    article: '图文',
    'image-text': '图文',
    image_text: '图文',
  };
  if (map[key]) return map[key];
  return raw;
}

/** 状态 → 徽标 class。 */
function statusClass(status: string): string {
  const s = status.toLowerCase();
  if (['succeeded', 'success', 'completed', 'finished', 'done', '成功'].some(k => s.includes(k))) return 'mini-asset-status-success';
  if (['running', 'pending', 'processing', 'queued', '执行中', '进行中'].some(k => s.includes(k))) return 'mini-asset-status-running';
  if (['failed', 'error', 'fail', '失败'].some(k => s.includes(k))) return 'mini-asset-status-failed';
  return 'mini-asset-status-default';
}

function statusText(status: string): string {
  const s = status.toLowerCase();
  if (['succeeded', 'success', 'completed', 'finished', 'done'].some(k => s.includes(k))) return '成功';
  if (['running', 'processing'].some(k => s.includes(k))) return '执行中';
  if (['pending', 'queued', 'waiting'].some(k => s.includes(k))) return '排队中';
  if (['failed', 'error', 'fail'].some(k => s.includes(k))) return '失败';
  return status;
}

export function AssetRow({ item, onDelete }: {
  item: Record<string, unknown>;
  onDelete?: (item: Record<string, unknown>) => void;
}) {
  const title = textOf(item.name ?? item.title ?? item.taskName ?? item.displayName ?? '');
  const subtitle = textOf(item.alias ?? item.subtitle ?? item.description ?? item.summary ?? item.remark ?? '');
  const type = formatType(item);
  const status = textOf(item.status ?? item.state ?? '成功') || '成功';
  const time = formatTime(item.createdAt ?? item.completedAt ?? item.updatedAt ?? item.time);
  const duration = formatDuration(item.duration ?? item.elapsed ?? item.costTime);
  const compute = formatCompute(item);
  const id = textOf(item.id);

  const onView = () => {
    if (!id) return;
    void Taro.navigateTo({ url: `/pages/detail/index?id=${encodeURIComponent(id)}` });
  };
  const onDeleteClick = () => {
    if (onDelete) onDelete(item);
  };

  return <View className='mini-asset-row'>
    {/* 任务名称：主标题 + 副标题 */}
    <View className='mini-asset-cell mini-asset-cell-name'>
      <Text className='mini-asset-name'>{title || '未命名任务'}</Text>
      {subtitle && subtitle !== title ? <Text className='mini-asset-name-sub'>{subtitle}</Text> : null}
    </View>
    {/* 类型 */}
    <View className='mini-asset-cell mini-asset-cell-type'>
      <Text className='mini-asset-cell-text'>{type || '-'}</Text>
    </View>
    {/* 状态 */}
    <View className='mini-asset-cell mini-asset-cell-status'>
      <Text className={`mini-asset-status ${statusClass(status)}`}>{statusText(status)}</Text>
    </View>
    {/* 创建时间 */}
    <View className='mini-asset-cell mini-asset-cell-time'>
      <Text className='mini-asset-cell-text'>{time || '-'}</Text>
    </View>
    {/* 耗时 */}
    <View className='mini-asset-cell mini-asset-cell-duration'>
      <Text className='mini-asset-cell-text'>{duration || '-'}</Text>
    </View>
    {/* 消耗算力 */}
    <View className='mini-asset-cell mini-asset-cell-cost'>
      <Text className='mini-asset-cell-text'>{compute || '-'}</Text>
    </View>
    {/* 操作 */}
    <View className='mini-asset-cell mini-asset-cell-actions'>
      <Text className='mini-asset-action-link' onClick={onView}>任务详情</Text>
      <Text className='mini-asset-action-delete' onClick={onDeleteClick}>
        <TdIcon name='close' className='mini-asset-action-icon' />
      </Text>
    </View>
  </View>;
}

export default AssetRow;