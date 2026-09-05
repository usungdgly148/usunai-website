import { useEffect, useMemo, useState } from 'react';
import Taro, { useRouter } from '@tarojs/taro';
import { Button, Image, Input, Picker, ScrollView, Text, Textarea, Video, View } from '@tarojs/components';
import { PageState } from '../../components/page-state';
import { getPublicContent, getRuntimeTask, saveRuntimeAsset, saveRuntimeHistory, submitWorkflowTask, uploadRuntimeFile } from '../../services/api';
import { collectMediaUrls, fileToDataUrl, runtimeId } from '../../services/runtime';
import type { ContentItem, FormField, RuntimeTask } from '../../types';

const ACTIVE_TASK_PREFIX = 'usunai_miniapp_active_workflow_';
const fieldKey = (field: FormField, index: number) => String(field.key || field.name || field.id || `field_${index}`);
const fieldLabel = (field: FormField, index: number) => String(field.label || field.name || field.key || `参数 ${index + 1}`);

export default function WorkflowPage() {
  const { params } = useRouter();
  const [workflow, setWorkflow] = useState<ContentItem>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [task, setTask] = useState<RuntimeTask>();
  const fields = workflow?.formFields || [];
  const media = useMemo(() => collectMediaUrls(task?.result), [task?.result]);

  useEffect(() => {
    getPublicContent().then((content) => {
      const item = content.workflows.find((entry) => entry.id === params.id);
      if (!item) throw new Error('工作流不存在或未上架');
      setWorkflow(item);
      const activeId = Taro.getStorageSync<string>(`${ACTIVE_TASK_PREFIX}${item.id}`);
      if (activeId) void refreshTask(activeId, item.id);
    }).catch((reason) => setError(reason.message || '加载失败')).finally(() => setLoading(false));
  }, [params.id]);

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

  const chooseFile = async (field: FormField, index: number) => {
    if (!workflow) return;
    const key = fieldKey(field, index);
    try {
      const selected = await Taro.chooseMessageFile({ count: /array|multiple/i.test(`${field.type} ${field.inputType}`) ? 9 : 1, type: 'all' });
      const uploaded: Array<string | { file_id: string }> = [];
      for (const file of selected.tempFiles) {
        const mime = file.type || (/\.(png|jpe?g|webp)$/i.test(file.name) ? 'image/jpeg' : 'application/octet-stream');
        const dataUrl = await fileToDataUrl(file.path, mime);
        const result = await uploadRuntimeFile({ targetType: 'workflow', targetId: workflow.id, dataUrl, fileName: file.name, fileType: mime });
        if (result.fileId) uploaded.push({ file_id: result.fileId });
        else if (result.dataUrl) uploaded.push(result.dataUrl);
      }
      setValues((current) => ({ ...current, [key]: /array|multiple/i.test(`${field.type} ${field.inputType}`) ? uploaded : uploaded[0] }));
    } catch (reason) { Taro.showToast({ title: reason instanceof Error ? reason.message : '文件上传失败', icon: 'none' }); }
  };

  const submit = async () => {
    if (!workflow || task?.status === 'queued' || task?.status === 'running') return;
    const missing = fields.find((field, index) => field.required && !values[fieldKey(field, index)]);
    if (missing) { Taro.showToast({ title: `请填写${fieldLabel(missing, fields.indexOf(missing))}`, icon: 'none' }); return; }
    setError('');
    try {
      const idempotencyKey = runtimeId(`workflow_${workflow.id}`);
      const created = await submitWorkflowTask(workflow.id, values, idempotencyKey);
      setTask(created);
      Taro.setStorageSync(`${ACTIVE_TASK_PREFIX}${workflow.id}`, created.id);
      void refreshTask(created.id, workflow.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : '工作流提交失败'); }
  };

  const addAsset = async () => {
    if (!workflow || !task?.result) return;
    try {
      await saveRuntimeAsset({ id: runtimeId('asset'), name: `${workflow.name} 运行结果`, type: workflow.assetCategory || (media.videos.length ? 'video' : media.images.length ? 'image' : 'copy'), content: task.result, source: `workflow:${workflow.id}`, createdAt: new Date().toISOString() });
      Taro.showToast({ title: '已加入资产库', icon: 'success' });
    } catch (reason) { Taro.showToast({ title: reason instanceof Error ? reason.message : '保存失败', icon: 'none' }); }
  };

  const renderField = (field: FormField, index: number) => {
    const key = fieldKey(field, index);
    const type = `${field.type || ''} ${field.inputType || ''}`.toLowerCase();
    const options = (field.options || []).map((option) => typeof option === 'string' ? { label: option, value: option } : { label: option.label || option.value || '', value: option.value || option.label || '' });
    return <View className='runtime-field' key={key}>
      <Text className='form-label'>{fieldLabel(field, index)}{field.required ? ' *' : ''}</Text>
      {/file|image|video|audio/.test(type) ? <Button className='file-button' onClick={() => chooseFile(field, index)}>{values[key] ? '已上传，点击更换' : '选择并上传文件'}</Button>
        : options.length ? <Picker mode='selector' range={options.map((item) => item.label)} onChange={(event) => setValues((current) => ({ ...current, [key]: options[Number(event.detail.value)]?.value }))}><View className='form-input picker-value'>{String(values[key] || field.placeholder || '请选择')}</View></Picker>
          : /textarea|multiline/.test(type) ? <Textarea className='runtime-textarea' value={String(values[key] || '')} placeholder={field.placeholder || '请输入'} onInput={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))} />
            : <Input className='form-input' value={String(values[key] || '')} placeholder={field.placeholder || '请输入'} onInput={(event) => setValues((current) => ({ ...current, [key]: event.detail.value }))} />}
    </View>;
  };

  return <View className='runtime-page'>
    <PageState loading={loading} error={error && !workflow ? error : ''} empty={!loading && !error && !workflow} />
    {workflow && <>
      <View className='runtime-header'><Text className='card-title'>{workflow.name}</Text><Text className='muted'>配置参数 · 一键运行</Text></View>
      <ScrollView className='workflow-scroll' scrollY>
        <View className='card'>{fields.length ? fields.map(renderField) : <Text className='muted'>该工作流无需输入参数</Text>}</View>
        {!!error && <Text className='runtime-error'>{error}</Text>}
        {task && <View className='card result-card'>
          <Text className='card-title'>{task.status === 'queued' ? '排队中' : task.status === 'running' ? '运行中…' : task.status === 'succeeded' ? '运行完成' : '运行失败'}</Text>
          {task.error && <Text className='runtime-error'>{task.error}</Text>}
          {!!task.result && <Text className='result-text'>{typeof task.result === 'string' ? task.result : JSON.stringify(task.result, null, 2)}</Text>}
          {!!media.images.length && <View className='media-grid'>{media.images.map((url) => <Image key={url} className='media-thumb' src={url} mode='aspectFill' onClick={() => Taro.previewImage({ current: url, urls: media.images })} />)}</View>}
          {!!media.videos.length && <View className='media-grid'>{media.videos.map((url) => <Video key={url} className='media-thumb' src={url} controls />)}</View>}
          {task.status === 'succeeded' && <Button className='secondary-button' onClick={addAsset}>加入资产库</Button>}
        </View>}
      </ScrollView>
      <Button className='primary-button runtime-submit' loading={task?.status === 'queued' || task?.status === 'running'} disabled={task?.status === 'queued' || task?.status === 'running'} onClick={submit}>开始运行</Button>
    </>}
  </View>;
}
