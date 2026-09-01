import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import { reportClientError } from './services/api';
import './app.scss';

class AppErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    const pages = Taro.getCurrentPages();
    const page = pages[pages.length - 1]?.route || '/miniapp';
    const seed = `${error.name || 'Error'}:${page}`;
    let hash = 2166136261;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    void reportClientError({ page, errorCode: error.name || 'CLIENT_RENDER_ERROR', fingerprint: `fp_${(hash >>> 0).toString(16)}` });
  }

  render() {
    if (this.state.failed) {
      return (
        <View className='fatal-state'>
          <Text className='fatal-title'>页面暂时没有正常显示</Text>
          <Text className='muted'>请重新加载，您的账号数据不会因此丢失。</Text>
          <Button className='primary-button' onClick={() => Taro.reLaunch({ url: '/pages/home/index' })}>重新加载</Button>
        </View>
      );
    }
    return this.props.children;
  }
}

function configureUpdateManager() {
  if (!Taro.canIUse('getUpdateManager')) return;
  const manager = Taro.getUpdateManager();
  manager.onUpdateReady(() => {
    Taro.showModal({
      title: '发现新版本',
      content: '新版本已经准备好，是否立即更新？',
      success: ({ confirm }) => confirm && manager.applyUpdate(),
    });
  });
}

class App extends Component<PropsWithChildren> {
  componentDidMount() {
    configureUpdateManager();
  }

  render() {
    return <AppErrorBoundary>{this.props.children}</AppErrorBoundary>;
  }
}

export default App;
