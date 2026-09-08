import Taro, { useRouter } from '@tarojs/taro';
import { Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';
import { PageState } from '../../components/page-state';
import { MarkdownContent } from '../../components/markdown-content';
import { useThemePage } from '../../hooks/use-theme-page';
import { getLegalAgreements, type LegalAgreement } from '../../services/api';

const TYPE_META: Record<string, { title: string }> = {
  privacy: { title: '隐私政策' },
  terms: { title: '使用协议' },
};

export default function LegalPage() {
  const { pageStyle } = useThemePage();
  const router = useRouter();
  const rawType = decodeURIComponent(String(router.params.type || ''));
  const type = rawType === 'privacy' ? 'privacy' : 'terms';
  const meta = TYPE_META[type];
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [agreement, setAgreement] = useState<LegalAgreement | null>(null);

  useEffect(() => {
    Taro.setNavigationBarTitle({ title: meta.title });
  }, [meta.title]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    getLegalAgreements()
      .then((all) => {
        if (!alive) return;
        setAgreement((type === 'privacy' ? all.privacy : all.terms) || null);
        setLoading(false);
      })
      .catch((reason) => {
        if (!alive) return;
        setError(reason instanceof Error ? reason.message : '协议内容加载失败');
        setLoading(false);
      });
    return () => { alive = false; };
  }, [type]);

  const reload = () => {
    setLoading(true);
    setError('');
    getLegalAgreements()
      .then((all) => setAgreement((type === 'privacy' ? all.privacy : all.terms) || null))
      .catch((reason) => setError(reason instanceof Error ? reason.message : '协议内容加载失败'))
      .finally(() => setLoading(false));
  };

  const title = agreement?.title || meta.title;

  return <View className='page mini-legal-page' style={pageStyle}>
    <PageState loading={loading} error={error} onRetry={reload} />

    {!loading && !error && (
      <>
        <View className='mini-page-topbar'>
          <Text className='mini-page-heading'>{title}</Text>
        </View>
        <View className='mini-legal-card'>
          {agreement?.content ? (
            <MarkdownContent value={agreement.content} selectable />
          ) : (
            <Text className='mini-legal-empty'>协议内容暂未配置。</Text>
          )}
        </View>
      </>
    )}

    <t-toast id='t-toast' theme='info' />
  </View>;
}
