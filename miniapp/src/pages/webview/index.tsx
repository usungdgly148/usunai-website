import { WebView } from '@tarojs/components';
import Taro, { useRouter, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { toast } from '../../utils/feedback';
import { useThemePage } from '../../hooks/use-theme-page';
import { shareTargets } from '../../utils/share';

export default function WebviewPage() {
  const router = useRouter();
  useThemePage();
  // 转发/分享：hook 必须写在页面源码里 —— Taro 逐页扫源码决定是否开启转发（见 utils/share.ts）
  const share = shareTargets();
  useShareAppMessage(() => share.app);
  useShareTimeline(() => share.timeline);
  const url = decodeURIComponent(String(router.params.url || ''));
  if (!/^https:\/\//i.test(url)) {
    toast('链接无效', 'error');
    return <t-toast id='t-toast' theme='info' />;
  }
  return <WebView src={url} />;
}
