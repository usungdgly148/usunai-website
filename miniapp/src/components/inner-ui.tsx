import type { ReactNode } from 'react';
import Taro from '@tarojs/taro';
import { Image, Text, View } from '@tarojs/components';
import type { ContentItem } from '../types';
import { TdIcon } from './td-icon';

export function timeAgo(iso?: string) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  if (diff < 86400) return `今天 ${hh}:${mm}`;
  if (diff < 172800) return `昨天 ${hh}:${mm}`;
  if (diff < 604800) return `${Math.floor(diff / 86400)} 天前`;
  return `${d.getMonth() + 1}月${d.getDate()}日`;
}

/** 右侧滑出抽屉（TDesign t-popup 实现，placement=right，自带遮罩/滑入滑出动画） */
export function SideDrawer({ open, title, onClose, children }: {
  open: boolean; title: string; onClose: () => void; children: ReactNode;
}) {
  return (
    <t-popup
      visible={open}
      placement='right'
      showOverlay
      closeOnOverlayClick
      onVisibleChange={(e: { detail?: { visible?: boolean } }) => {
        if (!e.detail?.visible) onClose();
      }}
    >
      <View className='drawer-panel'>
        <View className='drawer-header'>
          <Text className='drawer-title'>{title}</Text>
          <Text className='drawer-close' onClick={onClose}><TdIcon name='close' /></Text>
        </View>
        <View className='drawer-body'>{children}</View>
      </View>
    </t-popup>
  );
}

/** 智能体/工作流信息卡（对齐网页端 InfoCard） */
export function EntityInfoCard({ entity, type }: { entity: ContentItem; type: 'agent' | 'workflow' }) {
  const tutorialImage = String(entity.tutorialImage || '').trim();
  const tutorialUrl = String(entity.tutorialUrl || '').trim();
  const priceText = typeof entity.priceRate === 'number'
    ? `${entity.priceRate} 点 / ${type === 'agent' ? '千 token' : '次'}`
    : '—';
  const usesText = typeof entity.uses === 'number' ? String(entity.uses) : '—';

  return <View className='info-card'>
    <View className='info-hero'>
      <View className='info-avatar-wrap'>
        <View className='info-avatar'>
          {entity.avatar
            ? <Image src={entity.avatar} mode='aspectFill' className='info-avatar-img' />
            : <Text className='info-avatar-char'>{(entity.name || '?').slice(0, 1)}</Text>}
        </View>
        <Text className='info-type-badge'>{type === 'agent' ? '智能体' : '工作流'}</Text>
      </View>
      <Text className='info-name'>{entity.name}</Text>
      {!!entity.desc && <Text className='info-desc'>{entity.desc}</Text>}
    </View>
    <View className='info-meta'>
      <View className='info-meta-row'>
        <Text className='info-meta-label'>单价</Text>
        <Text className='info-meta-value'>{priceText}</Text>
      </View>
      <View className='info-meta-row'>
        <Text className='info-meta-label'>使用次数</Text>
        <Text className='info-meta-value'>{usesText}</Text>
      </View>
    </View>
    {!!entity.tags?.length && <View className='tag-row'>{entity.tags.map((tag) => <Text key={tag} className='tag'>{tag}</Text>)}</View>}
    {!!tutorialImage && <View
      className='info-tutorial'
      onClick={() => {
        if (!tutorialUrl) return;
        const url = /^https?:\/\//i.test(tutorialUrl) ? tutorialUrl : `https://www.usunai.top${tutorialUrl}`;
        Taro.setClipboardData({ data: url });
      }}
    >
      <Image src={tutorialImage} mode='aspectFill' className='info-tutorial-img' />
      <Text className='info-tutorial-title'>{String(entity.tutorialTitle || '').trim() || '新手使用教程'}</Text>
    </View>}
  </View>;
}
