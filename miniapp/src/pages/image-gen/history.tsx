import Taro, {
  useDidShow, usePullDownRefresh, useReachBottom, useShareAppMessage, useShareTimeline,
} from '@tarojs/taro';
import { Button, Image, ScrollView, Text, View } from '@tarojs/components';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { useThemePage } from '../../hooks/use-theme-page';
import { deleteRuntimeAsset, getImageGenConfig, getPagedRecords } from '../../services/api';
import {
  firstImageOf, imageUrl, saveImageToAlbum, shareThumbUrl, stashDetailAsset, stashRegenerate, takeWorksDirty,
  wallTime,
} from '../../services/imageGen';
import { confirmDialog, toast } from '../../utils/feedback';
import { shareTargets } from '../../utils/share';

/**
 * 「我的作品」—— AI全能设计 的生成记录墙（P1 + P2）。
 *
 * 数据源就是**资产库里的图片资产**（`category=image`），不另立一张表：
 * 网页端、小程序端、别处生成的图片资产全都在这一个池子里，天然跨端可见。
 *
 * 版式：两列瀑布（图片 mode='widthFix' 保持原比例）。不做真测量排版 —— 按奇偶分列已经够看，
 * 真要等高得先拿全部图片尺寸，收益不抵复杂度。
 *
 * P2 增补：点卡片进详情页、「管理」批量删除、分享卡带作品图。
 */
const PAGE_SIZE = 20;
const GEN_PAGE = '/pages/image-gen/index';
const IMAGE_CATEGORY = 'image';

type Row = Record<string, unknown>;

export default function ImageGenHistoryPage() {
  const { pageStyle } = useThemePage();

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
  // 批量管理：打开后点卡片是「选中」而不是「看详情」
  const [manageMode, setManageMode] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  // 分享卡配图用最近一张作品（比裸卡片好看）；落地页固定创作页
  // （好友看不到别人的资产，落详情页只会见到「作品不存在」）。
  const newestImage = items.length ? firstImageOf(items[0]) : '';
  const share = shareTargets({
    title: '我的作品',
    imageUrl: newestImage ? shareThumbUrl(newestImage) : '',
    path: GEN_PAGE,
  });
  useShareAppMessage(() => share.app);
  useShareTimeline(() => share.timeline);

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
  /**
   * 从详情页返回时，若那边删掉了作品就重拉一次。
   * ⚠️ 只在「有标记」时重拉 —— 无条件 onShow 重拉会把滚动位置和已加载的分页全清掉。
   * 标记是一次性的（takeWorksDirty 读完即删），所以不会连续触发。
   */
  useDidShow(() => {
    if (takeWorksDirty()) void load(1, 'reset');
  });
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
    const choices = ['查看大图', '保存到相册', '再次生成', '删除'];
    try {
      const result = await Taro.showActionSheet({ itemList: choices });
      if (result.tapIndex === 0) previewRow(item);
      else if (result.tapIndex === 1) await saveRow(item);
      else if (result.tapIndex === 2) await regenerate(item);
      else if (result.tapIndex === 3) await deleteRow(item);
    } catch {
      // 用户取消
    }
  };

  /** 点卡片：管理模式下是选中/取消，非管理模式进详情页 */
  const openRow = (item: Row) => {
    const id = String(item.id || '');
    if (!id) return;
    if (manageMode) {
      setSelected((prev) => (prev.includes(id) ? prev.filter((entry) => entry !== id) : [...prev, id]));
      return;
    }
    // 详情页要用整条记录（提示词可能 2000 字，塞不进 URL）：先快照，再只带 id 跳转
    stashDetailAsset(item);
    void Taro.navigateTo({ url: `/pages/image-gen/detail?id=${encodeURIComponent(id)}` });
  };

  const toggleManage = () => {
    setManageMode((prev) => !prev);
    setSelected([]);
  };

  const allSelected = items.length > 0 && selected.length === items.length;
  const toggleAll = () => {
    setSelected(allSelected ? [] : items.map((item) => String(item.id)));
  };

  /**
   * 批量删除：**串行**逐条删。
   * 服务端没有批量接口，而资产是「一个用户一个 JSON 数组」整把读改写 ——
   * 并发删除会互相覆盖（后写的把先写的复活），所以必须一条 await 到底再下一条。
   */
  const deleteSelected = async () => {
    if (!selected.length || busy) return;
    const ok = await confirmDialog({
      title: '批量删除',
      content: `确定删除选中的 ${selected.length} 张作品？删除后不可恢复。`,
      confirmText: '删除',
      cancelText: '取消',
    });
    if (!ok) return;
    setBusy(true);
    let failed = 0;
    for (const id of selected) {
      try { await deleteRuntimeAsset(id); } catch { failed += 1; }
    }
    setBusy(false);
    if (failed) toast(`${failed} 张删除失败，请重试`, 'error');
    else toast(`已删除 ${selected.length} 张`, 'success');
    setManageMode(false);
    setSelected([]);
    await load(1, 'reset');
  };

  const goCreate = async () => {
    try {
      await Taro.navigateBack();
    } catch {
      await Taro.reLaunch({ url: GEN_PAGE });
    }
  };

  return <View className={`page gen-history-page ${manageMode ? 'gen-history-page-manage' : ''}`} style={pageStyle}>
    <View className='gen-history-head'>
      <View className='gen-history-head-main'>
        <Text className='mini-page-heading'>我的作品</Text>
        <Text className='mini-page-caption'>生成的图片都收在这里，可保存、可再生成</Text>
      </View>
      {items.length > 0 && (
        <Text className='gen-history-manage' onClick={toggleManage}>{manageMode ? '完成' : '管理'}</Text>
      )}
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
            {column.map((item) => {
              const id = String(item.id);
              const isSelected = selected.includes(id);
              return (
                <View
                  key={id}
                  className={`gen-work-card ${manageMode && isSelected ? 'gen-work-card-active' : ''}`}
                  onClick={() => openRow(item)}
                >
                  <Image className='gen-work-img' src={imageUrl(firstImageOf(item))} mode='widthFix' lazyLoad />
                  {manageMode && (
                    <View className={`gen-work-check ${isSelected ? 'gen-work-check-on' : ''}`}>
                      <Text className='gen-work-check-text'>{isSelected ? '✓' : ''}</Text>
                    </View>
                  )}
                  {!manageMode && (
                    <View className='gen-work-bar'>
                      <Text className='gen-work-time'>{wallTime(item.createdAt)}</Text>
                      <Text
                        className='gen-work-more'
                        onClick={(event) => { event.stopPropagation(); void openActions(item); }}
                      >
                        ⋯
                      </Text>
                    </View>
                  )}
                </View>
              );
            })}
          </View>
        ))}
      </View>
    )}

    {items.length > 0 && (loadingMore || page >= totalPages) && (
      <View className='gen-work-more-hint'>
        <Text>{loadingMore ? '加载中…' : '没有更多了'}</Text>
      </View>
    )}

    {manageMode && (
      <View className='gen-manage-bar'>
        <View className='gen-manage-all' onClick={toggleAll}>
          <Text className='gen-manage-all-text'>{allSelected ? '取消全选' : '全选'}</Text>
        </View>
        <Button
          className='gen-manage-delete'
          disabled={!selected.length || busy}
          loading={busy}
          onClick={deleteSelected}
        >
          {selected.length ? `删除 (${selected.length})` : '删除'}
        </Button>
      </View>
    )}

    <t-toast id='t-toast' theme='info' />
    <t-dialog id='t-dialog' title='' />
  </View>;
}
