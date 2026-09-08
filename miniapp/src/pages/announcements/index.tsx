import { useState } from 'react';
import { Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { PageState } from '../../components/page-state';
import { MarkdownContent } from '../../components/markdown-content';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';
import { ANN_SEEN_EVENT, announcementTime, markAnnouncementsSeen, sortAnnouncements } from '../../services/announcements';
import { useThemePage } from '../../hooks/use-theme-page';

/** 公告类型 → 中文标签（与网页端 ANN_TYPE_META 一致） */
const ANN_TYPE_META: Record<string, string> = {
  feature: '新增功能',
  optimize: '功能优化',
  fix: '问题修复',
  other: '其他',
};
const ANN_TYPE_KEYS = ['feature', 'optimize', 'fix', 'other'];

/** 发布时间格式化：YYYY-MM-DD HH:mm（与网页端 ANN_FMT 一致） */
function formatTime(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function AnnouncementsPage() {
  const { pageStyle } = useThemePage();
  const state = useLoad(async () => {
    const content = await getPublicContent();
    // 进入列表即视为已读：写入最新公告时间并广播，首页铃铛红点随之消失
    const list = sortAnnouncements(content?.announcements || []);
    if (list.length) {
      markAnnouncementsSeen(list);
      Taro.eventCenter.trigger(ANN_SEEN_EVENT);
    }
    return content;
  }, []);
  const announcements = sortAnnouncements(state.data?.announcements || []);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return <View className='page mini-announcements-page' style={pageStyle}>
    <Text className='page-title'>公告通知</Text>
    <Text className='page-subtitle'>查看平台最新通知与服务动态</Text>
    <PageState loading={state.loading} error={state.error} empty={!state.loading && !state.error && announcements.length === 0} onRetry={state.reload} />
    <View className='mini-announce-list'>
      {announcements.map((item, index) => {
        const id = String(item.id || index);
        const typeKey = ANN_TYPE_KEYS.includes(String(item.type)) ? String(item.type) : 'other';
        const version = String(item.version || '');
        const title = String(item.title || '平台公告');
        const time = formatTime(announcementTime(item));
        const expanded = expandedId === id;
        return (
          <View className='mini-announce-card' key={id}>
            <View className='mini-announce-card-head' onClick={() => setExpandedId(expanded ? null : id)}>
              <Text className={`mini-announce-type mini-announce-type-${typeKey}`}>{ANN_TYPE_META[typeKey]}</Text>
              <View className='mini-announce-title-wrap'>
                {!!version && <Text className='mini-announce-version'>{version}</Text>}
                <Text className='mini-announce-title'>{title}</Text>
              </View>
              <Text className='mini-announce-time'>{time}</Text>
              <Text className={`mini-announce-arrow${expanded ? ' mini-announce-arrow-open' : ''}`}>›</Text>
            </View>
            {expanded && (
              <View className='mini-announce-body'>
                {item.content && String(item.content).trim()
                  ? <MarkdownContent value={String(item.content)} selectable />
                  : <Text className='mini-announce-empty-content'>（无详细内容）</Text>}
              </View>
            )}
          </View>
        );
      })}
    </View>
  </View>;
}
