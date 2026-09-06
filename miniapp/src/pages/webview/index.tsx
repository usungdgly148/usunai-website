import { WebView } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';
import { toast } from '../../utils/feedback';
import { useThemePage } from '../../hooks/use-theme-page';

export default function WebviewPage() {
  const router = useRouter();
  useThemePage();
  const url = decodeURIComponent(String(router.params.url || ''));
  if (!/^https:\/\//i.test(url)) {
    toast('链接无效', 'error');
    return <t-toast id='t-toast' theme='info' />;
  }
  return <WebView src={url} />;
}
