import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { Button, Image, Text, View } from '@tarojs/components';
import { useCallback, useEffect, useState } from 'react';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { useThemePage } from '../../hooks/use-theme-page';
import { deleteRuntimeAsset, getImageGenConfig, getPagedRecords } from '../../services/api';
import {
  firstImageOf, formatFileSize, imageUrl, markWorksDirty, saveImageToAlbum, shareThumbUrl, stashRegenerate,
  takeDetailAsset, wallTime,
} from '../../services/imageGen';
import { confirmDialog, toast } from '../../utils/feedback';
import { shareTargets } from '../../utils/share';

/**
 * 作品详情（P2）。
 *
 * 数据来源两条：① 列表页点卡片时写进本地存储的快照（正常路径，0 请求）；
 * ② 没有快照（分享/直接进入/返回后重进）就回退到资产列表接口里按 id 找。
 * 服务端没有「按 id 取单条资产」的接口，所以只能这样 —— 找的是第一页 100 条，
 * 更早的作品找不到就老实提示「可能已删除」，不编一份假数据出来。
 */
type Row = Record<string, unknown>;
const GEN_PAGE = '/pages/image-gen/index';
const LIST_PAGE = '/pages/image-gen/history';

export default function ImageGenDetailPage() {
  const { pageStyle } = useThemePage();
  const [id] = useState(() => String(Taro.getCurrentInstance()?.router?.params?.id || ''));
  const [asset, setAsset] = useState<Row | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // 模型 id → 中文名；拿不到配置就退回 id 本身（不空着）
  const configState = useLoad(getImageGenConfig, []);
  const models = configState.data?.models || [];

  const load = useCallback(async () => {
    if (!id) { setError('作品不存在（缺少 id）'); setLoading(false); return; }
    const cached = takeDetailAsset(id);
    if (cached) { setAsset(cached); setLoading(false); return; }
    setLoading(true);
    setError('');
    try {
      const result = await getPagedRecords('assets', 1, 100, 'category=image');
      const hit = (result.items || []).find((item) => String(item.id) === id);
      if (!hit) throw new Error('没找到这条作品，可能已经被删除了');
      setAsset(hit);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '加载失败，请稍后重试');
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);

  const image = asset ? firstImageOf(asset) : '';
  const prompt = String(asset?.content || asset?.name || '');
  const sourceId = String(asset?.sourceId || '');

  // 转发/分享：hook 必须写在页面源码里 —— Taro 逐页扫源码决定是否开启转发（见 utils/share.ts）。
  // 带作品图当配图、落地到创作页（好友看不到别人的资产，落详情页只会见到「作品不存在」）。
  const share = shareTargets({
    title: prompt ? (prompt.length > 18 ? `${prompt.slice(0, 18)}…` : prompt) : 'AI全能设计',
    imageUrl: image ? shareThumbUrl(image) : '',
    path: GEN_PAGE,
  });
  useShareAppMessage(() => share.app);
  useShareTimeline(() => share.timeline);

  const preview = () => {
    const url = imageUrl(image);
    if (!url) return;
    void Taro.previewImage({ urls: [url], current: url });
  };

  const copyPrompt = async () => {
    if (!prompt) return;
    try {
      await Taro.setClipboardData({ data: prompt });
      toast('提示词已复制', 'success');
    } catch {
      toast('复制失败', 'error');
    }
  };

  const saveToAlbum = async () => {
    if (!image || busy) return;
    setBusy(true);
    try {
      const outcome = await saveImageToAlbum(image);
      if (outcome === 'saved') toast('已保存到相册', 'success');
    } catch {
      toast('保存失败，请稍后重试', 'error');
    } finally {
      setBusy(false);
    }
  };

  /** 再次生成：只回填参数，绝不自动提交（生成要扣点） */
  const regenerate = async () => {
    if (!asset) return;
    stashRegenerate({
      prompt,
      model: sourceId,
      resolution: asset.resolution ? String(asset.resolution) : '',
      aspectRatio: asset.aspectRatio ? String(asset.aspectRatio) : '',
    });
    try {
      await Taro.navigateBack();
    } catch {
      await Taro.reLaunch({ url: GEN_PAGE });
    }
  };

  const remove = async () => {
    if (!asset || busy) return;
    const ok = await confirmDialog({
      title: '删除这张作品',
      content: '删除后不可恢复（资产库里的同一条记录也会一起消失）。',
      confirmText: '删除',
      cancelText: '再想想',
    });
    if (!ok) return;
    setBusy(true);
    try {
      await deleteRuntimeAsset(String(asset.id || ''));
      // 列表页可能还在内存里（它是本页的上一页）→ 打个标记，让它 onShow 时重拉一次
      markWorksDirty();
      toast('已删除', 'success');
      setTimeout(() => {
        // 从列表点进来的就返回列表；直接进来的回列表首页
        Taro.navigateBack().catch(() => Taro.reLaunch({ url: LIST_PAGE }));
      }, 400);
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : '删除失败，请稍后重试', 'error');
    } finally {
      setBusy(false);
    }
  };

  // 消耗算力这一行可点进「算力明细」（P5）：用户看到扣了 30 点，下一个念头就是「扣在哪了」
  const rows: Array<{ key: string; value: string; to?: string }> = asset ? [
    { key: '模型', value: models.find((item) => item.id === sourceId)?.label || sourceId || '-' },
    { key: '清晰度', value: String(asset.resolution || '-') },
    { key: '画面比例', value: String(asset.aspectRatio || '-') },
    { key: '体积', value: formatFileSize(asset.size) },
    {
      key: '消耗算力',
      value: asset.points ? `${String(asset.points)} 点` : '-',
      to: asset.points ? '/pages/compute/index' : '',
    },
    { key: '生成时间', value: wallTime(asset.createdAt) || '-' },
  ] : [];

  return <View className='page gen-detail-page' style={pageStyle}>
    <PageState loading={loading} error={error} onRetry={load} />

    {asset && !loading && !error && (<>
      <Image className='gen-detail-img' src={imageUrl(image)} mode='widthFix' onClick={preview} />
      <Text className='gen-detail-tip'>点图片可全屏查看 / 长按保存</Text>

      <View className='gen-card'>
        {rows.map((row) => (
          <View
            key={row.key}
            className='gen-detail-row'
            onClick={row.to ? () => { void Taro.navigateTo({ url: row.to as string }); } : undefined}
          >
            <Text className='gen-detail-key'>{row.key}</Text>
            <Text className={`gen-detail-value ${row.to ? 'gen-detail-value-link' : ''}`}>
              {row.value}{row.to ? ' ›' : ''}
            </Text>
          </View>
        ))}

        <View className='gen-detail-prompt-head'>
          <Text className='gen-label gen-label-flat'>提示词</Text>
          {!!prompt && <Text className='gen-detail-copy' onClick={copyPrompt}>复制</Text>}
        </View>
        <Text className='gen-detail-prompt' selectable userSelect>{prompt || '（这条记录没有保存提示词）'}</Text>
      </View>

      <View className='gen-result-actions'>
        <Button className='gen-action gen-action-primary' loading={busy} disabled={busy} onClick={saveToAlbum}>保存到相册</Button>
        <Button className='gen-action gen-action-secondary' onClick={regenerate}>再次生成</Button>
      </View>

      <View className='gen-detail-danger' onClick={remove}>
        <Text className='gen-detail-danger-text'>删除这张作品</Text>
      </View>
    </>)}

    <t-toast id='t-toast' theme='info' />
    <t-dialog id='t-dialog' title='' />
  </View>;
}
