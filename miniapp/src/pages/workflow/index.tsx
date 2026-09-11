import { useEffect, useMemo, useRef, useState } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { Button, Image, Input, ScrollView, Text, Textarea, Video, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { EntityInfoCard, SideDrawer, timeAgo } from '../../components/inner-ui';
import { TdIcon } from '../../components/td-icon';
import { fetchAllRecords, getHistoryDetail, getPublicContent, getRuntimeTask, saveRuntimeAsset, saveRuntimeHistory, submitWorkflowTask, uploadRuntimeFile } from '../../services/api';
import { fileToDataUrl, runtimeId } from '../../services/runtime';
import { hideFeedbackToast, loadingToast, toast } from '../../utils/feedback';
import { resolveEntityAvatar } from '../../utils/entity-visual';
import { subscribeKeyboardOffset } from '../../utils/keyboard';
import type { ContentItem, FormField, FormFieldOption, RuntimeTask } from '../../types';
import { useThemePage } from '../../hooks/use-theme-page';

const ACTIVE_TASK_PREFIX = 'usunai_miniapp_active_workflow_';
/**
 * 字段锚点 id（`scroll-into-view` 的目标）。
 * 用下标而不是 fieldKey：微信要求该 id 不能以数字开头，而配置里的字段 key 是后端自由文本
 * （可能是 `1`、`2name` 这类），下标锚点既唯一又不会踩这个限制。
 */
const fieldAnchorId = (index: number) => `wf-field-${index}`;
type HistoryRecord = Record<string, unknown> & { id?: string; title?: string; createdAt?: string; workflowId?: string; taskId?: string };
/** 历史详情（点开某条记录才拉取；列表接口已剥离 inputs/result 等大字段） */
type HistoryDetail = Record<string, unknown> & { id?: string; taskId?: string; result?: unknown; inputs?: Record<string, unknown>; createdAt?: string; cost?: number };

/**
 * 附件草稿。官方 t-attachments 的加载态是「status 驱动」的：
 * status 为 pending / fail / error 时不渲染内容，改为渲染 <t-loading theme="circular">。
 * 因此选完文件必须先把草稿以 pending 入列，上传成功再切 success、失败切 error。
 */
type UploadDraft = {
  uid: string;
  /** 展示地址：图片/视频用本地临时路径（立刻可见、不闪白）；其余文件不做缩略图展示 */
  url: string;
  /** 提交值：与改造前保持一致——上传接口给了 file_id 就用 { file_id }，否则退回 dataUrl 字符串 */
  remote: unknown;
  name: string;
  size: number;
  fileType: string;
  status: 'pending' | 'success' | 'error';
  progress?: number;
  errorMessage?: string;
};

/** 一次最多自动预取多少条历史详情（列表不返回 result，逐条按 id 拉），超出部分点按加载 */
const RUN_DETAIL_PREFETCH = 12;
const RUN_DETAIL_CONCURRENCY = 3;

/** 按文件名/MIME 推断官方 attachments 认识的 fileType（决定渲染缩略图还是文件条） */
function detectAttachmentType(name: string, mime: string): string {
  const clean = String(name || '').toLowerCase().split('?')[0];
  const type = String(mime || '').toLowerCase();
  if (/\.(png|jpe?g|gif|bmp|webp)$/.test(clean) || type.startsWith('image/')) return 'image';
  if (/\.(mp4|mov|avi|mkv|webm)$/.test(clean) || type.startsWith('video/')) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg|flac)$/.test(clean) || type.startsWith('audio/')) return 'audio';
  if (/\.pdf$/.test(clean)) return 'pdf';
  if (/\.(doc|docx)$/.test(clean)) return 'doc';
  if (/\.(xls|xlsx|csv)$/.test(clean)) return 'excel';
  if (/\.(ppt|pptx)$/.test(clean)) return 'ppt';
  if (/\.(txt|md|json|xml)$/.test(clean)) return 'txt';
  return 'file';
}
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
  /** 附件草稿（含上传状态，驱动官方 t-attachments 的加载态）；值为提交值 file_id / dataUrl */
  const [uploads, setUploads] = useState<Record<string, UploadDraft[]>>({});
  /** 正在上传的字段键：按钮置忙 + 禁止重复触发系统选择器 */
  const [uploadingKeys, setUploadingKeys] = useState<Record<string, boolean>>({});
  const [task, setTask] = useState<RuntimeTask>();
  const [playingUrl, setPlayingUrl] = useState('');
  /** false = 历史记录视图，true = 配置参数视图（对齐网页版手机端的单视图切换） */
  const [configView, setConfigView] = useState(true);
  const [infoOpen, setInfoOpen] = useState(false);
  /** 软键盘需要页面额外让位的高度（px，0 = 不用让位）；Android 已压缩 webview 时为 0 */
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  /** 正在编辑（输入框聚焦）或已展开选择弹层的字段键：驱动聚焦态样式 + 键盘避让的滚动目标 */
  const [editingKey, setEditingKey] = useState('');
  const [historyList, setHistoryList] = useState<HistoryRecord[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  /** 历史详情缓存 / 拉取中标记（key = 记录 id） */
  const [runDetails, setRunDetails] = useState<Record<string, HistoryDetail>>({});
  const [detailLoading, setDetailLoading] = useState<Record<string, boolean>>({});
  const runDetailsRef = useRef<Record<string, HistoryDetail>>({});
  const detailLoadingRef = useRef<Record<string, boolean>>({});
  /** TDesign 弹层选择器状态：date=日期弹层 / select=下拉弹层，key 为正在编辑的字段键 */
  const [fieldPicker, setFieldPicker] = useState<{ kind: 'date' | 'select'; key: string } | null>(null);
  /** t-image-viewer 全屏看图（结果图 / 历史结果图 / 上传预览共用） */
  const [viewer, setViewer] = useState<{ urls: string[]; current: number } | null>(null);
  const audioRef = useRef<Taro.InnerAudioContext | null>(null);
  /** 最近一次提交的参数快照：运行中卡片回显输入 + 落历史记录时一并写入 */
  const lastSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const fields = useMemo(() => (workflow?.formFields || []).filter((field) => field.enabled !== false), [workflow]);
  /** 工作流头像：有真头像用图片，没有则退化成图标字形色块（与智能体页头一致） */
  const workflowAvatar = resolveEntityAvatar(workflow, 'workflow');

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

  /**
   * 键盘避让：配置页是 `height:100vh` 的 flex 布局（表单在 ScrollView 里），软键盘弹起时
   * 既不会让位、ScrollView 也不会自动把编辑中的字段滚进可视区 → 底部字段会被键盘盖住。
   * 这里订阅键盘让位高度把页面收窄到键盘上沿，再由下面的 `scrollTarget` 把编辑中的字段滚到顶部。
   */
  useEffect(() => subscribeKeyboardOffset(setKeyboardHeight), []);

  /**
   * 编辑中的字段要滚进可视区（对齐需求「编辑/选择组件必须落在键盘上方」）。
   * 用 `scroll-into-view` 而不是 `scroll-top`：后者要先量元素位置、还要自己维护当前偏移。
   * 锚点带下标，所以 `editingKey` 为空时给空串，同一个字段二次聚焦也能重新触发滚动。
   */
  const editingIndex = editingKey ? fields.findIndex((field, index) => fieldKey(field, index) === editingKey) : -1;
  const scrollTarget = editingIndex >= 0 ? fieldAnchorId(editingIndex) : '';

  const refreshTask = async (taskId: string, workflowId: string) => {
    try {
      const current = await getRuntimeTask(taskId);
      setTask(current);
      if (current.status === 'queued' || current.status === 'running') setTimeout(() => void refreshTask(taskId, workflowId), 1800);
      else {
        Taro.removeStorageSync(`${ACTIVE_TASK_PREFIX}${workflowId}`);
        if (current.status === 'succeeded') {
          await saveRuntimeHistory({
            id: runtimeId('hist'),
            type: 'workflow',
            workflowId,
            taskId,
            title: current.name || '工作流任务',
            createdAt: current.completedAt || new Date().toISOString(),
            // inputs 用于历史卡片回显「用户输入气泡」（对齐网页版 RunItem），列表接口会剥离、详情接口返回
            inputs: lastSnapshotRef.current || undefined,
            result: current.result,
          });
          await loadHistory(true);
        }
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

  /** 某字段的附件草稿列表 */
  const fieldUploads = (field: FormField, index: number): UploadDraft[] => uploads[fieldKey(field, index)] || [];
  /** 某字段已上传成功的提交值（顺序 = 选择顺序） */
  const fieldReadyValues = (field: FormField, index: number): unknown[] =>
    fieldUploads(field, index).filter((entry) => entry.status === 'success').map((entry) => entry.remote);
  /** 某字段是否有值：附件字段以「已上传成功」为准，其余字段看 values */
  const fieldHasValue = (field: FormField, index: number) =>
    isFileField(field) ? fieldReadyValues(field, index).length > 0 : Boolean(values[fieldKey(field, index)]);
  /** 某字段最终提交值：多值字段给数组、单值字段给首项（与改造前语义一致） */
  const fieldSubmitValue = (field: FormField, index: number): unknown => {
    const ready = fieldReadyValues(field, index);
    return isMultiField(field) ? ready : (ready[0] ?? '');
  };
  /** 该字段是否还有草稿在上传中（按钮置忙 + 拦重复选择） */
  const isFieldUploading = (field: FormField, index: number) => {
    const key = fieldKey(field, index);
    return !!uploadingKeys[key] || fieldUploads(field, index).some((entry) => entry.status === 'pending');
  };

  /**
   * 选文件 → 上传。加载态：先把草稿以 pending 入列（官方 attachments 渲染 t-loading 转圈），
   * 逐张上传成功后切 success（带 file_id / dataUrl），失败切 error + errorMessage，可单独删除重试。
   */
  const chooseFile = async (field: FormField, index: number) => {
    if (!workflow || isFieldUploading(field, index)) return;
    const key = fieldKey(field, index);
    const multi = isMultiField(field);
    const existing = fieldUploads(field, index);
    const remaining = Math.max(1, 9 - existing.length);
    // 图片/视频字段走系统相册（可拍摄），仅普通文件从微信聊天记录选择
    const mediaTypes: Array<'video' | 'image'> = [];
    if (isVideoField(field)) mediaTypes.push('video');
    if (isImageField(field)) mediaTypes.push('image');

    let collected: Array<{ path: string; mime: string; name: string; size: number }> = [];
    try {
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
            size: Number((file as { size?: number }).size) || 0,
          };
        });
      } else {
        const selected = await Taro.chooseMessageFile({ count: multi ? remaining : 1, type: 'all' });
        collected = selected.tempFiles.map((file) => ({
          path: file.path,
          mime: file.type || (/\.(png|jpe?g|webp)$/i.test(file.name) ? 'image/jpeg' : 'application/octet-stream'),
          name: file.name,
          size: Number(file.size) || 0,
        }));
      }
    } catch (reason) {
      const errMsg = String((reason as { errMsg?: string } | undefined)?.errMsg || '');
      if (!/cancel/i.test(errMsg)) toast(reason instanceof Error ? reason.message : '选择文件失败', 'error');
      return;
    }
    if (!collected.length) return;

    const queued: UploadDraft[] = collected.map((item) => ({
      uid: runtimeId('upload'),
      url: item.path,
      remote: '',
      name: item.name,
      size: item.size,
      fileType: detectAttachmentType(item.name, item.mime),
      status: 'pending',
      progress: 0,
    }));
    // 单值字段重新选择时直接替换旧草稿，多值字段追加
    setUploads((current) => ({ ...current, [key]: multi ? [...existing, ...queued] : queued.slice(0, 1) }));
    setUploadingKeys((current) => ({ ...current, [key]: true }));
    let failures = 0;
    try {
      for (const [position, item] of collected.entries()) {
        const draft = queued[position];
        if (!draft) continue;
        try {
          const dataUrl = await fileToDataUrl(item.path, item.mime);
          setUploads((current) => ({ ...current, [key]: (current[key] || []).map((entry) => (entry.uid === draft.uid ? { ...entry, progress: 50 } : entry)) }));
          const result = await uploadRuntimeFile({ targetType: 'workflow', targetId: workflow.id, dataUrl, fileName: item.name, fileType: item.mime });
          if (!result.fileId && !result.dataUrl) throw new Error('上传失败，请重试');
          const remote: unknown = result.fileId ? { file_id: result.fileId } : result.dataUrl;
          setUploads((current) => ({ ...current, [key]: (current[key] || []).map((entry) => (entry.uid === draft.uid ? { ...entry, status: 'success', progress: 100, remote } : entry)) }));
        } catch (reason) {
          failures += 1;
          const message = reason instanceof Error ? reason.message : '文件上传失败';
          setUploads((current) => ({ ...current, [key]: (current[key] || []).map((entry) => (entry.uid === draft.uid ? { ...entry, status: 'error', errorMessage: message } : entry)) }));
        }
      }
      // 图片/视频失败态在官方 attachments 里只显示转圈（不展示 errorMessage），补一次聚合提示
      if (failures) toast(`${failures} 个附件上传失败，请删除后重试`, 'error');
    } finally {
      setUploadingKeys((current) => { const next = { ...current }; delete next[key]; return next; });
    }
  };

  /**
   * 官方 attachments 的 remove 事件：detail = { item, index }（item 里保留了我们塞的 uid）。
   * 注：它的 fileClick 事件名是驼峰，而 Taro 会把 onFileClick 转成 bind:file-click（不匹配），
   * 所以图片预览沿用组件内置的 imageViewer（内部走 wx.previewImage）。
   */
  const removeUpload = (field: FormField, index: number, event: { detail?: { item?: { uid?: string }; index?: number } }) => {
    const key = fieldKey(field, index);
    const uid = String(event?.detail?.item?.uid || '');
    const position = Number(event?.detail?.index);
    setUploads((current) => {
      const list = current[key] || [];
      const next = uid
        ? list.filter((entry) => entry.uid !== uid)
        : Number.isInteger(position) && position >= 0
          ? list.filter((_, i) => i !== position)
          : list;
      return { ...current, [key]: next };
    });
  };

  const submit = async () => {
    if (!workflow || task?.status === 'queued' || task?.status === 'running') return;
    if (fields.some((field, index) => isFieldUploading(field, index))) { toast('附件上传中，请稍候…', 'warning'); return; }
    const missing = fields.find((field, index) => field.required && !fieldHasValue(field, index));
    if (missing) { toast(`请填写${fieldLabel(missing, fields.indexOf(missing))}`, 'warning'); return; }
    setError('');
    const snapshot: Record<string, unknown> = {};
    fields.forEach((field, index) => {
      snapshot[fieldKey(field, index)] = isFileField(field) ? fieldSubmitValue(field, index) : values[fieldKey(field, index)];
    });
    lastSnapshotRef.current = snapshot;
    try {
      const idempotencyKey = runtimeId(`workflow_${workflow.id}`);
      const created = await submitWorkflowTask(workflow.id, snapshot, idempotencyKey);
      setTask(created);
      Taro.setStorageSync(`${ACTIVE_TASK_PREFIX}${workflow.id}`, created.id);
      // 对齐网页版手机端：结果只在历史视图呈现，提交后直接切过去，用户能看到排队/运行进度
      setConfigView(false);
      void loadHistory();
      void refreshTask(created.id, workflow.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '工作流提交失败'); }
  };

  const resetFields = () => {
    if (workflow) setValues(initValues(workflow));
    setUploads({});
    setFieldPicker(null);
  };

  /** 拉取本工作流的历史记录（列表只含元数据：服务端已剥离 inputs/result 大字段） */
  const loadHistory = async (silent = false) => {
    if (!silent) setHistoryLoading(true);
    try {
      const items = await fetchAllRecords('history');
      setHistoryList(items.filter((item) => item.workflowId === params.id) as HistoryRecord[]);
    } catch {
      if (!silent) toast('历史记录加载失败', 'error');
    } finally {
      if (!silent) setHistoryLoading(false);
    }
  };

  /**
   * 历史详情：列表接口不返回 result，故按 id 懒加载。
   * 兼容两种记录：① 直接带 result（网页端 / 小程序自写）② 只有 taskId（早期记录）→ 回查运行时任务。
   */
  const loadRunDetail = async (id: string) => {
    if (!id || runDetailsRef.current[id] || detailLoadingRef.current[id]) return;
    detailLoadingRef.current[id] = true;
    setDetailLoading((current) => ({ ...current, [id]: true }));
    try {
      const raw = (await getHistoryDetail(id)) as HistoryDetail;
      let detail: HistoryDetail = raw;
      if (!raw.result && raw.taskId) {
        try {
          const finished = await getRuntimeTask(String(raw.taskId));
          detail = { ...raw, result: finished.result };
        } catch { /* 回查失败就按「无结果」展示 */ }
      }
      runDetailsRef.current[id] = detail;
      setRunDetails((current) => ({ ...current, [id]: detail }));
    } catch { /* 单条失败静默：卡片上仍保留「点击查看运行结果」入口可重试 */ }
    finally {
      detailLoadingRef.current[id] = false;
      setDetailLoading((current) => { const next = { ...current }; delete next[id]; return next; });
    }
  };

  /** 页头右上角一个按钮两态：配置参数视图 → 去历史；历史视图 → 回配置参数（对齐网页版 SubHeader） */
  const toggleView = () => {
    const next = !configView;
    setConfigView(next);
    if (!next) void loadHistory();
  };

  /** 进入历史视图后预取前 N 条详情（并发 3），让列表观感与网页版「记录自带结果」一致；其余点按再取 */
  useEffect(() => {
    if (configView || !historyList.length) return;
    const queue = historyList
      .slice(0, RUN_DETAIL_PREFETCH)
      .map((record) => String(record.id || ''))
      .filter(Boolean);
    if (!queue.length) return;
    let cancelled = false;
    const workers = Array.from({ length: Math.min(RUN_DETAIL_CONCURRENCY, queue.length) }, async () => {
      for (;;) {
        if (cancelled) return;
        const next = queue.shift();
        if (!next) return;
        await loadRunDetail(next);
      }
    });
    void Promise.all(workers);
    return () => { cancelled = true; };
  }, [configView, historyList]);

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
    context.onError(() => { setPlayingUrl(''); toast('音频播放失败', 'error'); });
    audioRef.current = context;
    setPlayingUrl(url);
  };

  const openDocument = (url: string) => {
    loadingToast('正在下载…');
    Taro.downloadFile({
      url,
      success: (res) => {
        hideFeedbackToast();
        if (res.statusCode !== 200) { toast('文件下载失败', 'error'); return; }
        Taro.openDocument({ filePath: res.tempFilePath, showMenu: true, fail: () => Taro.setClipboardData({ data: url }) });
      },
      fail: () => {
        hideFeedbackToast();
        Taro.setClipboardData({ data: url });
        toast('已复制文件链接');
      },
    });
  };

  /** 加入资产库：历史视图里每条记录的操作行复用（与网页版 RunItem 的 onAsset 对齐） */
  const addAsset = async (result: unknown) => {
    if (!workflow || !result) return;
    const found = extractResultMedia(result);
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
      toast('已加入资产库', 'success');
    } catch (reason) { toast(reason instanceof Error ? reason.message : '保存失败', 'error'); }
  };

  /** 结果文本（复制结果按钮 / 结果正文兜底共用） */
  const resultTextOf = (result: unknown) => {
    if (!result) return '';
    const value = result as { text?: string; kind?: string; data?: unknown };
    if (typeof value.text === 'string' && value.text.trim()) return value.text;
    if (value.kind === 'json') return JSON.stringify(value.data, null, 2);
    return '';
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
      <Text className='audio-play' onClick={() => toggleAudio(url)}>{playingUrl === url ? <TdIcon name='pause-circle' /> : <TdIcon name='play-circle' />}</Text>
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
        <View className='media-grid'>{urls.map((url, mediaIndex) => <Image key={url} className='media-thumb' src={url} mode='aspectFill' onClick={() => setViewer({ urls, current: mediaIndex })} />)}</View>
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
        <Text className='result-text code-text' selectable>{text}</Text>
      </View> : null;
    }
    const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
    return !!text ? <View key={index}>
      <Text className='media-section-title'>{name}</Text>
      <Text className='result-text' selectable>{text}</Text>
    </View> : null;
  };

  /** 结果正文渲染（配置视图的完成卡片、历史视图的每条记录共用） */
  const renderResult = (value: unknown) => {
    if (!value) return null;
    const result = value as { text?: string; kind?: string; data?: Record<string, unknown> };
    const outputFields = (workflow?.outputFields || []) as Array<Record<string, unknown>>;
    const data = result.data && typeof result.data === 'object' && !Array.isArray(result.data) ? result.data : null;
    const hasTagged = !!data && outputFields.some((field) => field.tag && field.enabled !== false);
    if (hasTagged && data) {
      const known = new Set(outputFields.map((field) => String(field.key || field.name)));
      const extra = Object.entries(data).filter(([entryKey]) => !known.has(entryKey));
      return <View>
        {outputFields.filter((field) => field.enabled !== false).map((field, index) => renderTaggedField(field, data[String(field.key || field.name)], index))}
        {!!extra.length && <Text className='extra-json' selectable>{JSON.stringify(Object.fromEntries(extra), null, 2)}</Text>}
      </View>;
    }
    const found = extractResultMedia(value);
    const fallbackText = found.text || (result.kind === 'json' ? JSON.stringify(result.data, null, 2) : '');
    return <View>
      {!!fallbackText && <Text className='result-text' selectable>{fallbackText}</Text>}
      {!!found.images.length && <View className='media-grid'>{found.images.map((url, mediaIndex) => <Image key={url} className='media-thumb' src={url} mode='aspectFill' onClick={() => setViewer({ urls: found.images, current: mediaIndex })} />)}</View>}
      {!!found.videos.length && <View className='media-grid'>{found.videos.map((url) => <Video key={url} className='media-thumb' src={url} controls />)}</View>}
      {!!found.audios.length && renderAudioRows(found.audios, '音频')}
    </View>;
  };

  const renderField = (field: FormField, index: number) => {
    const key = fieldKey(field, index);
    const style = String(field.style || '').toLowerCase();
    const rawType = `${field.type || ''} ${field.inputType || ''}`.toLowerCase();
    const advanced = field.advanced && typeof field.advanced === 'object' ? field.advanced : undefined;
    const advComponent = String(advanced?.component || '').toLowerCase();
    const options = (advanced?.options || field.options || []).map(normalizeOption);
    const hintText = String(advanced?.hint || field.hint || '');
    const value = values[key];
    /** 编辑态（输入框聚焦、或已展开日期/下拉弹层）：驱动聚焦态样式，同时作为键盘避让的滚动目标 */
    const editing = editingKey === key;
    const startEdit = () => setEditingKey(key);
    const endEdit = () => setEditingKey((current) => (current === key ? '' : current));
    /** 编辑态视觉反馈（蓝色描边 + 很淡光晕）；picker-value 展开弹层时同样高亮 */
    const boxClass = (base: string) => `${base}${editing ? ' runtime-control-focus' : ''}`;

    return <View className='runtime-field' key={key} id={fieldAnchorId(index)}>
      <Text className='form-label'>{fieldLabel(field, index)}{field.required ? ' *' : ''}</Text>
      {isFileField(field) ? <>
        {/* 官方 attachments：pending/error 时自带 t-loading 与失败文案，逐张可见上传状态 */}
        <View className='workflow-attachments'>
          <t-attachments
            items={fieldUploads(field, index).map((entry) => ({
              uid: entry.uid,
              url: entry.url,
              name: entry.name,
              size: entry.size,
              fileType: entry.fileType,
              status: entry.status,
              progress: entry.progress,
              errorMessage: entry.errorMessage,
            }))}
            removable
            imageViewer
            onRemove={(event: { detail?: { item?: { uid?: string }; index?: number } }) => removeUpload(field, index, event)}
          />
        </View>
        <Button className='file-button' disabled={isFieldUploading(field, index)} onClick={() => chooseFile(field, index)}>
          {isFieldUploading(field, index) ? '上传中…'
            : fieldUploads(field, index).length ? '已上传，点击继续选择'
              : (isImageField(field) || isVideoField(field)) ? '从相册选择上传' : '选择并上传文件'}
        </Button>
        {!!fieldUploads(field, index).length && <Text className='file-count-note'>
          已上传 {fieldReadyValues(field, index).length} / {fieldUploads(field, index).length} 个文件
          {fieldUploads(field, index).some((entry) => entry.status === 'error') ? '（失败的可单独删除后重试）' : ''}
        </Text>}
      </>
        : (style === 'boolean' || rawType.includes('boolean') || advComponent === 'switch') ? <View className='switch-row'>
          <Text>{fieldLabel(field, index)}</Text>
          <t-switch value={!!value} onChange={(event: { detail?: { value?: unknown } }) => setValues((current) => ({ ...current, [key]: !!event.detail?.value }))} />
        </View>
          : (advComponent === 'slider' || style === 'slider') ? <View className='slider-wrap'>
            <t-slider
              min={advanced?.min ?? 0}
              max={advanced?.max ?? 100}
              step={advanced?.step ?? 1}
              value={Number(value) || advanced?.min || 0}
              label
              onChange={(event: { detail?: { value?: unknown } }) => {
                const next = Number(event.detail?.value ?? advanced?.min ?? 0);
                setValues((current) => ({ ...current, [key]: Number.isNaN(next) ? 0 : next }));
              }}
            />
          </View>
            : (advComponent === 'date' || style === 'date') ? <View className={boxClass('form-input picker-value')} onClick={() => { startEdit(); setFieldPicker({ kind: 'date', key }); }}>
              {String(value || '请选择日期')}
            </View>
              : options.length ? <View className={boxClass('form-input picker-value')} onClick={() => { startEdit(); setFieldPicker({ kind: 'select', key }); }}>
                {String(value ?? field.placeholder ?? '请选择')}
              </View>
                : (style === 'number' || /number|integer/.test(rawType)) ? <Input className={boxClass('form-input')} type='number' value={String(value ?? '')} placeholder={field.placeholder || '请输入数字'} cursorSpacing={24} onFocus={startEdit} onBlur={endEdit} onInput={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))} />
                  : /textarea|multiline/.test(`${style} ${rawType}`) ? <Textarea className={boxClass('runtime-textarea')} value={String(value || '')} placeholder={field.placeholder || '请输入'} cursorSpacing={24} onFocus={startEdit} onBlur={endEdit} onInput={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))} />
                    : <Input className={boxClass('form-input')} value={String(value ?? '')} placeholder={field.placeholder || '请输入'} cursorSpacing={24} onFocus={startEdit} onBlur={endEdit} onInput={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))} />}
      {!!hintText && <Text className='field-hint'>{hintText}</Text>}
    </View>;
  };

  /** 记录时间行：相对时间（+ 可选消耗点数），对齐网页版 RunItem 的 meta 行 */
  const renderRunMeta = (createdAt?: string, cost?: number) => <View className='run-meta'>
    <Text className='run-meta-time'>{createdAt ? timeAgo(createdAt) : '刚刚'}</Text>
    {!!cost && <Text className='run-meta-time'>· 消耗 {cost} 点</Text>}
  </View>;

  /** 用户输入气泡（右侧蓝渐变 + 「我」头像），对齐网页版 RunItem 的 user inputs 区 */
  const renderRunInputs = (inputs?: Record<string, unknown>) => {
    const rows = fields.map((field, index) => {
      const value = inputs?.[fieldKey(field, index)];
      if (value === undefined || value === null || value === '') return null;
      const display = isFileField(field)
        ? `${Array.isArray(value) ? value.length : 1} 个文件`
        : typeof value === 'object' ? JSON.stringify(value) : String(value);
      return { key: fieldKey(field, index), label: fieldLabel(field, index), value: display };
    }).filter((row): row is { key: string; label: string; value: string } => !!row);
    return <View className='run-ask'>
      <View className='run-bubble'>
        {rows.length ? rows.map((row) => <View key={row.key} className='run-bubble-row'>
          <Text className='run-bubble-label'>{row.label}：</Text>
          <Text className='run-bubble-value'>{row.value}</Text>
        </View>) : <Text className='run-bubble-value'>已提交运行请求</Text>}
      </View>
      <View className='run-user-avatar'><Text className='run-user-avatar-char'>我</Text></View>
    </View>;
  };

  /** 工作流侧头像（与页头同一套兜底） */
  const renderRunAvatar = () => <View className='run-answer-avatar' style={{ background: workflowAvatar.background }}>
    {workflowAvatar.url
      ? <Image className='run-answer-avatar-img' src={workflowAvatar.url} mode='aspectFill' lazyLoad webp />
      : <Text className='header-avatar-glyph'>{workflowAvatar.glyph}</Text>}
  </View>;

  /** 进行中/失败的当前任务卡片（历史列表顶部，任务落库前先占位；失败态历史里没有记录，必须在这里呈现） */
  const renderActiveCard = () => {
    if (!task || (task.status !== 'queued' && task.status !== 'running' && task.status !== 'failed')) return null;
    const failed = task.status === 'failed';
    return <View className='run-item'>
      {renderRunMeta(task.completedAt || task.createdAt || new Date().toISOString())}
      {renderRunInputs(lastSnapshotRef.current || undefined)}
      <View className='run-answer'>
        {renderRunAvatar()}
        <View className='run-answer-card'>
          <View className='run-answer-head'>
            <Text className='run-answer-name'>{workflow?.name || '工作流'}</Text>
            <Text className={`run-answer-status${failed ? ' run-answer-status-failed' : ' run-answer-status-running'}`}>
              {failed ? '运行失败' : task.status === 'queued' ? '排队中' : '运行中…'}
            </Text>
          </View>
          <Text className='run-running-hint' selectable>{failed ? (task.error || '本次运行失败，请调整参数后重试') : 'AI 正在生成，请稍候…'}</Text>
        </View>
      </View>
    </View>;
  };

  /**
   * 一条运行记录卡片（对齐网页版 RunItem）：
   * 时间（+消耗） → 用户输入气泡 → 工作流卡片（名称 + 运行完成 + 媒体统计 + 结果 + 操作行）。
   * 列表接口已剥离 result，故详情按 id 懒加载；未加载时给「点击查看运行结果」入口。
   */
  const renderRunCard = (record: HistoryRecord, position: number) => {
    const recordId = String(record.id || '');
    const key = recordId || `run_${position}`;
    const detail = recordId ? runDetails[recordId] : undefined;
    const loading = !!recordId && !!detailLoading[recordId];
    const result = detail?.result;
    const media = result ? extractResultMedia(result) : { text: '', images: [] as string[], videos: [] as string[], audios: [] as string[] };
    const outputFields = (workflow?.outputFields || []) as Array<Record<string, unknown>>;
    const taggedResult = !!result && outputFields.some((field) => field.tag && field.enabled !== false);
    const hasBody = !!result && taggedResult
      || !!result && (!!media.text || media.images.length > 0 || media.videos.length > 0 || media.audios.length > 0);
    const copyText = resultTextOf(result);
    return <View key={key} className='run-item'>
      {renderRunMeta(String(record.createdAt || ''), Number(detail?.cost || record.cost || 0) || 0)}
      {renderRunInputs(detail?.inputs)}
      <View className='run-answer'>
        {renderRunAvatar()}
        <View className='run-answer-card'>
          <View className='run-answer-head'>
            <Text className='run-answer-name'>{workflow?.name || '工作流'}</Text>
            <Text className='run-answer-status'><TdIcon name='check-circle' className='run-answer-status-icon' />运行完成</Text>
          </View>
          {!detail && <View className='run-placeholder' hoverClass='msg-action-hover' onClick={() => recordId && void loadRunDetail(recordId)}>
            <Text className='run-placeholder-text'>{loading ? '加载运行结果…' : recordId ? '点击查看运行结果' : '该记录缺少结果信息'}</Text>
          </View>}
          {!!detail && <>
            {(media.images.length > 0 || media.videos.length > 0) && <View className='run-media-stat'>
              {media.images.length > 0 && <Text className='run-media-stat-item'><TdIcon name='image' className='run-media-icon' />{media.images.length} 张图</Text>}
              {media.videos.length > 0 && <Text className='run-media-stat-item'><TdIcon name='video' className='run-media-icon' />{media.videos.length} 段视频</Text>}
            </View>}
            {hasBody ? renderResult(result) : <Text className='run-placeholder-text'>该记录没有可展示的结果</Text>}
            <View className='run-toolbar'>
              <Text className='run-toolbar-action' onClick={() => void addAsset(result)}>加入资产库</Text>
              {!!copyText && <Text className='run-toolbar-action' onClick={() => {
                Taro.setClipboardData({ data: copyText });
                toast('已复制到剪贴板', 'success');
              }}><TdIcon name='copy' className='run-toolbar-icon' />复制结果</Text>}
              {media.images.map((url, index) => <Text key={`${url}:${index}`} className='run-toolbar-action' onClick={() => setViewer({ urls: media.images, current: index })}>图片 {index + 1}</Text>)}
            </View>
          </>}
        </View>
      </View>
    </View>;
  };

  /** 关闭弹层：同时退出编辑态（撤掉聚焦态描边、清空键盘避让的滚动目标） */
  const closeFieldPicker = () => {
    setFieldPicker(null);
    setEditingKey('');
  };

  const activePickerField = fieldPicker
    ? fields.find((field, index) => fieldKey(field, index) === fieldPicker.key)
    : undefined;
  const selectOptions = (() => {
    if (!fieldPicker || fieldPicker.kind !== 'select' || !activePickerField) return [];
    const raw = (activePickerField.advanced && typeof activePickerField.advanced === 'object'
      ? activePickerField.advanced.options
      : undefined) || activePickerField.options || [];
    return raw.map(normalizeOption).map((item) => ({ label: item.label || '', value: item.value ?? item.label ?? '' }));
  })();
  const pickerValue = fieldPicker ? [String(values[fieldPicker.key] ?? '')] : [];

  const confirmDatePicker = (event: { detail?: { value?: unknown } }) => {
    const picked = String(event.detail?.value ?? '');
    if (fieldPicker) setValues((current) => ({ ...current, [fieldPicker.key]: picked }));
    closeFieldPicker();
  };

  const confirmSelectPicker = (event: { detail?: { value?: unknown[] } }) => {
    const picked = Array.isArray(event.detail?.value) ? event.detail.value[0] : undefined;
    if (fieldPicker) setValues((current) => ({ ...current, [fieldPicker.key]: picked === undefined ? '' : picked }));
    closeFieldPicker();
  };

  const { pageStyle } = useThemePage();
  /**
   * 键盘弹起时把页面收窄到键盘上沿：内联 px 不参与 rpx 转换，微信按逻辑像素处理，
   * 正好等于键盘高度的单位（与对话页同一套做法）。`.runtime-page` 带 min-height:100vh，
   * min-height 会压过 height，所以内联里必须一并归零，否则收窄失效。
   */
  const keyboardStyle = keyboardHeight ? `height:calc(100vh - ${keyboardHeight}px);min-height:0` : '';
  const rootStyle = [pageStyle, keyboardStyle].filter(Boolean).join(';');
  return <View className={`runtime-page${keyboardHeight ? ' runtime-page-kb' : ''}`} style={rootStyle}>
    <PageState loading={loading} error={error && !workflow ? error : ''} empty={!loading && !error && !workflow} />
    {workflow && <>
      <View className='runtime-header header-row'>
        <View className='header-main'>
          <View className='header-avatar'>{workflowAvatar.url
            ? <Image className='header-avatar-img' src={workflowAvatar.url} mode='aspectFill' lazyLoad webp />
            : <View className='header-avatar-img header-avatar-fallback' style={{ background: workflowAvatar.background }}>
              <Text className='header-avatar-glyph'>{workflowAvatar.glyph}</Text>
            </View>}</View>
          <View className='header-titles'>
            <Text className='card-title'>{workflow.name}</Text>
            <Text className='muted'>{configView ? '配置参数 · 一键运行' : '历史记录 · 查看运行结果'}</Text>
          </View>
        </View>
        <View className='header-actions'>
          {/* 一个按钮两态：配置参数视图 → 去历史记录；历史视图 → 回配置参数（对齐网页版 SubHeader） */}
          <Text className='header-icon-btn' onClick={toggleView} aria-label={configView ? '历史记录' : '配置参数'}>
            <TdIcon name={configView ? 'chat' : 'control-platform'} />
          </Text>
          <Text className='header-icon-btn' onClick={() => setInfoOpen(true)}><TdIcon name='info-circle' /></Text>
        </View>
      </View>

      {configView ? <ScrollView className='workflow-scroll' scrollY scrollWithAnimation scrollIntoView={scrollTarget}>
        <View className='card'>
          <View className='config-card-head'>
            <Text className='card-title'>配置参数</Text>
            {!!fields.length && <Text className='reset-link' onClick={resetFields}>↺ 重置参数</Text>}
          </View>
          {fields.length ? fields.map(renderField) : <Text className='muted'>该工作流无需输入参数</Text>}
        </View>
        {!!error && <Text className='runtime-error' selectable>{error}</Text>}
      </ScrollView> : <ScrollView className='workflow-scroll' scrollY>
        {historyLoading && !historyList.length ? <Text className='history-empty'>加载中…</Text>
          : !historyList.length && !task ? <View className='run-empty'>
            <View className='run-empty-icon'><TdIcon name='play' /></View>
            <Text className='run-empty-title'>暂无运行记录</Text>
            <Text className='run-empty-desc'>填写参数并点击「开始运行」，结果会在这里显示</Text>
          </View>
            : <>
              {renderActiveCard()}
              {historyList.map(renderRunCard)}
            </>}
        {!!error && <Text className='runtime-error' selectable>{error}</Text>}
      </ScrollView>}
      {configView && <Button className='primary-button runtime-submit' loading={task?.status === 'queued' || task?.status === 'running'} disabled={task?.status === 'queued' || task?.status === 'running'} onClick={submit}>开始运行</Button>}

      <SideDrawer open={infoOpen} title='工作流信息' onClose={() => setInfoOpen(false)}>
        <EntityInfoCard entity={workflow} type='workflow' />
      </SideDrawer>
      <t-toast id='t-toast' theme='info' />
      <t-date-time-picker
        visible={fieldPicker?.kind === 'date'}
        mode='date'
        format='YYYY-MM-DD'
        title='选择日期'
        confirmBtn='确定'
        value={fieldPicker?.kind === 'date' ? String(values[fieldPicker.key] ?? '') : ''}
        onConfirm={confirmDatePicker}
        onCancel={closeFieldPicker}
      />
      <t-picker
        visible={fieldPicker?.kind === 'select'}
        title={activePickerField ? fieldLabel(activePickerField, fields.findIndex((field, index) => fieldKey(field, index) === fieldPicker?.key)) : '请选择'}
        value={pickerValue}
        onConfirm={confirmSelectPicker}
        onCancel={closeFieldPicker}
      >
        <t-picker-item options={selectOptions} />
      </t-picker>
      <t-image-viewer
        visible={!!viewer}
        images={viewer?.urls || []}
        current={viewer?.current || 0}
        closeBtn
        onClose={() => setViewer(null)}
      />
    </>}
  </View>;
}

export default WorkflowPage;
