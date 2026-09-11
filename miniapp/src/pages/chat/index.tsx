import { useEffect, useMemo, useRef, useState } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { Button, Image, ScrollView, Text, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { EntityInfoCard, SideDrawer, timeAgo } from '../../components/inner-ui';
import { TdIcon } from '../../components/td-icon';
import { fetchAllRecords, getHistoryDetail, getMe, getPublicContent, saveRuntimeAsset, saveRuntimeHistory, streamAgentChat, uploadRuntimeFile } from '../../services/api';
import { collectMediaUrls, fileToDataUrl, runtimeId } from '../../services/runtime';
import { confirmDialog, hideFeedbackToast, loadingToast, toast } from '../../utils/feedback';
import { resolveEntityAvatar, toAvatarUrl, toMiniappUrl } from '../../utils/entity-visual';
import { subscribeKeyboardOffset } from '../../utils/keyboard';
import type { ContentItem } from '../../types';
import { useThemePage } from '../../hooks/use-theme-page';

type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; reasoning?: string; images?: string[]; createdAt?: string };
type HistoryRecord = Record<string, unknown> & { id?: string; title?: string; createdAt?: string; agentId?: string; messages?: Array<Record<string, unknown>> };
/** t-chat-sender / attachments 的文件结构（原样透传给官方组件，附带 uid 便于回删时定位） */
type AttachmentFile = { uid?: string; url?: string; name?: string; size?: number; fileType?: string };

/**
 * 待发送的图片草稿。
 * 官方 t-attachments 的加载态是「status 驱动」的：status 为 pending / fail / error 时
 * 不渲染 <image>，改为渲染 <t-loading theme="circular">。所以这里必须先把草稿以 pending
 * 入列，上传成功再切 success，失败切 error，否则用户看不到任何上传进度反馈。
 */
type UploadDraft = {
  /** 稳定标识：用于回删 / 预览定位（官方 remove 事件带 index，但重新渲染后 index 会漂） */
  uid: string;
  /** 展示地址：pending 阶段是本地临时路径（立刻可显示，无需等网络），成功后仍保留本地路径避免闪白 */
  url: string;
  /** 上传成功后拿到的远端地址（提交给对话接口用） */
  remote?: string;
  name: string;
  size: number;
  fileType: string;
  status: 'pending' | 'success' | 'error';
  progress?: number;
  errorMessage?: string;
};

const ASSET_TYPE_NAMES: Record<string, string> = { copy: '文案', image: '图片', video: '视频', audio: '音频', article: '文章' };
const sessionKey = (agentId?: string) => `usunai_miniapp_chat_session_${agentId || 'unknown'}`;
const MAX_IMAGES = 4;
/**
 * 官方 t-chat-sender 的预设区：只保留官方发送按钮（右下角）。
 * 加号不用官方内置的 upload 预设——它只能单张取图，且弹层从卡片底部展开；
 * 这里自绘一个加号浮在卡片左下角，走系统 action-sheet + chooseMedia（一次最多 4 张）。
 */
const SENDER_PRESETS = [{ name: 'send', type: 'icon' }];
/**
 * textareaProps.autosize 的数字会被组件内 wxs 追加 rpx（写成 400 就是 400rpx）。
 * 官方默认 maxHeight 264rpx，配合 48rpx 行高 + 16rpx 内边距 ≈ 只能显示 5 行；
 * 这里放到 400rpx = 8 行（8 × 48 + 16），让长文字自适应到 8 行再内部滚动。
 * 外层 `.t-chat-sender__textarea` 自带的 max-height: 280rpx 也要一起放宽（见 app.scss）。
 */
const SENDER_TEXTAREA_PROPS = { autosize: { minHeight: 44, maxHeight: 400 } };
/** 官方 chat-actionbar 的动作项；iconMap 只认这 6 个固定动作，自定义动作（加入资产库）只能自绘并排拼条 */
const MESSAGE_ACTIONS = ['copy', 'replay', 'good', 'bad'];

/**
 * 开场白交给官方 `t-chat-markdown` 的解析选项（直传 marked 的 Lexer）。
 *
 * ⚠️ `breaks` 必须显式写成 false —— 这条很反直觉，是查官方源码 + wxss 才定下来的：
 *   · breaks:true  → marked 把软换行吐成独立的 `br` 节点，
 *                    而 chat-markdown-node.wxml 渲染成 `<view class="…-br">`，
 *                    官方 wxss 里**根本没有 `.t-chat-markdown-br` 这条规则**（0 高度）→ 换行凭空消失；
 *   · breaks:false → 软换行以 `\n` 留在 text 节点里，微信 `<text>` 会正常折行。
 * 运营在后台写开场白几乎都是「一行一句」，所以这里必须是 false。
 *
 * 模块级常量：引用恒定，避免每次渲染都给自定义组件塞新对象而触发无谓的 setData。
 */
const OPENING_MARKDOWN_OPTIONS = { gfm: true, breaks: false };

/**
 * 流式光标 ▋ 的开关（喂给官方 chat-message 的 `chatContentProps.markdown`）。
 *
 * 官方 chat-message 的 props 里**没有** markdownProps，它的 wxml 也没把 markdownProps
 * 透传给 chat-content —— 所以官方文档上的 `streaming` 能力从消息链路根本走不到。
 * `postbuild-chat-markdown-streaming.js` 在产物 wxml 里补了一行透传
 * （`markdownProps="{{chatContentProps.markdown}}"`），这里才能生效。
 * `completeSyntax` 在 tdesign-miniprogram@1.16.0 的实现里并未被读取，故不传。
 */
const STREAMING_MARKDOWN_PROPS = { markdown: { streaming: { hasNextChunk: true, tail: true } } };

/** 消息时间戳：当天只显示 HH:mm，跨天补上 MM-DD */
function formatStamp(iso?: string) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value: number) => String(value).padStart(2, '0');
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  const now = new Date();
  return date.toDateString() === now.toDateString() ? time : `${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}`;
}

/** ChatMessage → t-chat-message 的 content 数组（attachment/thinking/markdown） */
function toTDesignContent(message: ChatMessage, streaming: boolean) {
  const content: Array<Record<string, unknown>> = [];
  if (message.role === 'user') {
    if (message.images?.length) {
      content.push({
        type: 'attachment',
        data: message.images.map((url) => ({ fileType: 'image', name: 'image.jpg', size: 0, url, status: 'success' })),
      });
    }
    if (message.text) content.push({ type: 'text', data: message.text });
  } else {
    if (message.reasoning) content.push({ type: 'thinking', data: { title: '思考过程', text: message.reasoning } });
    content.push({ type: 'markdown', data: message.text || (streaming ? '正在生成…' : '') });
  }
  return content;
}

export default function ChatPage() {
  const { pageStyle } = useThemePage();
  const { params } = useRouter();
  const agentId = params.id;
  const [agent, setAgent] = useState<ContentItem>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  /** 待发送图片草稿（含上传状态，驱动官方 t-attachments 的加载态） */
  const [drafts, setDrafts] = useState<UploadDraft[]>([]);
  const [uploading, setUploading] = useState(false);
  /** 输入框聚焦（编辑态）：蓝色描边 + 淡光晕的视觉反馈 */
  const [focused, setFocused] = useState(false);
  /** 软键盘高度（px）：键盘弹起时页面整体收窄，避免底部按钮/提示被遮挡 */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  /** 用户头像/昵称（聊天气泡的 role=user 侧） */
  const [userName, setUserName] = useState('我');
  const [userAvatar, setUserAvatar] = useState('');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [sessionId, setSessionId] = useState(() => {
    const stored = agentId ? Taro.getStorageSync<string>(sessionKey(agentId)) : '';
    return stored || runtimeId('miniapp_chat');
  });

  useEffect(() => {
    if (agentId) Taro.setStorageSync(sessionKey(agentId), sessionId);
  }, [agentId, sessionId]);

  useEffect(() => {
    getPublicContent().then((content) => {
      const item = content.agents.find((entry) => entry.id === agentId);
      if (!item) throw new Error('智能体不存在或未上架');
      setAgent(item);
    }).catch((reason) => setError(reason.message || '加载失败')).finally(() => setLoading(false));
  }, [agentId]);

  // 用户身份只用于消息体的头像/昵称，失败不影响对话
  useEffect(() => {
    getMe().then((profile) => {
      if (profile.name) setUserName(profile.name);
      setUserAvatar(toAvatarUrl(profile.avatar));
    }).catch(() => {});
  }, []);

  /**
   * 键盘遮挡：页面是 height:100vh + overflow:hidden 的 flex 布局，软键盘弹起时不会自动让位，
   * 底部的加号、发送按钮和提示行会被键盘盖住。这里监听键盘高度，把页面高度收窄到键盘上方。
   * 注意 `.runtime-page` 带 min-height:100vh，min-height 会压过 height，所以内联里必须一并归零。
   * 让位高度由 `subscribeKeyboardOffset` 统一给出（内部已处理 Android「键盘压缩 webview」的重复让位）。
   */
  useEffect(() => subscribeKeyboardOffset(setKeyboardHeight), []);

  /**
   * 加号上传：官方内置弹层只能单张取图，这里自建「拍摄 / 从相册选择」并支持一次多选。
   * 加载态：每张图先以 pending 草稿入列（官方 attachments 渲染转圈），逐张上传完成后切 success，
   * 失败切 error + errorMessage，用户能逐张看到进度/失败原因并单独删除重试。
   */
  const chooseImage = async () => {
    if (!agent || !agent.supportsImages || uploading) return;
    const remaining = MAX_IMAGES - drafts.length;
    if (remaining <= 0) { toast(`最多上传 ${MAX_IMAGES} 张图片`, 'warning'); return; }
    let sourceType: Array<'album' | 'camera'> = ['album', 'camera'];
    try {
      const sheet = await Taro.showActionSheet({ itemList: ['拍摄', '从相册选择'] });
      sourceType = sheet.tapIndex === 0 ? ['camera'] : ['album'];
    } catch { return; }
    let tempFiles: Array<{ tempFilePath: string; size?: number }> = [];
    try {
      const selected = await Taro.chooseMedia({ count: remaining, mediaType: ['image'], sourceType });
      tempFiles = selected.tempFiles as unknown as Array<{ tempFilePath: string; size?: number }>;
    } catch (reason) {
      const errMsg = String((reason as { errMsg?: string } | undefined)?.errMsg || '');
      if (!/cancel/i.test(errMsg)) toast('选择图片失败', 'error');
      return;
    }
    const stamp = Date.now();
    const queued: UploadDraft[] = tempFiles.map((file, index) => ({
      uid: runtimeId('upload'),
      url: file.tempFilePath,
      name: `image_${stamp}_${index}.jpg`,
      size: Number(file.size) || 0,
      fileType: 'image',
      status: 'pending',
      progress: 0,
    }));
    setDrafts((current) => [...current, ...queued].slice(0, MAX_IMAGES));
    setUploading(true);
    let failures = 0;
    try {
      for (const draft of queued) {
        try {
          const dataUrl = await fileToDataUrl(draft.url, 'image/jpeg');
          setDrafts((current) => current.map((item) => (item.uid === draft.uid ? { ...item, progress: 50 } : item)));
          const uploaded = await uploadRuntimeFile({
            targetType: 'agent',
            targetId: agent.id,
            dataUrl,
            fileName: draft.name,
            fileType: 'image/jpeg',
          });
          const remote = uploaded.dataUrl ? toMiniappUrl(uploaded.dataUrl) : '';
          if (!remote) throw new Error('上传失败，请重试');
          setDrafts((current) => current.map((item) => (item.uid === draft.uid
            ? { ...item, status: 'success', progress: 100, remote }
            : item)));
        } catch (reason) {
          failures += 1;
          const message = reason instanceof Error ? reason.message : '图片上传失败';
          setDrafts((current) => current.map((item) => (item.uid === draft.uid
            ? { ...item, status: 'error', errorMessage: message }
            : item)));
        }
      }
      // 图片失败态在官方 attachments 里只显示转圈（不展示 errorMessage），补一次聚合提示
      if (failures) toast(`${failures} 张图片上传失败，请删除后重试`, 'error');
    } finally { setUploading(false); }
  };

  /** 官方 t-attachments 的删除：只回传被删项，优先按 uid 定位，退回按 url 匹配 */
  const removeImage = (event: { detail?: { file?: AttachmentFile } }) => {
    const file = event?.detail?.file;
    if (!file) return;
    const uid = String(file.uid || '');
    const url = String(file.url || '');
    setDrafts((current) => current.filter((item) => (uid ? item.uid !== uid : item.url !== url)));
  };

  const runTurn = async (userMessage: ChatMessage, baseMessages: ChatMessage[]) => {
    if (!agent) return;
    const snapshot = [...baseMessages, userMessage];
    const assistantId = runtimeId('msg');
    setMessages([...snapshot, { id: assistantId, role: 'assistant', text: '', createdAt: new Date().toISOString() }]);
    setInput(''); setDrafts([]); setSending(true); setError('');
    let answer = ''; let reasoning = '';
    try {
      await streamAgentChat(agent.id, {
        message: userMessage.text,
        sessionId,
        billingMessage: userMessage.text,
        history: baseMessages.map((item) => ({ role: item.role, content: item.text })),
        billingHistory: baseMessages.map((item) => ({ role: item.role, content: item.text })),
        attachments: userMessage.images?.map((url) => ({ kind: 'image', url, name: 'image.jpg', type: 'image/jpeg' })) || [],
      }, ({ event, data }) => {
        const packet = data as { type?: string; content?: { answer?: string; reasoning?: string; error?: string }; error?: string };
        if (event === 'error' || packet.type === 'error') throw new Error(packet.content?.error || packet.error || '智能体调用失败');
        answer += packet.content?.answer || '';
        reasoning += packet.content?.reasoning || '';
        setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, text: answer, reasoning } : item));
      });
      const finalText = answer || '(智能体未返回内容，请联系管理员检查该智能体的发布配置)';
      setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, text: finalText, reasoning: reasoning || undefined } : item));
      const firstPrompt = [...baseMessages, userMessage].find((item) => item.role === 'user' && item.text.trim())?.text;
      try {
        await saveRuntimeHistory({
          id: sessionId,
          type: 'agent',
          agentId: agent.id,
          title: (firstPrompt || '图片对话').slice(0, 60),
          createdAt: new Date().toISOString(),
          messages: [...snapshot, { id: assistantId, role: 'assistant' as const, text: finalText, reasoning: reasoning || undefined }],
        });
      } catch { /* 历史落库失败不阻断对话 */ }
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '智能体调用失败';
      setError(message);
      setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, text: item.text || `调用失败：${message}` } : item));
    } finally { setSending(false); }
  };

  const send = (override?: string) => {
    const text = String(override ?? input).trim();
    if (!agent || sending) return;
    if (uploading) { toast('图片上传中，请稍候…', 'warning'); return; }
    const readyImages = drafts.filter((item) => item.status === 'success' && item.remote).map((item) => item.remote as string);
    if (!text && !readyImages.length) {
      if (drafts.some((item) => item.status === 'error')) toast('有图片上传失败，请删除后重试', 'warning');
      return;
    }
    void runTurn({ id: runtimeId('msg'), role: 'user', text, images: readyImages, createdAt: new Date().toISOString() }, messages);
  };

  const regenerate = (assistantId: string) => {
    if (sending) return;
    const index = messages.findIndex((item) => item.id === assistantId);
    if (index < 0) return;
    let userIdx = -1;
    for (let i = index - 1; i >= 0; i -= 1) {
      if (messages[i].role === 'user') { userIdx = i; break; }
    }
    if (userIdx < 0) return;
    const userMessage = { ...messages[userIdx], id: runtimeId('msg'), createdAt: new Date().toISOString() };
    void runTurn(userMessage, messages.slice(0, userIdx));
  };

  /** 官方 chat-actionbar 的动作回调：copy 由组件内部完成复制，这里只做反馈/重生成 */
  const handleMessageAction = (event: { detail?: { name?: string } }, message: ChatMessage) => {
    const name = String(event?.detail?.name || '');
    if (name === 'copy') { toast('已复制到剪贴板', 'success'); return; }
    if (name === 'replay') { regenerate(message.id); return; }
    if (name === 'good') { toast('感谢反馈～', 'success'); return; }
    if (name === 'bad') { toast('收到，会继续改进', 'info'); }
  };

  /**
   * 官方 chat-markdown 的节点点击。
   *
   * 官方规范里 markdown 内容**自己不开链接**：所有节点都绑了 `bindtap="nodeClick"`，
   * 一路 triggerEvent 成 `click({ event, node })`，由业务决定行为（文档示例就是自己调
   * wx.previewImage）。这条链路是 chat-markdown → chat-content → chat-message 逐层 re-emit，
   * 以前我们没接 bind:click，所以 AI 回复里的链接/图片**点了完全没反应**。
   *
   * node.type 取值见 chat-markdown-node.wxml 的 wx:elif 分支；注意它**对每种节点都触发**
   * （段落/标题/空行都会来一发），所以非 image/link 一律直接返回。
   */
  const handleMarkdownNode = (event: { detail?: { node?: { type?: string; href?: string; text?: string } } }) => {
    const node = event?.detail?.node;
    if (!node || typeof node !== 'object') return;
    const href = typeof node.href === 'string' ? node.href.trim() : '';
    if (!href) return;

    if (node.type === 'image') {
      // 官方文档示例口径：图片节点自己调预览
      void Taro.previewImage({ urls: [href], current: href });
      return;
    }
    if (node.type !== 'link') return;

    // https 走站内 webview 页（与布局区块 / 内容卡的外链同一套跳转口径）
    if (/^https:\/\//i.test(href)) {
      void Taro.navigateTo({ url: `/pages/webview/index?url=${encodeURIComponent(href)}` });
      return;
    }
    // 其余（http、相对路径、mailto: 等小程序打不开的形态）复制到剪贴板，至少不把链接弄丢
    void Taro.setClipboardData({ data: href }).then(() => toast('已复制链接', 'success'));
  };

  const startNewChat = async () => {
    if (sending) return;
    if (messages.length && !(await confirmDialog({
      title: '开始新对话',
      content: '当前对话已自动保存到历史记录，确定开始新对话吗？',
      confirmText: '开始新对话',
    }))) return;
    setMessages([]); setInput(''); setDrafts([]); setError('');
    setSessionId(runtimeId('miniapp_chat'));
    setHistoryOpen(false);
  };

  const openHistory = () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    // 列表阶段只拉轻量元数据（服务端已剥离 messages 等大字段），正文在 selectHistory 点开时按 id 加载。
    fetchAllRecords('history').then((items) => {
      setHistoryList(items.filter((item) => item.agentId === agentId) as HistoryRecord[]);
      setHistoryLoading(false);
    }).catch(() => {
      setHistoryLoading(false);
      toast('历史记录加载失败', 'error');
    });
  };

  const selectHistory = async (record: HistoryRecord) => {
    if (sending) return;
    const id = String(record.id || '');
    if (!id) { toast('该记录无效', 'warning'); return; }
    loadingToast('加载中…');
    try {
      const detail = await getHistoryDetail(id);
      hideFeedbackToast();
      // 兼容两种消息结构：小程序自写 {role,text} 与网页端 {role,content}
      const raw = Array.isArray(detail.messages) ? detail.messages : [];
      const stamp = (detail as { createdAt?: string }).createdAt;
      const msgs: ChatMessage[] = raw
        .filter((m) => m && typeof m === 'object' && (typeof m.text === 'string' || typeof m.content === 'string'))
        .map((m) => ({
          id: typeof m.id === 'string' ? m.id : runtimeId('msg'),
          role: m.role === 'assistant' ? 'assistant' : 'user',
          text: typeof m.text === 'string' ? m.text : String(m.content || ''),
          reasoning: typeof m.reasoning === 'string' ? m.reasoning : undefined,
          images: Array.isArray(m.images) ? (m.images as string[]) : undefined,
          createdAt: typeof m.createdAt === 'string' ? m.createdAt : stamp,
        }));
      setMessages(msgs);
      if (detail.id) setSessionId(String(detail.id));
      setError('');
      setHistoryOpen(false);
    } catch (reason) {
      hideFeedbackToast();
      toast(reason instanceof Error ? reason.message : '历史记录加载失败', 'error');
    }
  };

  const addAsset = async (message: ChatMessage) => {
    if (!agent) return;
    const found = collectMediaUrls(message.text);
    const type = agent.assetCategory || (found.videos.length ? 'video' : found.images.length ? 'image' : 'copy');
    try {
      await saveRuntimeAsset({
        id: runtimeId('asset'),
        name: `${agent.name} · ${ASSET_TYPE_NAMES[type] || '结果'}`,
        type,
        content: message.text,
        images: found.images,
        videos: found.videos,
        source: `agent:${agent.id}`,
        createdAt: new Date().toISOString(),
      });
      toast(`已加入「${ASSET_TYPE_NAMES[type] || '结果'}」资产库`, 'success');
    } catch (reason) { toast(reason instanceof Error ? reason.message : '保存失败', 'error'); }
  };

  const suggestions = useMemo(() => (agent?.suggestedQuestions || []).filter((item) => typeof item === 'string' && item.trim()).slice(0, 6), [agent]);
  /**
   * 官方 t-attachments 的预览数据：发送前已上传的图片缩略图 + 可删除。
   * status 必须是 'pending' | 'success' | 'error' 之一——组件按它决定渲染转圈还是缩略图。
   */
  const attachmentsProps = useMemo(
    () => ({
      items: drafts.map((draft) => ({
        uid: draft.uid,
        url: draft.url,
        name: draft.name,
        size: draft.size,
        fileType: draft.fileType,
        status: draft.status,
        progress: draft.progress,
        errorMessage: draft.errorMessage,
      })),
      removable: true,
      imageViewer: true,
    }),
    [drafts],
  );
  /**
   * 智能体头像：有真头像用图片，没有（线上 32 个智能体里 18 个 avatar 为空）则退化成图标字形色块。
   * 注意 agent.icon 是 lucide 图标名而不是图片地址，不能直接丢给 <Image>。
   */
  const agentAvatar = useMemo(() => resolveEntityAvatar(agent, 'agent'), [agent]);
  /** 官方发送按钮在「有图无字」时是 disabled，这里补一个兜底入口（上传中不出现，避免和加载态打架） */
  const imageOnlyReady = drafts.some((item) => item.status === 'success' && item.remote) && !input.trim() && !sending && !uploading;
  /** 有草稿正在上传：加号置忙，避免重复触发系统选择器 */
  const uploadingAny = uploading || drafts.some((item) => item.status === 'pending');
  /** 键盘弹起时页面收窄到键盘上方（内联样式里的 px 会被微信按逻辑像素处理，不需转 rpx） */
  const pageHeightStyle = keyboardHeight ? `height:calc(100vh - ${keyboardHeight}px);min-height:0` : '';
  const rootStyle = [pageStyle, pageHeightStyle].filter(Boolean).join(';');

  /** 头像元素：图片优先，缺头像时用「图标字形 + 渐变底色块」兜底 */
  const renderAvatar = (size: 'header' | 'message') => (agentAvatar.url
    ? <Image className={`${size}-avatar-img`} src={agentAvatar.url} mode='aspectFill' lazyLoad webp />
    : <View className={`${size}-avatar-img ${size}-avatar-fallback`} style={{ background: agentAvatar.background }}>
      <Text className={`${size}-avatar-glyph`}>{agentAvatar.glyph}</Text>
    </View>);

  return <View className={`runtime-page chat-page${keyboardHeight ? ' chat-page-kb' : ''}`} style={rootStyle}>
    <PageState loading={loading} error={error && !agent ? error : ''} empty={!loading && !error && !agent} />
    {agent && <>
      <View className='runtime-header header-row'>
        <View className='header-main'>
          <View className='header-avatar'>{renderAvatar('header')}</View>
          <View className='header-titles'>
            <Text className='card-title'>{agent.name}</Text>
            <Text className='muted'>AI 智能体 · 实时对话</Text>
          </View>
        </View>
        <View className='header-actions'>
          <Text className='header-icon-btn' onClick={openHistory}><TdIcon name='time' /></Text>
          <Text className='header-icon-btn' onClick={() => setInfoOpen(true)}><TdIcon name='info-circle' /></Text>
        </View>
      </View>
      <ScrollView className='chat-scroll' scrollY scrollIntoView={messages.length ? `message-${messages[messages.length - 1].id}` : undefined}>
        {agent.opening && messages.length === 0 && (
          <ScrollView className='chat-opening-scroll' scrollY>
            {/* 开场白与助手消息**同一套渲染**（官方 t-chat-markdown）：
                不再自绘气泡 —— 官方 variant='base' 的 assistant 消息本身就是「透明底 + 零内边距」，
                这里沿用同一排布（头像 + 无气泡正文），否则会出现「一条有气泡一条没有」。
                外层 ScrollView 保留：长开场白不能把输入框顶出屏幕。 */}
            <View className='chat-row chat-row-assistant chat-opening-row'>
              <View className='message-avatar chat-opening-avatar'>{renderAvatar('message')}</View>
              <View className='chat-row-body'>
                <t-chat-markdown content={agent.opening} options={OPENING_MARKDOWN_OPTIONS} />
              </View>
            </View>
          </ScrollView>
        )}
        {!!suggestions.length && messages.length === 0 && !sending && <View className='suggestion-row'>
          <Text className='suggestion-caption'>试试这样问 · 点击直接发送</Text>
          {suggestions.map((item) => <Text key={item} className='suggestion-chip' onClick={() => send(item)}>{item}</Text>)}
        </View>}
        {messages.map((message) => {
          const isLast = message.id === messages[messages.length - 1].id;
          const streaming = sending && message.role === 'assistant' && isLast;
          const showActions = message.role === 'assistant' && !!message.text && !streaming;
          return (
            <View id={`message-${message.id}`} key={message.id} className={`chat-row chat-row-${message.role}`}>
              {/* 智能体头像自绘：官方 chat-message 的 avatar 只接受图片地址，缺头像的智能体没有兜底，
                  这里在气泡左侧自己画一个（用户侧仍用官方头像，两边保持同一基线） */}
              {message.role === 'assistant' && <View className='message-avatar'>{renderAvatar('message')}</View>}
              <View className='chat-row-body'>
                {/* 官方消息体：头像 + 昵称 + 时间 + 内容（user/assistant 双角色） */}
                <t-chat-message
                  content={toTDesignContent(message, streaming)}
                  role={message.role}
                  placement={message.role === 'user' ? 'right' : 'left'}
                  variant='base'
                  status={message.role === 'assistant' ? (streaming ? 'streaming' : 'complete') : undefined}
                  avatar={message.role === 'user' ? userAvatar : undefined}
                  name={message.role === 'user' ? (userName || '我') : agent.name}
                  datetime={formatStamp(message.createdAt)}
                  /* 流式光标：官方 chat-message 默认不透传这个属性，
                     由 postbuild-chat-markdown-streaming.js 在产物里补了一行 markdownProps 透传。
                     只在真正流式的最后一条上给，否则历史消息尾巴上也会挂光标。 */
                  chatContentProps={streaming ? STREAMING_MARKDOWN_PROPS : undefined}
                  /* 官方 markdown 节点点击（图片预览 / 链接跳转），以前这条链路是断的 */
                  onClick={handleMarkdownNode}
                />
                {/* 官方 chat-actionbar（复制/重新生成/点赞/点踩）+ 自绘「加入资产库」
                    注：Taro 出于性能考虑不会给 View 生成 slot 属性（其源码注释原文是
                    「不给 View 直接加 slot 属性的原因是性能损耗」），所以官方 chat-sender
                    的 input-prefix / footer-prefix、chat-actionbar 的 prefix 插槽都注不进去，
                    需要额外元素时一律并排拼条 / 绝对定位自绘。 */}
                {showActions && <View className='msg-toolbar'>
                  <View className='msg-asset' hoverClass='msg-action-hover' aria-label='加入资产库' onClick={() => addAsset(message)}>
                    <TdIcon name='bookmark-add' className='msg-asset-icon' />
                  </View>
                  <t-chat-actionbar
                    actionBar={MESSAGE_ACTIONS}
                    content={message.text}
                    chatId={message.id}
                    placement='start'
                    onActions={(event: { detail?: { name?: string } }) => handleMessageAction(event, message)}
                  />
                </View>}
              </View>
            </View>
          );
        })}
      </ScrollView>
      {!!error && !!agent && <Text className='runtime-error'>{error}</Text>}
      {/* 输入框：官方 t-chat-sender（左下角只浮一个加号上传图片，不加官方深度思考/联网） */}
      <View className={`composer-shell${focused ? ' composer-shell-focus' : ''}`}>
        <t-chat-sender
          value={input}
          placeholder='请输入你的需求'
          loading={sending}
          adjustPosition
          renderPresets={SENDER_PRESETS}
          textareaProps={SENDER_TEXTAREA_PROPS}
          attachmentsProps={attachmentsProps}
          onChange={(event: { detail?: { value?: string } }) => setInput(String(event?.detail?.value || ''))}
          onSend={(event: { detail?: { value?: string } }) => send(event?.detail?.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onFileDelete={removeImage}
        />
        {agent.supportsImages && <View
          className={`composer-plus${uploadingAny ? ' composer-plus-busy' : ''}`}
          hoverClass='composer-plus-hover'
          aria-label='上传图片'
          onClick={chooseImage}
        >
          <TdIcon name='add' className='composer-plus-icon' />
        </View>}
        {imageOnlyReady && <View
          className='composer-image-send'
          hoverClass='composer-plus-hover'
          onClick={() => send()}
        >发送图片</View>}
      </View>
      <Text className='composer-disclaimer'>内容由AI生成，仅供参考</Text>

      <SideDrawer open={historyOpen} title='对话历史' onClose={() => setHistoryOpen(false)}>
        <Button className='history-new-btn' onClick={startNewChat}>＋ 新对话</Button>
        <Text className='history-section-label'>历史记录</Text>
        {historyLoading ? <Text className='history-empty'>加载中…</Text>
          : !historyList.length ? <Text className='history-empty'>还没有对话记录，点击「新对话」开始第一次创作吧～</Text>
            : historyList.map((record) => (
              <View key={record.id} className={`history-item ${record.id === sessionId ? 'history-item-active' : ''}`} onClick={() => selectHistory(record)}>
                <Text className='history-item-title'>{record.title || '未命名对话'}</Text>
                <Text className='history-item-time'>{timeAgo(record.createdAt)}</Text>
              </View>
            ))}
      </SideDrawer>
      <SideDrawer open={infoOpen} title='智能体名片' onClose={() => setInfoOpen(false)}>
        <EntityInfoCard entity={agent} type='agent' />
      </SideDrawer>
      <t-toast id='t-toast' theme='info' />
      <t-dialog id='t-dialog' title='' />
    </>}
  </View>;
}
