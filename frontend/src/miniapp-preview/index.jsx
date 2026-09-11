import React, { useEffect, useMemo, useState } from 'react';
import '../miniappPreview.css';
import './adapter.css';
// ⚠️ 直接 import 小程序真机那份渲染器 / 组件。画布「跟真机一致」不是靠肉眼比对，
//    而是构造性事实：改小程序组件，画布自动跟着变。
import { LayoutBlocks, featuredEntries, titles as BLOCK_TITLES, toolCardsOf } from '../../../miniapp/src/components/layout-blocks';
import { MiniappTabBar } from '../../../miniapp/src/components/miniapp-tab-bar';
import { onPreviewNavigate } from './taro';

/** 供后台属性面板复用：区块默认标题（唯一事实来源在 layout-blocks.tsx 的 titles） */
export const DEFAULT_TITLES = BLOCK_TITLES;
/** 供后台属性面板复用：推荐区「会显示哪些卡片」的口径（唯一事实来源在 layout-blocks.tsx） */
export { featuredEntries };
/** 供后台属性面板复用：「实用AI工具」哪些卡会真的显示（空图空字的卡不算） */
export { toolCardsOf };

/**
 * 内容兜底。与 miniapp/src/pages/home/index.tsx 的 normalizeContent 口径一致：
 * 渲染器直接 `.map` / `.filter` 这些数组，缺一个就是整页崩，先补平再交给它。
 */
const EMPTY_CONTENT = {
  agents: [], workflows: [], categories: [], categoryGroups: [], banners: [],
  announcements: [], recommended: [], computePackages: [], rechargeInfo: '',
  customerService: { enabled: false, qr: '', lines: [] },
};

export function normalizeContent(content) {
  if (!content || typeof content !== 'object') return EMPTY_CONTENT;
  return {
    ...EMPTY_CONTENT,
    ...content,
    agents: Array.isArray(content.agents) ? content.agents : [],
    workflows: Array.isArray(content.workflows) ? content.workflows : [],
    categories: Array.isArray(content.categories) ? content.categories : [],
    categoryGroups: Array.isArray(content.categoryGroups) ? content.categoryGroups : [],
    banners: Array.isArray(content.banners) ? content.banners : [],
    announcements: Array.isArray(content.announcements) ? content.announcements : [],
    recommended: Array.isArray(content.recommended) ? content.recommended : [],
  };
}

const PAGE_LABELS = {
  '/pages/home/index': '小程序首页',
  '/pages/announcements/index': '公告通知',
  '/pages/category/index': '分类列表',
  '/pages/search/index': '全局搜索',
  '/pages/chat/index': 'AI 智能体对话',
  '/pages/workflow/index': 'AI 工作流',
  '/pages/hot/index': '热门智能体 / 工作流',
  '/pages/profile/index': '我的',
  '/pages/compute/index': '算力记录',
  '/pages/assets/index': '我的资产',
  '/pages/orders/index': '订单记录',
  '/pages/bind/index': '绑定账号',
  '/pages/account-security/index': '账号与安全',
  '/pages/legal/index': '政策协议',
  '/pages/recharge/index': '算力充值',
  '/pages/service/index': '联系客服',
  '/pages/webview/index': '小程序内置浏览器',
};

function findName(id, content) {
  const hit = [...content.agents, ...content.workflows]
    .find((item) => String(item && item.id) === String(id));
  return hit ? String(hit.name || hit.id || '') : '';
}

/**
 * 把「点了会跳到的地址」翻译成一句人话。
 * 逐项跳转配得对不对，就靠这行字在画布上当场验 —— 不用发版上真机。
 */
export function describeTarget(url, content) {
  const raw = String(url || '');
  if (!raw) return '没有可跳转的目标';
  const [pathname, query = ''] = raw.split('?');
  const label = PAGE_LABELS[pathname] || pathname;
  const params = new URLSearchParams(query);
  const title = params.get('title') || '';
  const id = params.get('id') || '';
  const category = params.get('category') || '';
  const q = params.get('q') || '';
  if (id) {
    const name = findName(id, content);
    if (name) return `打开${label}「${name}」`;
    // 目标不在了：这是真正要抓的错，明确说出来
    return `打开${label}，但内容里已找不到 id=${id}（链接目标可能已下架）`;
  }
  if (title) return `打开${label}「${title}」`;
  if (category) return `打开${label}（分类 ${category}）`;
  if (q) return `打开${label}（关键词「${q}」）`;
  return `打开${label}`;
}

/**
 * 后台手机画布。
 *
 * 树结构与真机首页完全一致：`.page.mini-home-page` → 各区块 → `MiniappTabBar`。
 * 唯一的外挂是按区块加了一层框选壳（.miniapp-stage-block），它在正常流里不产生外边距，
 * 所以区块间距与真机一致（边距照样按正常流折叠）。
 */
export default function MiniappStage({
  layout,
  content,
  active = 'home',
  selectedId = '',
  onSelect,
  height = 680,
}) {
  const [readout, setReadout] = useState(null);
  const safeContent = useMemo(() => normalizeContent(content), [content]);

  useEffect(() => onPreviewNavigate((info) => setReadout({ ...info, at: Date.now() })), []);

  const blocks = (layout?.blocks || []).filter((block) => block.visible !== false);

  return <div className="miniapp-stage-shell">
    <div className="miniapp-stage" style={{ height }}>
      <div className="miniapp-stage-scroll">
        <view className="page mini-home-page">
          {blocks.map((block) => (
            <div
              key={block.id}
              className={`miniapp-stage-block${selectedId === block.id ? ' is-selected' : ''}`}
              onClick={() => onSelect?.(block.id)}
            >
              <span className="miniapp-stage-badge">{block.title || BLOCK_TITLES[block.type] || block.type}</span>
              {/* 一个区块喂一次渲染器：框选壳才能按区块套上去，而区块内部仍是真机那套组件与样式 */}
              <LayoutBlocks layout={{ ...layout, blocks: [block] }} content={safeContent} />
            </div>
          ))}
          <MiniappTabBar active={active} />
        </view>
      </div>
    </div>
    <p className={`miniapp-stage-readout${readout ? ' is-hit' : ''}`}>
      {readout
        ? `点击预览：${describeTarget(readout.url, safeContent)}`
        : '在画布上点卡片 / 分类 / 底部导航，这里会显示小程序里会跳到哪儿'}
    </p>
  </div>;
}
