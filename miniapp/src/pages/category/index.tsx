import Taro, { usePullDownRefresh, useRouter } from '@tarojs/taro';
import { useEffect, useMemo, useState } from 'react';
import { Text, View } from '@tarojs/components';
import { ContentCard } from '../../components/content-card';
import { MiniappTabBar } from '../../components/miniapp-tab-bar';
import { PageState } from '../../components/page-state';
import { ResilientImage } from '../../components/layout-blocks';
import { SearchBar, gotoGlobalSearch } from '../../components/search-bar';
import { useLoad } from '../../hooks/use-load';
import { getPublicContent, getMiniappLayout } from '../../services/api';
import type { ContentItem } from '../../types';
import { useThemePage } from '../../hooks/use-theme-page';

function isAllCategory(item: { id: string; key?: string; name?: string; label?: string }) {
  const key = String(item.key || item.id || '').toLowerCase();
  const name = String(item.label || item.name || '').trim();
  return key === 'all' || name === '全部';
}

function categoryRef(item: { id: string; key?: string }) {
  return String(item.key || item.id || '');
}

function matchesCategory(item: ContentItem, category: string) {
  if (!category || category.toLowerCase() === 'all') return true;
  return String(item.category || '') === category;
}

function matchesKeyword(item: ContentItem, normalized: string) {
  if (!normalized) return true;
  const haystack = [
    item.name,
    item.description || '',
    item.desc || '',
    item.category || '',
    (item.tags || []).join(' '),
  ].join(' ').toLowerCase();
  return haystack.includes(normalized);
}

export default function CategoryPage() {
  const { pageStyle } = useThemePage();
  const { params } = useRouter();
  // Taro 4 useRouter 不会自动 decodeURL，这里手动解一次并防御非法编码。
  const rawTitle = (() => {
    const raw = String(params.title || '');
    if (!raw) return '';
    try { return decodeURIComponent(raw); } catch { return raw; }
  })();
  const category = params.category || '';
  const type = params.type || '';
  const [keyword, setKeyword] = useState('');
  const state = useLoad(getPublicContent, []);
  usePullDownRefresh(async () => { await state.reload(); Taro.stopPullDownRefresh(); });

  // 「全部分类」浏览模式：不带 type/category 进入时，展示后台全部可见分类，点分类再进列表。
  const browseMode = !type && !category;
  const title = browseMode ? (rawTitle || '全部分类') : (rawTitle || '分类工具');
  const visibleCategories = (state.data?.categories || []).filter(
    (item) => !isAllCategory(item) && (item as { published?: boolean }).published !== false,
  );

  // 分类卡片背景图与首页一致：优先取 home layout 里 categories 区块配置的 categoryImages（按分类 key），
  // 其次是分类自身的 miniappImage。否则首页的 16:9 图卡（后台配图）与全部分类页会不一致。
  const [categoryImages, setCategoryImages] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!browseMode) return;
    let cancelled = false;
    getMiniappLayout('home')
      .then((layout) => {
        if (cancelled) return;
        const block = layout.blocks.find((b) => b.type === 'categories');
        if (block?.categoryImages) setCategoryImages(block.categoryImages);
      })
      .catch(() => { /* 兜底：无配图时走 fallback 色块 */ });
    return () => { cancelled = true; };
  }, [browseMode]);

  const normalized = keyword.trim().toLowerCase();
  const showAgents = type !== 'workflow';
  const showWorkflows = type !== 'agent';

  const { agents, workflows } = useMemo(() => {
    const allAgents = (state.data?.agents || []).filter((item) => matchesCategory(item, category));
    const allWorkflows = (state.data?.workflows || []).filter((item) => matchesCategory(item, category));
    return {
      agents: allAgents.filter((item) => matchesKeyword(item, normalized)),
      workflows: allWorkflows.filter((item) => matchesKeyword(item, normalized)),
    };
  }, [state.data, category, normalized]);

  const totalAll = (showAgents ? (state.data?.agents || []).filter((i) => matchesCategory(i, category)).length : 0)
    + (showWorkflows ? (state.data?.workflows || []).filter((i) => matchesCategory(i, category)).length : 0);
  const totalShown = (showAgents ? agents.length : 0) + (showWorkflows ? workflows.length : 0);
  const hasKeyword = normalized.length > 0;
  const filteredEmpty = hasKeyword && !state.loading && !state.error && totalShown === 0 && state.data;

  // 浏览模式：渲染全部分类卡片
  if (browseMode) {
    return (
      <View className='page mini-home-page mini-category-page' style={pageStyle}>
        <View className='mini-page-topbar'>
          <Text className='mini-page-heading'>{title}</Text>
          <Text className='mini-page-caption'>共 {visibleCategories.length} 个分类</Text>
        </View>
        <SearchBar
          className='mini-category-search'
          value={keyword}
          onInput={setKeyword}
          onSubmit={() => gotoGlobalSearch(keyword)}
          onTapIcon={() => gotoGlobalSearch(keyword)}
          onClear={() => setKeyword('')}
          placeholder='搜索智能体和工作流'
        />
        <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
        {state.data && (
          <View className='mini-category-nav'>
            {visibleCategories.map((item) => {
              const name = item.label || item.name || '分类';
              const image = categoryImages[categoryRef(item)] || item.miniappImage || '';
              return (
                <View
                  key={item.id}
                  className='mini-category-item'
                  onClick={() => Taro.navigateTo({
                    url: `/pages/category/index?category=${encodeURIComponent(item.key || item.id)}&title=${encodeURIComponent(name)}`,
                  })}
                >
                  {image
                    ? <ResilientImage className='mini-category-picture' src={image} width={640} height={480} lazyLoad />
                    : <View className='mini-category-fallback' />}
                  <View className='mini-category-cover'><Text className='mini-category-label'>{name}</Text></View>
                </View>
              );
            })}
          </View>
        )}
        <MiniappTabBar active='home' />
      </View>
    );
  }

  return (
    <View className='page mini-home-page mini-category-page' style={pageStyle}>
      <View className='mini-page-topbar'>
        <Text className='mini-page-heading'>{title}</Text>
        <Text className='mini-page-caption'>
          {hasKeyword ? `匹配 ${totalShown} / ${totalAll} 个工具` : `共 ${totalAll} 个工具`}
        </Text>
      </View>
      <SearchBar
        className='mini-category-search'
        value={keyword}
        onInput={setKeyword}
        onSubmit={() => gotoGlobalSearch(keyword)}
        onTapIcon={() => gotoGlobalSearch(keyword)}
        onClear={() => setKeyword('')}
        placeholder='在本分类中搜索 / 点搜索全站查找'
      />
      <PageState loading={state.loading} error={state.error} onRetry={state.reload} />
      {state.data && (
        <View className='mini-category-tools'>
          {showAgents && agents.length > 0 && (
            <View className='mini-category-tool-section'>
              <Text className='section-title'>智能体</Text>
              <View className='mini-content-grid'>
                {agents.map((item) => <ContentCard key={`agent-${item.id}`} item={item} type='agent' />)}
              </View>
            </View>
          )}
          {showWorkflows && workflows.length > 0 && (
            <View className='mini-category-tool-section'>
              <Text className='section-title'>工作流</Text>
              <View className='mini-content-grid'>
                {workflows.map((item) => <ContentCard key={`workflow-${item.id}`} item={item} type='workflow' />)}
              </View>
            </View>
          )}
          {filteredEmpty && (
            <View className='mini-category-filtered-empty'>
              <Text>本分类下没有匹配「{keyword.trim()}」的工具，点输入框右侧放大镜可全站搜索</Text>
            </View>
          )}
          {!hasKeyword && totalShown === 0 && (
            <View className='mini-category-empty'>
              <Text>该分类暂时还没有可用工具</Text>
            </View>
          )}
        </View>
      )}
      <MiniappTabBar active={type === 'workflow' ? 'workflows' : 'agents'} />
    </View>
  );
}
