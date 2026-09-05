import { useEffect, useMemo, useRef, useState } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { Button, Image, Input, Picker, ScrollView, Slider, Switch, Text, Textarea, Video, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { EntityInfoCard, SideDrawer, timeAgo } from '../../components/inner-ui';
import { getPagedRecords, getPublicContent, getRuntimeTask, saveRuntimeAsset, saveRuntimeHistory, submitWorkflowTask, uploadRuntimeFile } from '../../services/api';
import { fileToDataUrl, runtimeId } from '../../services/runtime';
import type { ContentItem, FormField, FormFieldOption, RuntimeTask } from '../../types';

const ACTIVE_TASK_PREFIX = 'usunai_miniapp_active_workflow_';
type HistoryRecord = Record<string, unknown> & { id?: string; title?: string; createdAt?: string; workflowId?: string; taskId?: string };
const fieldKey = (field: FormField, index: number) => String(field.key || field.name || field.id || `field_${index}`);
const fieldLabel = (field: FormField, index: number) => String(field.label || field.name || field.key || `参数 ${index + 1}`);

const AUDIO_URL_RE = /\.(mp3|wav|m4a|aac|ogg|flac)(\?|#|$)/i;
const DOC_META: Record<string, { label: string; badgeClass: string }> = {
  pdf: { label: 'PDF', badgeClass: '' },
  docx: { label: 'Word', badgeClass: 'doc-badge-word' },
  xlsx: { label: 'Excel', badgeClass: 'doc-badge-excel' },
  pptx: { label: 'PPT', badgeClass: 'doc-badge-ppt' },
  text: { label: 'TXT', badgeClass: 'doc-badge-text' },
  zip: { label: 'ZIP', badgeClass: 'doc-badge-zip' },
  file: { label: '文件', badgeClass: 'doc-badge-text' },
};
const ASSET_TYPE_NAMES: Record<string, string> = { copy: '文案', image: '图片', video: '视频', audio: '音频', article: '文章' };

function detectDocType(url: string): string {
  if (!url || typeof url !== 'string') return 'file';
  const clean = url.toLowerCase().split('?')[0].split('#')[0];
  if (clean.endsWith('.pdf')) return 'pdf';
  if (clean.endsWith('.doc') || clean.endsWith('.docx')) return 'docx';
  if (clean.endsWith('.xls') || clean.endsWith('.xlsx') || clean.endsWith('.csv')) return 'xlsx';
  if (clean.endsWith('.ppt') || clean.endsWith('.pptx')) return 'pptx';
  if (clean.endsWith('.txt') || clean.endsWith('.md') || clean.endsWith('.json') || clean.endsWith('.xml')) return 'text';
  if (clean.endsWith('.zip') || clean.endsWith('.rar') || clean.endsWith('.7z')) return 'zip';
  return 'file';
}

// 从工作流返回中抽取文本/图片/视频/音频（与网页端 extractMedia 逻辑对齐）
function extractResultMedia(result: unknown): { text: string; images: string[]; videos: string[]; audios: string[] } {
  const empty = { text: '', images: [] as string[], videos: [] as string[], audios: [] as string[] };
  if (!result || typeof result !== 'object') {
    return typeof result === 'string' ? { ...empty, text: result } : empty;
  }
  const value = result as { text?: string; kind?: string; data?: unknown };
  const images = new Set<string>(); const videos = new Set<string>(); const audios = new Set<string>();

  const isImageUrl = (url: string) => {
    if (!/^https?:\/\//.test(url) && !/^data:image\//i.test(url)) return false;
    const lower = url.toLowerCase();
    if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)(\?|#|$)/i.test(url)) return true;
    if (/^data:image\//i.test(url)) return true;
    const hints = ['image', 'img', 'oss-', 'coze', 'byteimg', 'volces', 'alicdn', 'picsum', 's.coze'];
    return hints.some((hint) => lower.includes(hint));
  };
  const isVideoUrl = (url: string) => {
    if (!/^https?:\/\//.test(url)) return false;
    const lower = url.toLowerCase();
    if (/\.(mp4|mov|webm|mkv)(\?|#|$)/i.test(url)) return true;
    return ['video', 'vod', 'mp4', 'mov', 'webm'].some((hint) => lower.includes(hint));
  };

  const collect = (entry: unknown) => {
    if (!entry) return;
    if (typeof entry === 'string') {
      if (isVideoUrl(entry)) videos.add(entry);
      else if (isImageUrl(entry)) images.add(entry);
      else if (AUDIO_URL_RE.test(entry)) audios.add(entry);
    } else if (Array.isArray(entry)) entry.forEach(collect);
    else if (typeof entry === 'object') Object.values(entry as Record<string, unknown>).forEach(collect);
  };

  if (value.data) collect(value.data);
  if (typeof value.text === 'string' && value.text.trim()) {
    const trimmed = value.text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try { collect(JSON.parse(trimmed)); } catch { /* 普通文本 */ }
    }
    collect(trimmed);
  }
  return { text: typeof value.text === 'string' ? value.text : '', images: [...images], videos: [...videos], audios: [...audios] };
}

function toUrlArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string');
  return typeof value === 'string' && value ? [value] : [];
}

function normalizeOption(option: string | FormFieldOption): FormFieldOption {
  if (typeof option === 'string') return { label: option, value: option };
  return { label: option.label || option.value || '', value: option.value || option.label || '' };
}

function WorkflowPage() {
  const { params } = useRouter();
  const [workflow, setWorkflow] = useState<ContentItem>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [previews, setPreviews] = useState<Record<string, string[]>>({});
  const [task, setTask] = useState<RuntimeTask>();
  const [lastInputs, setLastInputs] = useState<Record<string, unknown>>();
  const [playingUrl, setPlayingUrl] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [historyList, setHistoryList] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const audioRef = useRef<Taro.InnerAudioContext | null>(null);
  const fields = useMemo(() => (workflow?.formFields || []).filter((field) => field.enabled !== false), [workflow]);

  const initValues = (item: ContentItem) => {
    const next: Record<string, unknown> = {};
    (item.formFields || []).forEach((field, index) => {
      if (field.enabled === false) return;
      const key = fieldKey(field, index);
      const fallback = field.default;
      next[key] = fallback === undefined || fallback === null ? '' : fallback;
    });
    return next;
  };

  useEffect(() => {
    getPublicContent().then((content) => {
      const item = content.workflows.find((entry) => entry.id === params.id);
      if (!item) throw new Error('工作流不存在或未上架');
      setWorkflow(item);
      setValues(initValues(item));
      const activeId = Taro.getStorageSync<string>(`${ACTIVE_TASK_PREFIX}${item.id}`);
      if (activeId) void refreshTask(activeId, item.id);
    }).catch((reason) => setError(reason.message || '加载失败')).finally(() => setLoading(false));
  }, [params.id]);

  useEffect(() => () => { audioRef.current?.destroy(); }, []);

  const refreshTask = async (taskId: string, workflowId: string) => {
    try {
      const current = await getRuntimeTask(taskId);
      setTask(current);
      if (current.status === 'queued' || current.status === 'running') setTimeout(() => void refreshTask(taskId, workflowId), 1800);
      else {
        Taro.removeStorageSync(`${ACTIVE_TASK_PREFIX}${workflowId}`);
        if (current.status === 'succeeded') await saveRuntimeHistory({ id: runtimeId('hist'), type: 'workflow', workflowId, taskId, title: current.name || '工作流任务', createdAt: current.completedAt || new Date().toISOString(), result: current.result });
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : '任务状态查询失败'); }
  };

  const isFileField = (field: FormField) => {
    const raw = `${field.type || ''} ${field.inputType || ''} ${field.style || ''} ${field.itemType || ''}`.toLowerCase();
    return /file|image/.test(raw) && !/boolean|number|date/.test(raw);
  };
  const isImageField = (field: FormField) => /image/.test(`${field.type || ''} ${field.inputType || ''} ${field.itemType || ''}`.toLowerCase());
  const isVideoField = (field: FormField) => /video/.test(`${field.type || ''} ${field.inputType || ''} ${field.itemType || ''} ${field.style || ''}`.toLowerCase());
  const isMultiField = (field: FormField) => /array|multiple/i.test(`${field.type || ''} ${field.inputType || ''} ${field.itemType || ''}`);

  const fileEntries = (key: string): unknown[] => {
    const value = values[key];
    if (Array.isArray(value)) return value;
    return value ? [value] : [];
  };

  const chooseFile = async (field: FormField, index: number) => {
    if (!workflow) return;
    const key = fieldKey(field, index);
    const multi = isMultiField(field);
    try {
      const existing = fileEntries(key);
      const remaining = Math.max(1, 9 - existing.length);
      // 图片/视频字段走系统相册（可拍摄），仅普通文件从微信聊天记录选择
      const mediaTypes: Array<'video' | 'image'> = [];
      if (isVideoField(field)) mediaTypes.push('video');
      if (isImageField(field)) mediaTypes.push('image');

      let collected: Array<{ path: string; mime: string; name: string }> = [];
      if (mediaTypes.length) {
        const selected = await Taro.chooseMedia({
          count: multi ? remaining : 1,
          mediaType: mediaTypes,
          sourceType: ['album', 'camera'],
          sizeType: ['compressed'],
        });
        collected = selected.tempFiles.map((file, fileIndex) => {
          const isVideo = file.fileType === 'video';
          return {
            path: file.tempFilePath,
            mime: isVideo ? 'video/mp4' : 'image/jpeg',
            name: isVideo ? `video_${Date.now()}_${fileIndex}.mp4` : `image_${Date.now()}_${fileIndex}.jpg`,
          };
        });
      } else {
        const selected = await Taro.chooseMessageFile({ count: multi ? remaining : 1, type: 'all' });
        collected = selected.tempFiles.map((file) => ({
          path: file.path,
          mime: file.type || (/\.(png|jpe?g|webp)$/i.test(file.name) ? 'image/jpeg' : 'application/octet-stream'),
          name: file.name,
        }));
      }

      const uploaded = multi ? [...existing] : [];
      const localPreviews = multi ? [...(previews[key] || [])] : [];
      for (const item of collected) {
        const dataUrl = await fileToDataUrl(item.path, item.mime);
        const result = await uploadRuntimeFile({ targetType: 'workflow', targetId: workflow.id, dataUrl, fileName: item.name, fileType: item.mime });
        if (result.fileId) uploaded.push({ file_id: result.fileId });
        else if (result.dataUrl) uploaded.push(result.dataUrl);
        if (isImageField(field)) localPreviews.push(item.path);
      }
      setValues((current) => ({ ...current, [key]: multi ? uploaded : (uploaded[uploaded.length - 1] ?? '') }));
      setPreviews((current) => ({ ...current, [key]: localPreviews }));
    } catch (reason) { Taro.showToast({ title: reason instanceof Error ? reason.message : '文件上传失败', icon: 'none' }); }
  };

  const removeFile = (field: FormField, index: number, removeIndex: number) => {
    const key = fieldKey(field, index);
    const next = fileEntries(key).filter((_, i) => i !== removeIndex);
    setValues((current) => ({ ...current, [key]: isMultiField(field) ? next : (next[0] ?? '') }));
    setPreviews((current) => ({ ...current, [key]: (current[key] || []).filter((_, i) => i !== removeIndex) }));
  };

  const submit = async () => {
    if (!workflow || task?.status === 'queued' || task?.status === 'running') return;
    const missing = fields.find((field, index) => field.required && !values[fieldKey(field, index)]);
    if (missing) { Taro.showToast({ title: `请填写${fieldLabel(missing, fields.indexOf(missing))}`, icon: 'none' }); return; }
    setError('');
    const snapshot: Record<string, unknown> = {};
    fields.forEach((field, index) => { snapshot[fieldKey(field, index)] = values[fieldKey(field, index)]; });
    setLastInputs(snapshot);
    try {
      const idempotencyKey = runtimeId(`workflow_${workflow.id}`);
      const created = await submitWorkflowTask(workflow.id, snapshot, idempotencyKey);
      setTask(created);
      Taro.setStorageSync(`${ACTIVE_TASK_PREFIX}${workflow.id}`, created.id);
      void refreshTask(created.id, workflow.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '工作流提交失败'); }
  };

  const resetFields = () => {
    if (workflow) setValues(initValues(workflow));
    setPreviews({});
  };

  const openHistory = () => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    getPagedRecords('history', 1, 50).then(({ items }) => {
      setHistoryList(items.filter((item) => item.type === 'workflow' && item.workflowId === params.id) as HistoryRecord[]);
      setHistoryLoading(false);
    }).catch(() => {
      setHistoryLoading(false);
      Taro.showToast({ title: '历史记录加载失败', icon: 'none' });
    });
  };

  const selectHistory = (record: HistoryRecord) => {
    const taskId = String(record.taskId || '');
    if (!taskId) { Taro.showToast({ title: '该记录缺少任务信息', icon: 'none' }); return; }
    setHistoryOpen(false);
    setError('');
    Taro.showLoading({ title: '加载中' });
    getRuntimeTask(taskId).then((current) => {
      Taro.hideLoading();
      setTask(current);
    }).catch(() => {
      Taro.hideLoading();
      Taro.showToast({ title: '任务记录加载失败', icon: 'none' });
    });
  };

  const toggleAudio = (url: string) => {
    if (playingUrl === url) {
      audioRef.current?.stop();
      setPlayingUrl('');
      return;
    }
    audioRef.current?.destroy();
    const context = Taro.createInnerAudioContext();
    context.src = url;
    context.play();
    context.onEnded(() => setPlayingUrl(''));
    context.onError(() => { setPlayingUrl(''); Taro.showToast({ title: '音频播放失败', icon: 'none' }); });
    audioRef.current = context;
    setPlayingUrl(url);
  };

  const openDocument = (url: string) => {
    Taro.showLoading({ title: '正在下载…' });
    Taro.downloadFile({
      url,
      success: (res) => {
        Taro.hideLoading();
        if (res.statusCode !== 200) { Taro.showToast({ title: '文件下载失败', icon: 'none' }); return; }
        Taro.openDocument({ filePath: res.tempFilePath, showMenu: true, fail: () => Taro.setClipboardData({ data: url }) });
      },
      fail: () => {
        Taro.hideLoading();
        Taro.setClipboardData({ data: url });
        Taro.showToast({ title: '已复制文件链接', icon: 'none' });
      },
    });
  };

  const addAsset = async () => {
    if (!workflow || !task?.result) return;
    const found = extractResultMedia(task.result);
    const type = workflow.assetCategory || (found.videos.length ? 'video' : found.images.length ? 'image' : found.audios.length ? 'audio' : 'copy');
    try {
      await saveRuntimeAsset({
        id: runtimeId('asset'),
        name: `${workflow.name} · ${ASSET_TYPE_NAMES[type] || '结果'}`,
        type,
        content: found.text,
        images: found.images,
        videos: found.videos,
        audios: found.audios,
        source: `workflow:${workflow.id}`,
        createdAt: new Date().toISOString(),
      });
      Taro.showToast({ title: '已加入资产库', icon: 'success' });
    } catch (reason) { Taro.showToast({ title: reason instanceof Error ? reason.message : '保存失败', icon: 'none' }); }
  };

  const renderDocRows = (urls: string[], name: string) => urls.map((url, index) => {
    const meta = DOC_META[detectDocType(url)] || DOC_META.file;
    return <View key={`${url}:${index}`} className='doc-row' onClick={() => openDocument(url)}>
      <Text className={`doc-badge ${meta.badgeClass}`}>{meta.label}</Text>
      <View className='doc-main'>
        <Text className='doc-name'>{name}{urls.length > 1 ? ` · ${index + 1}` : ''}</Text>
        <Text className='doc-url'>{url}</Text>
      </View>
      <Text className='doc-action'>打开</Text>
    </View>;
  });

  const renderAudioRows = (urls: string[], name: string) => urls.map((url, index) => (
    <View key={`${url}:${index}`} className='audio-row'>
      <Text className='audio-play' onClick={() => toggleAudio(url)}>{playingUrl === url ? '❚❚' : '▶'}</Text>
      <Text className='audio-name'>{name}{urls.length > 1 ? ` · ${index + 1}` : ''}</Text>
    </View>
  ));

  const renderTaggedField = (field: Record<string, unknown>, value: unknown, index: number) => {
    const tag = String(field.tag || '');
    const name = String(field.name || field.key || '输出');
    const urls = toUrlArray(value);
    if (!urls.length && typeof value !== 'string') return null;
    if (tag === 'image-required') {
      return urls.length ? <View key={index}>
        <Text className='media-section-title'>{name}</Text>
        <View className='media-grid'>{urls.map((url) => <Image key={url} className='media-thumb' src={url} mode='aspectFill' onClick={() => Taro.previewImage({ current: url, urls })} />)}</View>
      </View> : null;
    }
    if (tag === 'video-required') {
      return urls.length ? <View key={index}>
        <Text className='media-section-title'>{name}</Text>
        <View className='media-grid'>{urls.map((url) => <Video key={url} className='media-thumb' src={url} controls />)}</View>
      </View> : null;
    }
    if (tag === 'audio-required') {
      return urls.length ? <View key={index}>
        <Text className='media-section-title'>{name}</Text>
        {renderAudioRows(urls, name)}
      </View> : null;
    }
    if (tag === 'document') {
      return urls.length ? <View key={index}>
        <Text className='media-section-title'>{name}</Text>
        {renderDocRows(urls, name)}
      </View> : null;
    }
    if (tag === 'code') {
      const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
      return !!text ? <View key={index}>
        <Text className='media-section-title'>{name}</Text>
        <Text className='result-text code-text'>{text}</Text>
      </View> : null;
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return !!text ? <View key={index}>
      <Text className='media-section-title'>{name}</Text>
      <Text className='result-text'>{text}</Text>
    </View> : null;
  };

  const renderResult = () => {
    if (!task?.result) return null;
    const result = task.result as { text?: string; kind?: string; data?: Record<string, unknown> };
    const outputFields = (workflow?.outputFields || []) as Array<Record<string, unknown>>;
    const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : null;
    const hasTagged = !!data && outputFields.some((field) => field.tag && field.enabled !== false);
    if (hasTagged && data) {
      const known = new Set(outputFields.map((field) => String(field.key || field.name)));
      const extra = Object.entries(data).filter(([entryKey]) => !known.has(entryKey));
      return <View>
        {outputFields.filter((field) => field.enabled !== false).map((field, index) => renderTaggedField(field, data[String(field.key || field.name)], index))}
        {!!extra.length && <Text className='extra-json'>{JSON.stringify(Object.fromEntries(extra), null, 2)}</Text>}
      </View>;
    }
    const found = extractResultMedia(task.result);
    const fallbackText = found.text || (result.kind === 'json' ? JSON.stringify(result.data, null, 2) : '');
    return <View>
      {!!fallbackText && <Text className='result-text'>{fallbackText}</Text>}
      {!!found.images.length && <View className='media-grid'>{found.images.map((url) => <Image key={url} className='media-thumb' src={url} mode='aspectFill' onClick={() => Taro.previewImage({ current: url, urls: found.images })} />)}</View>}
      {!!found.videos.length && <View className='media-grid'>{found.videos.map((url) => <Video key={url} className='media-thumb' src={url} controls />)}</View>}
      {!!found.audios.length && renderAudioRows(found.audios, '音频')}
    </View>;
  };

  const resultText = useMemo(() => {
    if (!task?.result) return '';
    const result = task.result as { text?: string; kind?: string; data?: unknown };
    if (typeof result.text === 'string' && result.text.trim()) return result.text;
    if (result.kind === 'json') return JSON.stringify(result.data, null, 2);
    return '';
  }, [task?.result]);

  const renderField = (field: FormField, index: number) => {
    const key = fieldKey(field, index);
    const style = String(field.style || '').toLowerCase();
    const rawType = `${field.type || ''} ${field.inputType || ''}`.toLowerCase();
    const advanced = field.advanced && typeof field.advanced === 'object' ? field.advanced : undefined;
    const advComponent = String(advanced?.component || '').toLowerCase();
    const options = (advanced?.options || field.options || []).map(normalizeOption);
    const hintText = String(advanced?.hint || field.hint || '');
    const value = values[key];

    return <View className='runtime-field' key={key}>
      <Text className='form-label'>{fieldLabel(field, index)}{field.required ? ' *' : ''}</Text>
      {isFileField(field) ? <>
        <Button className='file-button' onClick={() => chooseFile(field, index)}>{fileEntries(key).length ? '已上传，点击继续选择' : (isImageField(field) || isVideoField(field)) ? '从相册选择上传' : '选择并上传文件'}</Button>
        {!!previews[key]?.length && isImageField(field) && <View className='file-preview-row'>
          {previews[key].map((path, previewIndex) => <View key={`${path}:${previewIndex}`} className='file-preview-item'>
            <Image src={path} mode='aspectFill' className='upload-thumb' />
            <Text className='file-preview-remove' onClick={() => removeFile(field, index, previewIndex)}>×</Text>
          </View>)}
        </View>}
        {!!fileEntries(key).length && !isImageField(field) && <Text className='file-count-note'>已上传 {fileEntries(key).length} 个文件</Text>}
      </>
        : (style === 'boolean' || rawType.includes('boolean') || advComponent === 'switch') ? <View className='switch-row'>
          <Text>{fieldLabel(field, index)}</Text>
          <Switch checked={!!value} onChange={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))} />
        </View>
          : (advComponent === 'slider' || style === 'slider') ? <>
            <Slider min={advanced?.min ?? 0} max={advanced?.max ?? 100} step={advanced?.step ?? 1} value={Number(value) || advanced?.min || 0} onChange={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))} />
            <Text className='slider-value'>{Number(value) || advanced?.min || 0}</Text>
          </>
            : (advComponent === 'date' || style === 'date') ? <Picker mode='date' value={String(value || '')} onChange={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))}>
              <View className='form-input picker-value'>{String(value || '请选择日期')}</View>
            </Picker>
              : options.length ? <Picker mode='selector' range={options.map((item) => item.label || '')} onChange={(event) => setValues((current) => ({ ...current, [key]: options[Number(event.detail.value)]?.value }))}>
                <View className='form-input picker-value'>{String(value || field.placeholder || '请选择')}</View>
              </Picker>
                : (style === 'number' || /number|integer/.test(rawType)) ? <Input className='form-input' type='number' value={String(value ?? '')} placeholder={field.placeholder || '请输入数字'} onInput={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))} />
                  : /textarea|multiline/.test(`${style} ${rawType}`) ? <Textarea className='runtime-textarea' value={String(value || '')} placeholder={field.placeholder || '请输入'} onInput={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))} />
                    : <Input className='form-input' value={String(value ?? '')} placeholder={field.placeholder || '请输入'} onInput={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))} />}
      {!!hintText && <Text className='field-hint'>{hintText}</Text>}
    </View>;
  };

  const renderInputEcho = () => {
    if (!lastInputs || !fields.length) return null;
    const rows = fields.map((field, index) => {
      const value = lastInputs[fieldKey(field, index)];
      if (value === undefined || value === null || value === '') return null;
      const display = isFileField(field)
        ? `${fileEntriesFrom(value).length} 个文件`
        : typeof value === 'object' ? JSON.stringify(value) : String(value);
      return <View className='input-echo-row' key={fieldKey(field, index)}>
        <Text className='input-echo-label'>{fieldLabel(field, index)}：</Text>
        <Text>{display}</Text>
      </View>;
    }).filter(Boolean);
    return rows.length ? <View className='input-echo'>{rows}</View> : null;
  };

  return <View className='runtime-page'>
    <PageState loading={loading} error={error && !workflow ? error : ''} empty={!loading && !error && !workflow} />
    {workflow && <>
      <View className='runtime-header header-row'>
        <View>
          <Text className='card-title'>{workflow.name}</Text>
          <Text className='muted'>配置参数 · 一键运行</Text>
        </View>
        <View className='header-actions'>
          <Text className='header-icon-btn' onClick={openHistory}>🕒</Text>
          <Text className='header-icon-btn' onClick={() => setInfoOpen(true)}>📚</Text>
        </View>
      </View>
      <ScrollView className='workflow-scroll' scrollY>
        <View className='card'>
          <View className='config-card-head'>
            <Text className='card-title'>配置参数</Text>
            {!!fields.length && <Text className='reset-link' onClick={resetFields}>↺ 重置参数</Text>}
          </View>
          {fields.length ? fields.map(renderField) : <Text className='muted'>该工作流无需输入参数</Text>}
        </View>
        {!!error && <Text className='runtime-error'>{error}</Text>}
        {task && <View className='card result-card'>
          {renderInputEcho()}
          <Text className='card-title'>{task.status === 'queued' ? '排队中' : task.status === 'running' ? '运行中…' : task.status === 'succeeded' ? '运行完成' : '运行失败'}</Text>
          {task.error && <Text className='runtime-error'>{task.error}</Text>}
          {renderResult()}
          {task.status === 'succeeded' && <View className='result-toolbar'>
            {!!resultText && <Text className='result-toolbar-action' onClick={() => Taro.setClipboardData({ data: resultText })}>复制结果</Text>}
            <Text className='result-toolbar-action' onClick={addAsset}>加入资产库</Text>
          </View>}
        </View>}
      </ScrollView>
      <Button className='primary-button runtime-submit' loading={task?.status === 'queued' || task?.status === 'running'} disabled={task?.status === 'queued' || task?.status === 'running'} onClick={submit}>开始运行</Button>

      <SideDrawer open={historyOpen} title='历史记录' onClose={() => setHistoryOpen(false)}>
        <Text className='history-section-label'>运行历史</Text>
        {historyLoading ? <Text className='history-empty'>加载中…</Text>
          : !historyList.length ? <Text className='history-empty'>还没有运行记录，配置参数后点击「开始运行」吧～</Text>
            : historyList.map((record) => (
              <View key={record.id} className='history-item' onClick={() => selectHistory(record)}>
                <Text className='history-item-title'>{record.title || '工作流任务'}</Text>
                <Text className='history-item-time'>{timeAgo(record.createdAt)}</Text>
              </View>
            ))}
      </SideDrawer>
      <SideDrawer open={infoOpen} title='工作流信息' onClose={() => setInfoOpen(false)}>
        <EntityInfoCard entity={workflow} type='workflow' />
      </SideDrawer>
    </>}
  </View>;
}

function fileEntriesFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  return value ? [value] : [];
}

export default WorkflowPage;
