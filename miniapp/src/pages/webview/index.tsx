import { WebView } from '@tarojs/components';
import Taro, { useRouter } from '@tarojs/taro';

export default function WebviewPage() {
  const router = useRouter();
  const url = decodeURIComponent(String(router.params.url || ''));
  if (!/^https:\/\//i.test(url)) {
    void Taro.showToast({ title: '链接无效', icon: 'none' });
    return null;
  }
  return <WebView src={url} />;
}
