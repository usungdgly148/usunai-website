import Taro, { useDidShow, useShareAppMessage, useShareTimeline } from '@tarojs/taro';
import { Button, Image, ScrollView, Text, Textarea, View } from '@tarojs/components';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PageState } from '../../components/page-state';
import { useLoad } from '../../hooks/use-load';
import { useThemePage } from '../../hooks/use-theme-page';
import { generateImage, getImageGenConfig, getMe, isLoggedOut, saveRuntimeAsset } from '../../services/api';
import {
  buildImageAsset, formatFileSize, formatPoints, imageUrl, newImageRequestId, pickDefaultSelection,
  pickReferenceImages, resolutionForModel, saveImageToAlbum, takeRegenerate, toApiRefImages, REF_IMAGE_MAX,
} from '../../services/imageGen';
import type { RefImage } from '../../services/imageGen';
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
// 比例**文案**表。可用哪些比例由服务端按模型下发（models[].aspectRatios），这里只管中文。
// 新增比例只需补一行；没写到的直接显示比值本身，不会崩。
const ASPECT_LABELS: Record<string, string> = {
  '1:1': '方形',
  '16:9': '横版',
  '9:16': '竖版',
  '4:3': '横版',
  '3:4': '竖版',
  '2:3': '竖版',
  '3:2': '横版',
  '21:9': '超宽',
  '1:4': '超长竖',
  '4:1': '超长横',
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
  /** 参考图（P1）：已压缩好的本地图，直接就是请求体要的 base64 */
  const [refs, setRefs] = useState<RefImage[]>([]);
  const [refBusy, setRefBusy] = useState(false);
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
  // 从充值页 / 算力明细返回时余额可能变了，重新拉一次；顺带接「再次生成」的回填
  // （作品墙写本地存储 → 返回本站 → 这里取一次即删，见 imageGen.ts 的 stashRegenerate）
  useDidShow(() => {
    void refreshPoints();
    const next = takeRegenerate();
    if (!next) return;
    setPrompt(next.prompt);
    if (next.model) setModel(next.model);
    if (next.resolution) setResolution(next.resolution);
    if (next.aspectRatio) setAspect(next.aspectRatio);
  });

  // 单张实测 20~47 秒，上游没有进度接口 —— 只显示已等待秒数，绝不画假进度条
  useEffect(() => {
    if (!busy) { setElapsed(0); return undefined; }
    const timer = setInterval(() => setElapsed((value) => value + 1), 1000);
    return () => clearInterval(timer);
  }, [busy]);

  const currentModel = models.find((item) => item.id === model) || models[0] || null;
  const resolutions = currentModel?.resolutions || [];
  /**
   * 实际生效的档位：`resolution` 可能来自「再次生成」的回填，而那个模型/档位可能已经下架。
   * 直接拿它渲染会出现「没有一个选中态 + CTA 显示 0 点/被禁用」。统一在这里归一化，
   * 渲染与请求都只用 effectiveResolution。
   */
  const effectiveResolution = resolutions.some((item) => item.value === resolution)
    ? resolution
    : (resolutions[0]?.value || '');
  const price = resolutions.find((item) => item.value === effectiveResolution)?.points || 0;
  /**
   * 可选比例：优先当前模型的 aspectRatios（gemini 系 10 个 / gpt-image 系 5 个）。
   * `aspect` 可能来自「再次生成」的回填，那个比例未必被当前模型支持（例如回填 21:9 却切到了
   * gpt-image），所以和 effectiveResolution 同一套思路做归一化 —— 否则会出现「没有选中态」，
   * 而请求发出去还会被服务端回落成方图。
   */
  const ratioOptions = (currentModel && Array.isArray(currentModel.aspectRatios) && currentModel.aspectRatios.length)
    ? currentModel.aspectRatios
    : (config?.aspectRatios || []);
  const effectiveAspect = ratioOptions.includes(aspect) ? aspect : (ratioOptions[0] || aspect);
  /** 参考图能力由服务端下发：gpt-image-* 走 OpenAI 创建接口，那条通道没有参考图入口 */
  const refsSupported = !currentModel || currentModel.supportsRefs !== false;

  const pickModel = (nextId: string) => {
    if (busy || nextId === model) return;
    const entry = models.find((item) => item.id === nextId) || null;
    setModel(nextId);
    // 新模型不吃当前档位就落到它的第一档（每个模型的档位点数都可能不同）
    setResolution((prev) => resolutionForModel(entry, prev));
    // 比例同理：gpt-image 系只有 5 个，从 21:9 切过去必须收敛，否则服务端会回落到方图
    const nextRatios = (entry && Array.isArray(entry.aspectRatios)) ? entry.aspectRatios : [];
    if (nextRatios.length) setAspect((prev) => (nextRatios.includes(prev) ? prev : nextRatios[0]));
    // 新模型不吃参考图就把已选的清掉：留着只会在提交时被服务端硬拒（IMAGE_REF_UNSUPPORTED）
    if (entry && entry.supportsRefs === false) setRefs([]);
  };

  /**
   * 选参考图：系统选图 → 逐张压缩到「最长边 1024 / 质量 80」→ 转 base64。
   * 服务端 `prepareReferenceImages` 只认 `{mimeType, data}` 对象（不认裸字符串），
   * 且单张 ≤2MB、最多 3 张、整包 ≤12MB —— 压缩是这条链路能不能跑通的前提。
   */
  const chooseRefs = async () => {
    if (busy || refBusy) return;
    if (!refsSupported) { toast('当前模型不支持参考图', 'warning'); return; }
    const remaining = REF_IMAGE_MAX - refs.length;
    if (remaining <= 0) { toast(`参考图最多 ${REF_IMAGE_MAX} 张`, 'warning'); return; }
    setRefBusy(true);
    try {
      const picked = await pickReferenceImages(remaining);
      if (picked.length) setRefs((prev) => [...prev, ...picked].slice(0, REF_IMAGE_MAX));
    } catch (reason) {
      const message = String((reason as { errMsg?: string } | null)?.errMsg || (reason instanceof Error ? reason.message : ''));
      // 用户点了取消不是错误，静默返回
      if (message && !/cancel/i.test(message)) {
        toast(message.includes('2MB') ? message : '图片处理失败，请换一张', 'error');
      }
    } finally {
      setRefBusy(false);
    }
  };

  const removeRef = (uid: string) => setRefs((prev) => prev.filter((item) => item.uid !== uid));

  const previewRef = (current: string) => {
    const urls = refs.map((item) => item.path);
    if (!urls.length) return;
    void Taro.previewImage({ urls, current });
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
        resolution: effectiveResolution,
        // 传归一化后的比例：`aspect` 可能残留上一个模型才支持的值（再次生成回填 / 切模型）
        aspectRatio: effectiveAspect,
        // 参考图只在模型支持且确实选了图时才带（服务端对 gpt-image-* 会硬拒）
        ...(refsSupported && refs.length ? { images: toApiRefImages(refs) } : {}),
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
        <View className='gen-sub-row'>
          <Text className='gen-caption'>描述画面，直接出图</Text>
          <Text className='gen-works-link' onClick={() => Taro.navigateTo({ url: '/pages/image-gen/history' })}>我的作品 ›</Text>
        </View>
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
      {/* ① 参考图（最上）：模型不支持时整块隐藏 —— gpt-image-* 那条通道没有参考图入口，
             留在界面上只会让用户传了图却被服务端拒（IMAGE_REF_UNSUPPORTED） */}
      {refsSupported && <View className='gen-card'>
        <View className='gen-label-row'>
          <Text className='gen-label gen-label-flat'>参考图</Text>
          <Text className='gen-count'>可选 · 最多 {REF_IMAGE_MAX} 张</Text>
        </View>
        <View className='gen-ref-grid'>
          {refs.map((item) => (
            <View key={item.uid} className='gen-ref-item'>
              <Image
                className='gen-ref-img'
                src={item.path}
                mode='aspectFill'
                onClick={() => previewRef(item.path)}
              />
              <View className='gen-ref-remove' onClick={() => removeRef(item.uid)}>
                <Text className='gen-ref-remove-text'>×</Text>
              </View>
            </View>
          ))}
          {refs.length < REF_IMAGE_MAX && (
            <View className={`gen-ref-add ${refBusy ? 'gen-ref-add-busy' : ''}`} onClick={chooseRefs}>
              <Text className='gen-ref-add-icon'>{refBusy ? '…' : '+'}</Text>
              <Text className='gen-ref-add-text'>{refBusy ? '处理中' : '添加'}</Text>
            </View>
          )}
        </View>
        <Text className='gen-ref-hint'>会先压到 1024px 内再上传，单张不超过 2MB</Text>
      </View>}

      {/* ② 画面描述 */}
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

      {/* ③ 参数区：模型 / 清晰度 / 画面比例（放最后：先让用户说清要什么，再决定花多少点） */}
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
              className={`gen-segment-item ${item.value === effectiveResolution ? 'gen-segment-item-active' : ''}`}
              onClick={() => { if (!busy) setResolution(item.value); }}
            >
              <Text className='gen-segment-value'>{item.value}</Text>
              <Text className='gen-segment-points'>{item.points} 点</Text>
            </View>
          ))}
        </View>

        <Text className='gen-label'>画面比例</Text>
        <View className='gen-chip-wrap'>
          {ratioOptions.map((value) => (
            <View
              key={value}
              className={`gen-chip gen-chip-aspect ${value === effectiveAspect ? 'gen-chip-active' : ''}`}
              onClick={() => { if (!busy) setAspect(value); }}
            >
              <Text className='gen-chip-text'>{ASPECT_LABELS[value] || value}</Text>
              <Text className='gen-chip-sub'>{value}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ④ 生成中 / 失败 */}
      {busy && <View className='gen-waiting'>
        <View className='gen-waiting-dot' />
        <Text className='gen-waiting-text'>正在生成，已等待 {elapsed} 秒</Text>
        <Text className='gen-waiting-hint'>高分辨率通常需要 20~40 秒，请不要离开页面</Text>
      </View>}

      {!busy && error && <View className='gen-error'><Text className='gen-error-text'>{error}</Text></View>}

      {/* ⑤ 结果卡 */}
      {result && <View id='gen-result' className='gen-card gen-result'>
        <Text className='gen-label'>生成结果</Text>
        <Image className='gen-result-image' src={imageUrl(result.url)} mode='widthFix' onClick={previewResult} />
        <Text className='gen-result-meta'>
          {result.resolution || '-'} · {result.aspectRatio || '-'} · {formatFileSize(result.size)} · {result.chargedPoints} 点
          {result.refImageCount > 0 ? ` · 参考图 ${result.refImageCount} 张` : ''}
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

      {/* ⑥ 底部固定 CTA（含安全区） */}
      <View className='gen-cta-wrap'>
        <Button className='gen-cta' loading={busy} disabled={busy} onClick={startGenerate}>
          {busy ? `生成中 · 已等待 ${elapsed}s` : (price ? `开始生成 · ${price} 点` : '开始生成')}
        </Button>
      </View>
    </>)}

    <t-toast id='t-toast' theme='info' />
  </View>;
}
