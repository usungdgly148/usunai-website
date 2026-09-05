import { useEffect, useMemo, useState } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { Button, Image, ScrollView, Text, Textarea, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { MarkdownContent } from '../../components/markdown-content';
import { EntityInfoCard, SideDrawer, timeAgo } from '../../components/inner-ui';
import { getPagedRecords, getPublicContent, saveRuntimeAsset, saveRuntimeHistory, streamAgentChat, uploadRuntimeFile } from '../../services/api';
import { collectMediaUrls, fileToDataUrl, runtimeId } from '../../services/runtime';
import type { ContentItem } from '../../types';

type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; reasoning?: string; images?: string[] };
type HistoryRecord = Record<string, unknown> & { id?: string; title?: string; createdAt?: string; agentId?: string; messages?: ChatMessage[] };

const ASSET_TYPE_NAMES: Record<string, string> = { copy: '文案', image: '图片', video: '视频', audio: '音频', article: '文章' };
const sessionKey = (agentId?: string) => `usunai_miniapp_chat_session_${agentId || 'unknown'}`;
/** 输入框自适应高度的最大行数，超过后固定高度并在框内滚动 */
const COMPOSER_MAX_LINES = 10;

function ReasoningBlock({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <View className='reasoning-block'>
      <Text className='reasoning-toggle' onClick={() => setOpen(!open)}>{open ? '收起思考过程 ▲' : '查看思考过程 ▼'}</Text>
      {!!open && <Text className='reasoning-text'>{text}</Text>}
    </View>
  );
}

export default function ChatPage() {
  const { params } = useRouter();
  const agentId = params.id;
  const [agent, setAgent] = useState<ContentItem>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [inputCapped, setInputCapped] = useState(false);
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

  const chooseImage = async () => {
    if (!agent || !agent.supportsImages) return;
    try {
      const selected = await Taro.chooseMedia({ count: Math.max(1, 4 - images.length), mediaType: ['image'], sourceType: ['album', 'camera'] });
      const next: string[] = [];
      for (const file of selected.tempFiles) {
        const type = file.fileType === 'image' ? 'image/jpeg' : 'application/octet-stream';
        const dataUrl = await fileToDataUrl(file.tempFilePath, type);
        const uploaded = await uploadRuntimeFile({ targetType: 'agent', targetId: agent.id, dataUrl, fileName: `image_${Date.now()}.jpg`, fileType: type });
        if (uploaded.dataUrl) next.push(uploaded.dataUrl);
      }
      setImages((current) => [...current, ...next].slice(0, 4));
    } catch (reason) { Taro.showToast({ title: reason instanceof Error ? reason.message : '图片上传失败', icon: 'none' }); }
  };

  const runTurn = async (userMessage: ChatMessage, baseMessages: ChatMessage[]) => {
    if (!agent) return;
    const snapshot = [...baseMessages, userMessage];
    const assistantId = runtimeId('msg');
    setMessages([...snapshot, { id: assistantId, role: 'assistant', text: '' }]);
    setInput(''); setImages([]); setSending(true); setError(''); setInputCapped(false);
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
    if (!agent || sending || (!text && images.length === 0)) return;
    void runTurn({ id: runtimeId('msg'), role: 'user', text, images: [...images] }, messages);
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
    const userMessage = { ...messages[userIdx], id: runtimeId('msg') };
    void runTurn(userMessage, messages.slice(0, userIdx));
  };

  const startNewChat = () => {
    if (sending) return;
    setMessages([]); setInput(''); setImages([]); setError(''); setInputCapped(false);
    setSessionId(runtimeId('miniapp_chat'));
    setHistoryOpen(false);
  };

  const openHistory = () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    getPagedRecords('history', 1, 50).then(({ items }) => {
      setHistoryList(items.filter((item) => item.type === 'agent' && item.agentId === agentId) as HistoryRecord[]);
      setHistoryLoading(false);
    }).catch(() => {
      setHistoryLoading(false);
      Taro.showToast({ title: '历史记录加载失败', icon: 'none' });
    });
  };

  const selectHistory = (record: HistoryRecord) => {
    if (sending) return;
    const msgs = Array.isArray(record.messages) ? record.messages.filter((m) => m && typeof m.text === 'string') : [];
    setMessages(msgs);
    if (record.id) setSessionId(record.id);
    setError('');
    setHistoryOpen(false);
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
      Taro.showToast({ title: `已加入「${ASSET_TYPE_NAMES[type] || '结果'}」资产库`, icon: 'success' });
    } catch (reason) { Taro.showToast({ title: reason instanceof Error ? reason.message : '保存失败', icon: 'none' }); }
  };

  const suggestions = useMemo(() => (agent?.suggestedQuestions || []).filter((item) => typeof item === 'string' && item.trim()).slice(0, 6), [agent]);

  return <View className='runtime-page chat-page'>
    <PageState loading={loading} error={error && !agent ? error : ''} empty={!loading && !error && !agent} />
    {agent && <>
      <View className='runtime-header header-row'>
        <View>
          <Text className='card-title'>{agent.name}</Text>
          <Text className='muted'>AI 智能体 · 实时对话</Text>
        </View>
        <View className='header-actions'>
          <Text className='header-icon-btn' onClick={openHistory}>🕒</Text>
          <Text className='header-icon-btn' onClick={() => setInfoOpen(true)}>📚</Text>
        </View>
      </View>
      <ScrollView className='chat-scroll' scrollY scrollIntoView={messages.length ? `message-${messages[messages.length - 1].id}` : undefined}>
        {agent.opening && messages.length === 0 && (
          <ScrollView className='chat-opening-scroll' scrollY>
            <View className='chat-bubble assistant-bubble chat-opening-bubble'><MarkdownContent value={agent.opening} selectable /></View>
          </ScrollView>
        )}
        {!!suggestions.length && messages.length === 0 && !sending && <View className='suggestion-row'>
          <Text className='suggestion-caption'>试试这样问 · 点击直接发送</Text>
          {suggestions.map((item) => <Text key={item} className='suggestion-chip' onClick={() => send(item)}>{item}</Text>)}
        </View>}
        {messages.map((message) => <View id={`message-${message.id}`} key={message.id} className={`chat-row ${message.role === 'user' ? 'chat-row-user' : ''}`}>
          <View className={`chat-bubble ${message.role === 'user' ? 'user-bubble' : 'assistant-bubble'}`}>
            {!!message.images?.length && <View className='image-grid'>{message.images.map((url) => <Image key={url} src={url} mode='aspectFill' className='upload-thumb' />)}</View>}
            {message.role === 'assistant' && !!message.reasoning && <ReasoningBlock text={message.reasoning} />}
            {message.role === 'assistant'
              ? <MarkdownContent value={message.text || (sending ? '正在生成…' : '')} />
              : <Text>{message.text}</Text>}
            {message.role === 'assistant' && !!message.text && !sending && <View className='msg-actions'>
              <Text className='msg-action' onClick={() => Taro.setClipboardData({ data: message.text })}>复制</Text>
              <Text className='msg-action' onClick={() => regenerate(message.id)}>重新生成</Text>
              <Text className='msg-action' onClick={() => addAsset(message)}>加入资产库</Text>
            </View>}
          </View>
        </View>)}
      </ScrollView>
      {!!error && !!agent && <Text className='runtime-error'>{error}</Text>}
      {!!images.length && <View className='image-grid composer-images'>{images.map((url) => <Image key={url} src={url} mode='aspectFill' className='upload-thumb' />)}</View>}
      <View className='composer'>
        {agent.supportsImages && <Button className='composer-add' onClick={chooseImage}>＋</Button>}
        <Textarea
          className={`composer-input ${inputCapped ? 'composer-input-capped' : ''}`}
          value={input}
          autoHeight={!inputCapped}
          maxlength={2000}
          cursorSpacing={20}
          showConfirmBar={false}
          disableDefaultPadding
          placeholder='请输入你的需求'
          confirmType='send'
          onInput={(event) => setInput(event.detail.value)}
          onLineChange={(event) => setInputCapped((event.detail.lineCount || 1) > COMPOSER_MAX_LINES)}
          onConfirm={() => send()}
        />
        <Button className='composer-send' loading={sending} disabled={sending} onClick={() => send()}>➤</Button>
      </View>

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
    </>}
  </View>;
}
