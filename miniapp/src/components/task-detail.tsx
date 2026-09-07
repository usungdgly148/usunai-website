import Taro from '@tarojs/taro';
import { useState } from 'react';
import { Image, ScrollView, Text, Video, View } from '@tarojs/components';
import { TdIcon } from './td-icon';
import { formatAssetCost, formatAssetSource, formatDuration, formatTime, mediaFromAssetContent } from '../utils/asset-format';

/**
 * 任务详情弹窗：与网页端「我的资产 → 任务详情」Modal 结构对齐。
 *  - 头部：标题 + 关闭
 *  - 创建时间 + 任务名
 *  - 输入参数（inputs 键值对）
 *  - 运行结果：视频 / 图片（可预览）/ 原始输出文本
 *  - 底部：耗时 / 消耗 / 来源
 *  - 操作：复制结果 / 关闭
 */
export function TaskDetail({ asset, visible, onClose }: {
  asset: Record<string, unknown> | null;
  visible: boolean;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);

  const name = asset ? String(asset.name ?? asset.title ?? asset.taskName ?? '未命名任务') : '';
  const createdAt = asset?.createdAt ?? asset?.completedAt ?? asset?.updatedAt;
  const rawContent = asset?.content;
  const content = typeof rawContent === 'string'
    ? rawContent
    : rawContent === null || rawContent === undefined ? '' : String(rawContent);

  const inputs = (asset?.inputs && typeof asset.inputs === 'object' && !Array.isArray(asset.inputs))
    ? asset.inputs as Record<string, unknown>
    : {};
  const inputEntries = Object.entries(inputs)
    .map(([k, v]) => [k, v === null || v === undefined ? '' : (typeof v === 'object' ? JSON.stringify(v) : String(v))] as const)
    .filter(([, v]) => v !== '');

  const media = mediaFromAssetContent(content);
  const ownImages = Array.isArray(asset?.images) ? asset.images.map(String) : [];
  const ownVideos = Array.isArray(asset?.videos) ? asset.videos.map(String) : [];
  const images = [...new Set([...ownImages, ...media.images])];
  const videos = [...new Set([...ownVideos, ...media.videos])];

  const onCopy = () => {
    Taro.setClipboardData({ data: content })
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      })
      .catch(() => {});
  };

  const onPreviewImage = (current: string) => {
    if (!images.length) return;
    void Taro.previewImage({ urls: images, current });
  };

  return (
    <t-popup
      visible={visible && !!asset}
      placement='center'
      showOverlay
      closeOnOverlayClick
      onVisibleChange={(e: { detail?: { visible?: boolean } }) => {
        if (!e.detail?.visible) onClose();
      }}
    >
      <View className='mini-task-detail'>
        {/* 头部 */}
        <View className='mini-task-detail-head'>
          <Text className='mini-task-detail-title'>任务详情</Text>
          <Text className='mini-task-detail-close' onClick={onClose}>
            <TdIcon name='close' className='mini-task-detail-close-icon' />
          </Text>
        </View>

        {/* 主体（可滚动） */}
        <ScrollView className='mini-task-detail-body' scrollY>
          {asset && (
            <>
              <View className='mini-task-detail-intro'>
                <Text className='mini-task-detail-time'>{formatTime(createdAt) || '-'}</Text>
                <Text className='mini-task-detail-name'>{name}</Text>
              </View>

              {inputEntries.length > 0 && (
                <View className='mini-task-detail-section'>
                  <Text className='mini-task-detail-label'>输入参数</Text>
                  <View className='mini-task-detail-box'>
                    {inputEntries.map(([k, v]) => (
                      <View key={k} className='mini-task-detail-kv'>
                        <Text className='mini-task-detail-k'>{k}：</Text>
                        <Text className='mini-task-detail-v'>{v}</Text>
                      </View>
                    ))}
                  </View>
                </View>
              )}

              <View className='mini-task-detail-section'>
                <Text className='mini-task-detail-label'>运行结果</Text>

                {videos.map((src, i) => (
                  <Video
                    key={`v-${i}`}
                    src={src}
                    controls
                    className='mini-task-detail-video'
                    showFullscreenBtn={false}
                    showPlayBtn
                    enableProgressGesture={false}
                  />
                ))}

                {images.length > 0 && (
                  <View className='mini-task-detail-images'>
                    {images.map((src, i) => (
                      <Image
                        key={`i-${i}`}
                        src={src}
                        mode='widthFix'
                        className='mini-task-detail-image'
                        onClick={() => onPreviewImage(src)}
                      />
                    ))}
                  </View>
                )}

                {(images.length > 0 || videos.length > 0) && (
                  <Text className='mini-task-detail-sublabel'>原始输出</Text>
                )}

                <View className='mini-task-detail-box'>
                  <Text className='mini-task-detail-content' selectable userSelect>
                    {content || '无文本结果'}
                  </Text>
                </View>
              </View>

              <View className='mini-task-detail-footmeta'>
                <Text className='mini-task-detail-footmeta-item'>耗时：{formatDuration(asset.duration)}</Text>
                <Text className='mini-task-detail-footmeta-item'>消耗：{formatAssetCost(asset)}</Text>
                <Text className='mini-task-detail-footmeta-item'>来源：{formatAssetSource(asset)}</Text>
              </View>
            </>
          )}
        </ScrollView>

        {/* 底部操作 */}
        <View className='mini-task-detail-foot'>
          {content
            ? <Text className='mini-task-detail-copy' onClick={onCopy}>{copied ? '已复制' : '复制结果'}</Text>
            : null}
          <Text className='mini-task-detail-closebtn' onClick={onClose}>关闭</Text>
        </View>
      </View>
    </t-popup>
  );
}

export default TaskDetail;
