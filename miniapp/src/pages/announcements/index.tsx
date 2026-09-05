import Taro from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent } from '../../services/api';

function openLink(url: string) {
  if (!url) return;
  if (url.startsWith('/pages/')) {
    void Taro.navigateTo({ url });
    return;
  }
  if (/^https:\/\//i.test(url)) {
    void Taro.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(url)}` });
  }
}

export default function AnnouncementsPage() {
  const state = useLoad(() => getPublicContent(), []);
  const announcements = state.data?.announcements || [];

  return <View className='page mini-announcements-page'>
    <Text className='page-title'>公告通知</Text>
    <Text className='page-subtitle'>查看平台最新通知与服务动态</Text>
    <PageState loading={state.loading} error={state.error} empty={!state.loading && !state.error && announcements.length === 0} onRetry={state.reload} />
    <View className='mini-announcement-list'>
      {announcements.map((item, index) => <View
        className='mini-announcement-list-item'
        key={String(item.id || index)}
        onClick={() => openLink(String(item.link || item.linkUrl || ''))}
      >
        <Text className='mini-announcement-list-title'>{String(item.title || '平台公告')}</Text>
        <Text className='mini-announcement-list-content'>{String(item.content || '')}</Text>
        <Text className='mini-announcement-list-time'>{String(item.updatedAt || item.createdAt || item.startAt || '').slice(0, 10)}</Text>
      </View>)}
    </View>
  </View>;
}
