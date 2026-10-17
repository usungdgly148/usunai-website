import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { Button, Image, ScrollView, Text, Textarea, View } from '@tarojs/components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { useThemePage } from '../../hooks/use-theme-page';
import { generateImage, getImageGenConfig, getMe, isLoggedOut, saveRuntimeAsset } from '../../services/api';
import {
  buildImageAsset, formatFileSize, formatPoints, imageUrl, newImageRequestId, pickDefaultSelection, resolutionForModel, saveImageToAlbum,
} from '../../services/imageGen';
import type { ImageGenResult } from '../../types';
import { ensureEnoughPoints, handlePointsInsufficient } from '../../utils/points-gate';
import { toast } from '../../utils/feedback';
import { shareTargets } from '../../utils/share';

/**
 * 「AI 全能设计」小程序创作页（P0：文生图）。
 *
 * 与网页端 `/image-gen` 的关系：**配置、计费、模型、资产全部复用服务端**，
 * 本页只做交互层 —— 不写死任何点数、不另立一套扣费逻辑。
 *
 * P0 不含参考图（图生图）：那条路要先做「真压缩 + 10MB 单请求上限」，
 * 归到 P1；当前服务端已上架的模型里 Gemini 原生支持参考图，P1 直接补区块即可。
 */
const ASPECT_LABELS: Record<string, string> = {
  '1:1': '方形',
  '16:9': '横版',
  '9:16': '竖版',
  '4:3': '横版',
  '3:4': '竖版',
};

type AssetState = 'idle' | 'saving' | 'added';

export default function ImageGenPage() {
  const { pageStyle } = useThemePage();
  // 转发/分享：hook 必须写在页面源码里 —— Taro 逐页扫源码决定是否开启转发（见 utils/share.ts）
  const share = shareTargets({ title: 'AI全能设计' });
  useShareAppMessage(() => share.app);
  useShareTimeline(() => share.timeline);

  const state = useLoad(getImageGenConfig, []);
  const config = state.data;
  const models = config?.models || [];

  const [model, setModel] = useState('');
  const [resolution, setResolution] = useState('');
  const [aspect, setAspect] = useState('1:1');
  const [prompt, setPrompt] = useState('');
  const [points, setPoints] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<ImageGenResult | null>(null);
  const [assetState, setAssetState] = useState<AssetState>('idle');
  const [error, setError] = useState('');
  /**
   * 同步锁：`busy` 是 state，两次快速点击会在同一帧里都读到 false（setBusy 还没生效），
   * 那样会**发两次生图请求 = 扣两次点**。用 ref 做硬闸（与网页端同一处风险，这里直接堵死）。
   */
  const busyRef = useRef(false);

  // 配置到了再定默认值：默认模型/档位由后台决定，不在前端写死（与网页端同一套选择逻辑）
  useEffect(() => {
    if (!config) return;
    const picked = pickDefaultSelection(config);
    setModel((prev) => prev || picked.model);
    setResolution((prev) => prev || picked.resolution);
    setAspect((prev) => ((config.aspectRatios || []).includes(prev) ? prev : (config.aspectRatio || '1:1')));
  }, [config]);

  const refreshPoints = useCallback(async () => {
    if (isLoggedOut()) { setPoints(null); return; }
    try {
      const me = await getMe();
      setPoints(Number.isFinite(Number(me?.points)) ? Number(me.points) : null);
    } catch {
      // 未登录 / 网络抖动：不在这里拦，交给服务端那道 402（与对话、工作流门禁同口径）
    }
  }, []);

  useEffect(() => { void refreshPoints(); }, [refreshPoints]);
  // 从充值页 / 算力明细返回时余额可能变了，重新拉一次
  useDidShow(() => { void refreshPoints(); });

  // 单张实测 20~47 秒，上游没有进度接口 —— 只显示已等待秒数，绝不画假进度条
  useEffect(() => {
    if (!busy) { setElapsed(0); return undefined; }
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const currentModel = models.find((item) => item.id === model) || models[0] || null;
  const resolutions = currentModel?.resolutions || [];
  const price = resolutions.find((item) => item.value === resolution)?.points || 0;

  const pickModel = (nextId: string) => {
    if (busy || nextId === model) return;
    const entry = models.find((item) => item.id === nextId) || null;
    setModel(nextId);
    // 新模型不吃当前档位就落到它的第一档（每个模型的档位点数都可能不同）
    setResolution((prev) => resolutionForModel(entry, prev));
  };

  const startGenerate = async () => {
    if (busyRef.current) return;
    const text = prompt.trim();
    if (!text) { toast('请先描述你想要的画面', 'warning'); return; }
    if (!currentModel || !price) { toast('当前模型暂时不可用，请换一个模型', 'error'); return; }
    if (isLoggedOut()) {
      const confirm = await Taro.showModal({
        title: '请先登录',
        content: '登录后即可使用 AI 全能设计。',
        confirmText: '去登录',
        cancelText: '取消',
        confirmColor: '#2864ea',
      });
      if (confirm.confirm) void Taro.reLaunch({ url: '/pages/profile/index' });
      return;
    }
    // 算力预检：只在明确 0 点时拦，拿不到档案一律放行，交给服务端 402 兜底
    if (!(await ensureEnoughPoints())) return;
    // 预检是异步的 —— 必须在它**之后**再抢一次锁，否则连点两下会两条请求都过预检
    if (busyRef.current) return;
    busyRef.current = true;

    setBusy(true);
    setError('');
    setResult(null);
    setAssetState('idle');
    try {
      const data = await generateImage({
        prompt: text,
        model: currentModel.id,
        resolution,
        aspectRatio: aspect,
        // 一次点击一个 requestId；「再生成一张」走的是新的一次调用，天然换新值
        requestId: newImageRequestId(),
      });
      setResult(data);
      if (Number.isFinite(Number(data.points))) setPoints(Number(data.points));
      // 结果卡在页面下方，生成完直接滚过去（不让用户自己找）
      setTimeout(() => { void Taro.pageScrollTo({ selector: '#gen-result', duration: 300 }); }, 60);
    } catch (reason) {
      // 402 / 算力不足：服务端连上游都没调、也没扣费 —— 弹充值引导，不再叠一句红字
      if (await handlePointsInsufficient(reason, points === null ? undefined : points)) return;
      const code = String((reason as { code?: string } | null)?.code || '');
      const status = Number((reason as { statusCode?: number } | null)?.statusCode) || 0;
      if (code === 'AUTH_REQUIRED' || status === 401) {
        setError('登录已失效，请重新登录后再试');
      } else if (code === 'IMAGE_MODEL_UNAVAILABLE' || code === 'IMAGE_NOT_CONFIGURED') {
        setError('该模型暂时不可用，换一个模型试试');
      } else {
        // 失败自动退款是服务端的既有行为（见 /api/image-gen 的 catch 分支），可以放心这么写
        const message = reason instanceof Error ? reason.message : '生成失败，请稍后重试';
        setError(`${message}（本次失败不扣除算力）`);
      }
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  // 加入资产库：写入「图片」库（type='image'），与网页端 store.addAsset 同构 ——
  // 走 saveRuntimeAsset → /api/miniapp/v1/assets → 服务端转手写 /api/data/assets，
  // 所以这里加的图，网页端「我的资产 → 图片」立即可见。
  const addToAssets = async () => {
    if (!result || assetState !== 'idle') return;
    setAssetState('saving');
    try {
      await saveRuntimeAsset(buildImageAsset(result, prompt));
      setAssetState('added');
      toast('已加入「图片」资产库', 'success');
    } catch (reason) {
      setAssetState('idle');
      toast(reason instanceof Error ? reason.message : '加入资产库失败，请稍后重试', 'error');
    }
  };

  const onSaveAlbum = async () => {
    if (!result) return;
    try {
      const outcome = await saveImageToAlbum(result.url);
      if (outcome === 'saved') toast('已保存到相册', 'success');
    } catch {
      toast('保存失败，请稍后重试', 'error');
    }
  };

  const previewResult = () => {
    if (!result) return;
    const url = imageUrl(result.url);
    if (!url) return;
    void Taro.previewImage({ urls: [url], current: url });
  };

  return <View className='page gen-page' style={pageStyle}>
    {/* 标题行：算力胶囊右对齐，点进去看明细（余额是生成前最该被看见的信息） */}
    <View className='gen-topbar'>
      <View className='gen-topbar-main'>
        <Text className='gen-title'>AI全能设计</Text>
        <Text className='gen-caption'>描述画面，直接出图</Text>
      </View>
      <View className='gen-points' onClick={() => Taro.navigateTo({ url: '/pages/compute/index' })}>
        <View className='gen-points-icon ui-icon-power' />
        <Text className='gen-points-value'>{points === null ? '--' : formatPoints(points)}</Text>
        <Text className='gen-points-unit'>点</Text>
      </View>
    </View>

    <PageState loading={state.loading} error={state.error} onRetry={state.reload} />

    {!state.loading && !state.error && models.length === 0 && (
      <View className='gen-card gen-empty'>
        <Text className='gen-empty-title'>暂时没有可用的生图模型</Text>
        <Text className='gen-empty-desc'>平台正在配置模型，稍后再来看看。</Text>
      </View>
    )}

    {models.length > 0 && (<>
      {/* ① 参数区：模型 / 清晰度 / 比例 */}
      <View className='gen-card'>
        {models.length > 1 && (<>
          <Text className='gen-label'>模型</Text>
          <ScrollView className='gen-chips' scrollX enableFlex showScrollbar={false}>
            <View className='gen-chip-row'>
              {models.map((item) => (
                <View
                  key={item.id}
                  className={`gen-chip ${item.id === currentModel?.id ? 'gen-chip-active' : ''}`}
                  onClick={() => pickModel(item.id)}
                >
                  <Text className='gen-chip-text'>{item.label}</Text>
                </View>
              ))}
            </View>
          </ScrollView>
        </>)}

        <Text className='gen-label'>清晰度</Text>
        <View className='gen-segment'>
          {resolutions.map((item) => (
            <View
              key={item.value}
              className={`gen-segment-item ${item.value === resolution ? 'gen-segment-item-active' : ''}`}
              onClick={() => { if (!busy) setResolution(item.value); }}
            >
              <Text className='gen-segment-value'>{item.value}</Text>
              <Text className='gen-segment-points'>{item.points} 点</Text>
            </View>
          ))}
        </View>

        <Text className='gen-label'>画面比例</Text>
        <View className='gen-chip-wrap'>
          {(config?.aspectRatios || []).map((value) => (
            <View
              key={value}
              className={`gen-chip gen-chip-aspect ${value === aspect ? 'gen-chip-active' : ''}`}
              onClick={() => { if (!busy) setAspect(value); }}
            >
              <Text className='gen-chip-text'>{ASPECT_LABELS[value] || value}</Text>
              <Text className='gen-chip-sub'>{value}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ② 提示词 */}
      <View className='gen-card'>
        <View className='gen-label-row'>
          <Text className='gen-label gen-label-flat'>画面描述</Text>
          <Text className='gen-count'>{prompt.length}/2000</Text>
        </View>
        <Textarea
          className='gen-textarea'
          value={prompt}
          maxlength={2000}
          placeholder='例如：一张产品海报，暖色木桌，柔和窗光，浅景深'
          placeholderClass='gen-placeholder'
          disabled={busy}
          onInput={(event) => setPrompt(event.detail.value)}
        />
      </View>

      {/* ③ 生成中 / 失败 */}
      {busy && <View className='gen-waiting'>
        <View className='gen-waiting-dot' />
        <Text className='gen-waiting-text'>正在生成，已等待 {elapsed} 秒</Text>
        <Text className='gen-waiting-hint'>高分辨率通常需要 20~40 秒，请不要离开页面</Text>
      </View>}

      {!busy && error && <View className='gen-error'><Text className='gen-error-text'>{error}</Text></View>}

      {/* ④ 结果卡 */}
      {result && <View id='gen-result' className='gen-card gen-result'>
        <Text className='gen-label'>生成结果</Text>
        <Image className='gen-result-image' src={imageUrl(result.url)} mode='widthFix' onClick={previewResult} />
        <Text className='gen-result-meta'>
          {result.resolution || '-'} · {result.aspectRatio || '-'} · {formatFileSize(result.size)} · {result.chargedPoints} 点
        </Text>

        <View className='gen-result-actions'>
          <Button
            className={`gen-action gen-action-primary ${assetState === 'added' ? 'gen-action-done' : ''}`}
            disabled={assetState !== 'idle'}
            onClick={addToAssets}
          >
            {assetState === 'saving' ? '加入中…' : assetState === 'added' ? '✓ 已加入资产库' : '加入资产库'}
          </Button>
          <Button className='gen-action gen-action-secondary' onClick={onSaveAlbum}>保存到相册</Button>
        </View>

        {assetState === 'added' && (
          <View className='gen-result-hint' onClick={() => Taro.navigateTo({ url: '/pages/assets/index' })}>
            <Text className='gen-result-hint-text'>已加入「图片」资产库，去我的资产查看 ›</Text>
          </View>
        )}

        <View className='gen-result-again' onClick={startGenerate}>
          <Text className='gen-result-again-text'>再生成一张</Text>
        </View>
      </View>}

      {/* ⑤ 底部固定 CTA（含安全区） */}
      <View className='gen-cta-wrap'>
        <Button className='gen-cta' loading={busy} disabled={busy} onClick={startGenerate}>
          {busy ? `生成中 · 已等待 ${elapsed}s` : (price ? `开始生成 · ${price} 点` : '开始生成')}
        </Button>
      </View>
    </>)}

    <t-toast id='t-toast' theme='info' />
  </View>;
}
