import Taro, { usePullDownRefresh, useReachBottom, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { Image, ScrollView, Text, View } from '@tarojs/components';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { useThemePage } from '../../hooks/use-theme-page';
import { deleteRuntimeAsset, getImageGenConfig, getPagedRecords } from '../../services/api';
import { firstImageOf, imageUrl, saveImageToAlbum, stashRegenerate, wallTime } from '../../services/imageGen';
import { confirmDialog, toast } from '../../utils/feedback';
import { shareTargets } from '../../utils/share';

/**
 * 「我的作品」—— AI全能设计 的生成记录墙（P1）。
 *
 * 数据源就是**资产库里的图片资产**（`category=image`），不另立一张表：
 * 网页端、小程序端、别处生成的图片资产全都在这一个池子里，天然跨端可见。
 *
 * 版式：两列瀑布（图片 mode='widthFix' 保持原比例）。不做真测量排版 —— 按奇偶分列已经够看，
 * 真要等高得先拿全部图片尺寸，收益不抵复杂度。
 */
const PAGE_SIZE = 20;
const GEN_PAGE = '/pages/image-gen/index';
const IMAGE_CATEGORY = 'image';

type Row = Record<string, unknown>;

export default function ImageGenHistoryPage() {
  const { pageStyle } = useThemePage();
  // 转发/分享：hook 必须写在页面源码里 —— Taro 逐页扫源码决定是否开启转发（见 utils/share.ts）
  const share = shareTargets({ title: '我的作品' });
  useShareAppMessage(() => share.app);
  useShareTimeline(() => share.timeline);

  // 模型筛选直接复用生图配置：chip 上的文案与后台模型名永远一致
  const configState = useLoad(getImageGenConfig, []);
  const models = configState.data?.models || [];

  const [filter, setFilter] = useState('');
  const [items, setItems] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState('');

  const load = useCallback(async (targetPage: number, mode: 'reset' | 'append') => {
    if (mode === 'reset') { setLoading(true); setError(''); }
    try {
      // keyword 由服务端做 `JSON.stringify(item).includes(词)` —— 传模型 id 正好命中 sourceId，
      // 所以「按模型筛选」是**服务端筛**，翻页仍然是对的（不会出现「客户端筛完一页只剩两条」）。
      const extra = [`category=${IMAGE_CATEGORY}`, filter ? `keyword=${encodeURIComponent(filter)}` : '']
        .filter(Boolean).join('&');
      const result = await getPagedRecords('assets', targetPage, PAGE_SIZE, extra);
      // 没图的记录（历史脏数据）不占版面
      const list = (result.items || []).filter((item) => !!firstImageOf(item));
      setItems((prev) => (mode === 'reset' ? list : [...prev, ...list]));
      setPage(targetPage);
      setTotalPages(Number(result.pagination.totalPages) || 1);
    } catch (reason) {
      if (mode === 'reset') setError(reason instanceof Error ? reason.message : '加载失败，请稍后重试');
    } finally {
      if (mode === 'reset') setLoading(false);
    }
  }, [filter]);

  useEffect(() => { void load(1, 'reset'); }, [load]);
  usePullDownRefresh(async () => { await load(1, 'reset'); Taro.stopPullDownRefresh(); });
  useReachBottom(() => {
    if (loading || loadingMore || page >= totalPages) return;
    setLoadingMore(true);
    void load(page + 1, 'append').finally(() => setLoadingMore(false));
  });

  // 按奇偶分两列：index 0/2/4 → 左列，1/3/5 → 右列
  const columns = useMemo(() => {
    const left: Row[] = [];
    const right: Row[] = [];
    items.forEach((item, index) => (index % 2 === 0 ? left : right).push(item));
    return [left, right];
  }, [items]);

  const previewRow = (item: Row) => {
    const urls = items.map((entry) => imageUrl(firstImageOf(entry))).filter(Boolean);
    const current = imageUrl(firstImageOf(item));
    if (!current) return;
    void Taro.previewImage({ urls: urls.length ? urls : [current], current });
  };

  const saveRow = async (item: Row) => {
    try {
      const outcome = await saveImageToAlbum(firstImageOf(item));
      if (outcome === 'saved') toast('已保存到相册', 'success');
    } catch {
      toast('保存失败，请稍后重试', 'error');
    }
  };

  /**
   * 再次生成：把提示词与参数写进本地存储，然后回创作页。
   * ⚠️ 只回填、**不自动提交** —— 生成要扣点，自动跑一遍等于替用户花钱。
   */
  const regenerate = async (item: Row) => {
    stashRegenerate({
      prompt: String(item.content || item.name || ''),
      model: item.sourceId ? String(item.sourceId) : '',
      resolution: item.resolution ? String(item.resolution) : '',
      aspectRatio: item.aspectRatio ? String(item.aspectRatio) : '',
    });
    try {
      await Taro.navigateBack();
    } catch {
      // 页面栈只有一层（从分享卡片/工具卡直接进来的）→ 退回创作页
      await Taro.reLaunch({ url: GEN_PAGE });
    }
  };

  const deleteRow = async (item: Row) => {
    const ok = await confirmDialog({
      title: '删除这张作品',
      content: '删除后不可恢复（资产库里的同一条记录也会一起消失）。',
      confirmText: '删除',
      cancelText: '再想想',
    });
    if (!ok) return;
    const id = String(item.id || '');
    if (!id) return;
    try {
      await deleteRuntimeAsset(id);
      setItems((prev) => prev.filter((entry) => String(entry.id) !== id));
      toast('已删除', 'success');
    } catch (reason) {
      toast(reason instanceof Error ? reason.message : '删除失败，请稍后重试', 'error');
    }
  };

  const openActions = async (item: Row) => {
    const choices = ['保存到相册', '再次生成', '删除'];
    try {
      const result = await Taro.showActionSheet({ itemList: choices });
      if (result.tapIndex === 0) await saveRow(item);
      else if (result.tapIndex === 1) await regenerate(item);
      else if (result.tapIndex === 2) await deleteRow(item);
    } catch {
      // 用户取消
    }
  };

  const goCreate = async () => {
    try {
      await Taro.navigateBack();
    } catch {
      await Taro.reLaunch({ url: GEN_PAGE });
    }
  };

  return <View className='page gen-history-page' style={pageStyle}>
    <View className='mini-page-topbar'>
      <Text className='mini-page-heading'>我的作品</Text>
      <Text className='mini-page-caption'>生成的图片都收在这里，可保存、可再生成</Text>
    </View>

    {models.length > 0 && (
      <ScrollView className='gen-work-filters' scrollX enableFlex showScrollbar={false}>
        <View className='gen-chip-row'>
          <View
            className={`gen-chip ${filter === '' ? 'gen-chip-active' : ''}`}
            onClick={() => { if (filter) setFilter(''); }}
          >
            <Text className='gen-chip-text'>全部</Text>
          </View>
          {models.map((item) => (
            <View
              key={item.id}
              className={`gen-chip ${filter === item.id ? 'gen-chip-active' : ''}`}
              onClick={() => { if (filter !== item.id) setFilter(item.id); }}
            >
              <Text className='gen-chip-text'>{item.label}</Text>
            </View>
          ))}
        </View>
      </ScrollView>
    )}

    <PageState loading={loading} error={error} onRetry={() => void load(1, 'reset')} />

    {!loading && !error && items.length === 0 && (
      <View className='gen-work-empty'>
        <Text className='gen-work-empty-title'>还没有作品</Text>
        <Text className='gen-work-empty-desc'>
          {filter ? '这个模型下还没有生成过图片，换个筛选看看' : '去创作页描述一张画面，生成后就出现在这里'}
        </Text>
        <View className='gen-work-empty-btn' onClick={goCreate}><Text className='gen-work-empty-btn-text'>去生成第一张</Text></View>
      </View>
    )}

    {items.length > 0 && (
      <View className='gen-work-cols'>
        {columns.map((column, columnIndex) => (
          <View key={`col-${columnIndex}`} className='gen-work-col'>
            {column.map((item) => (
              <View key={String(item.id)} className='gen-work-card'>
                <Image
                  className='gen-work-img'
                  src={imageUrl(firstImageOf(item))}
                  mode='widthFix'
                  lazyLoad
                  onClick={() => previewRow(item)}
                />
                <View className='gen-work-bar'>
                  <Text className='gen-work-time'>{wallTime(item.createdAt)}</Text>
                  <Text className='gen-work-more' onClick={() => void openActions(item)}>⋯</Text>
                </View>
              </View>
            ))}
          </View>
        ))}
      </View>
    )}

    {items.length > 0 && (loadingMore || page >= totalPages) && (
      <View className='gen-work-more-hint'>
        <Text>{loadingMore ? '加载中…' : '没有更多了'}</Text>
      </View>
    )}

    <t-toast id='t-toast' theme='info' />
    <t-dialog id='t-dialog' title='' />
  </View>;
}
