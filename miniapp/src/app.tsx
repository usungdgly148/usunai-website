import { Component, type ErrorInfo, type PropsWithChildren } from 'react';
import Taro from '@tarojs/taro';
import { Button, Text, View } from '@tarojs/components';
import './app.scss';

class AppErrorBoundary extends Component<PropsWithChildren, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo) {
    // 不记录账号、Token 或请求正文，仅提供可恢复的页面状态。
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
