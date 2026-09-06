import Taro from '@tarojs/taro';
import Toast, { hideToast } from '@/tdesign/toast';
import Dialog from '@/tdesign/dialog';

/** TDesign 反馈组件要求传入页面实例，Taro 下通过 getCurrentInstance().page 获取 */
const pageCtx = () => Taro.getCurrentInstance().page as never;

type ToastTheme = 'info' | 'success' | 'warning' | 'error' | 'loading';

/** 轻提示（替代 Taro.showToast），需页面模板内有 <t-toast id='t-toast' /> */
export function toast(message: string, theme: ToastTheme = 'info') {
  Toast({ context: pageCtx(), selector: '#t-toast', message, theme } as never);
}

/** 加载中提示，配合 hideFeedbackToast 使用（替代 Taro.showLoading） */
export function loadingToast(message = '加载中…') {
  Toast({ context: pageCtx(), selector: '#t-toast', message, theme: 'loading', duration: 0 } as never);
}

export function hideFeedbackToast() {
  hideToast({ context: pageCtx(), selector: '#t-toast' } as never);
}

/** 确认弹窗（替代 Taro.showModal），需页面模板内有 <t-dialog id='t-dialog' />；resolve(true)=确认 */
export function confirmDialog(opts: { title?: string; content: string; confirmText?: string; cancelText?: string }): Promise<boolean> {
  return Dialog.confirm({
    context: pageCtx(),
    selector: '#t-dialog',
    title: opts.title || '请确认',
    content: opts.content,
    confirmBtn: opts.confirmText || '确认',
    cancelBtn: opts.cancelText || '取消',
    closeOnOverlayClick: false,
  } as never).then(() => true).catch(() => false);
}
