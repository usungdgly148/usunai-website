import { useEffect, useMemo, useState } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { Button, Image, Input, ScrollView, Text, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { getPublicContent, saveRuntimeHistory, streamAgentChat, uploadRuntimeFile } from '../../services/api';
import { fileToDataUrl, runtimeId } from '../../services/runtime';
import type { ContentItem } from '../../types';

type ChatMessage = { id: string; role: 'user' | 'assistant'; text: string; reasoning?: string; images?: string[] };

export default function ChatPage() {
  const { params } = useRouter();
  const [agent, setAgent] = useState<ContentItem>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const sessionId = useMemo(() => runtimeId('miniapp_chat'), []);

  useEffect(() => {
    getPublicContent().then((content) => {
      const item = content.agents.find((entry) => entry.id === params.id);
      if (!item) throw new Error('智能体不存在或未上架');
      setAgent(item);
    }).catch((reason) => setError(reason.message || '加载失败')).finally(() => setLoading(false));
  }, [params.id]);

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

  const send = async () => {
    const text = input.trim();
    if (!agent || sending || (!text && images.length === 0)) return;
    const userMessage: ChatMessage = { id: runtimeId('msg'), role: 'user', text, images: [...images] };
    const assistantId = runtimeId('msg');
    const snapshot = [...messages, userMessage];
    setMessages([...snapshot, { id: assistantId, role: 'assistant', text: '' }]);
    setInput(''); setImages([]); setSending(true); setError('');
    let answer = ''; let reasoning = '';
    try {
      await streamAgentChat(agent.id, {
        message: text,
        sessionId,
        billingMessage: text,
        history: messages.map((item) => ({ role: item.role, content: item.text })),
        billingHistory: messages.map((item) => ({ role: item.role, content: item.text })),
        attachments: userMessage.images?.map((url) => ({ kind: 'image', url, name: 'image.jpg', type: 'image/jpeg' })) || [],
      }, ({ event, data }) => {
        const packet = data as { type?: string; content?: { answer?: string; reasoning?: string; error?: string }; error?: string };
        if (event === 'error' || packet.type === 'error') throw new Error(packet.content?.error || packet.error || '智能体调用失败');
        answer += packet.content?.answer || '';
        reasoning += packet.content?.reasoning || '';
        setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, text: answer, reasoning } : item));
      });
      await saveRuntimeHistory({ id: runtimeId('hist'), type: 'agent', agentId: agent.id, title: text.slice(0, 60) || '图片对话', createdAt: new Date().toISOString(), messages: [...snapshot, { id: assistantId, role: 'assistant', text: answer, reasoning }] });
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : '智能体调用失败';
      setError(message);
      setMessages((current) => current.map((item) => item.id === assistantId ? { ...item, text: item.text || `调用失败：${message}` } : item));
    } finally { setSending(false); }
  };

  return <View className='runtime-page'>
    <PageState loading={loading} error={error && !agent ? error : ''} empty={!loading && !error && !agent} />
    {agent && <>
      <View className='runtime-header'><Text className='card-title'>{agent.name}</Text><Text className='muted'>AI 智能体 · 实时对话</Text></View>
      <ScrollView className='chat-scroll' scrollY scrollIntoView={messages.length ? `message-${messages[messages.length - 1].id}` : undefined}>
        {agent.opening && messages.length === 0 && <View className='chat-bubble assistant-bubble'><Text>{agent.opening}</Text></View>}
        {messages.map((message) => <View id={`message-${message.id}`} key={message.id} className={`chat-row ${message.role === 'user' ? 'chat-row-user' : ''}`}>
          <View className={`chat-bubble ${message.role === 'user' ? 'user-bubble' : 'assistant-bubble'}`}>
            {!!message.images?.length && <View className='image-grid'>{message.images.map((url) => <Image key={url} src={url} mode='aspectFill' className='upload-thumb' />)}</View>}
            {!!message.reasoning && <Text className='reasoning-text'>思考过程：{message.reasoning}</Text>}
            <Text>{message.text || (sending ? '正在生成…' : '')}</Text>
          </View>
        </View>)}
      </ScrollView>
      {!!error && <Text className='runtime-error'>{error}</Text>}
      {!!images.length && <View className='image-grid composer-images'>{images.map((url) => <Image key={url} src={url} mode='aspectFill' className='upload-thumb' />)}</View>}
      <View className='composer'>
        {agent.supportsImages && <Button className='composer-add' onClick={chooseImage}>＋</Button>}
        <Input className='composer-input' value={input} onInput={(event) => setInput(event.detail.value)} placeholder='请输入你的需求' confirmType='send' onConfirm={send} />
        <Button className='composer-send' loading={sending} disabled={sending} onClick={send}>发送</Button>
      </View>
    </>}
  </View>;
}
