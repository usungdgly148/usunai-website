export default {
  pages: [
    'pages/home/index',
    'pages/announcements/index',
    'pages/category/index',
    'pages/search/index',
    'pages/detail/index',
    'pages/chat/index',
    'pages/workflow/index',
    'pages/profile/index',
    'pages/compute/index',
    'pages/assets/index',
    'pages/orders/index',
    'pages/bind/index',
    'pages/account-security/index',
    'pages/legal/index',
    'pages/recharge/index',
    'pages/service/index',
    'pages/hot/index',
    'pages/webview/index'
  ],
  usingComponents: {
    't-chat-message': 'tdesign-miniprogram/chat-message/chat-message',
    // 开场白直接用官方 markdown 组件渲染（与消息链路的 chat-content → chat-markdown 同一套实现）
    't-chat-markdown': 'tdesign-miniprogram/chat-markdown/chat-markdown',
    't-chat-sender': 'tdesign-miniprogram/chat-sender/chat-sender',
    't-chat-actionbar': 'tdesign-miniprogram/chat-actionbar/chat-actionbar',
    // 工作流附件字段：用官方 attachments 直接拿到「status 驱动的加载态」（pending → t-loading）
    't-attachments': 'tdesign-miniprogram/attachments/attachments',
    't-toast': 'tdesign-miniprogram/toast/toast',
    't-dialog': 'tdesign-miniprogram/dialog/dialog',
    't-skeleton': 'tdesign-miniprogram/skeleton/skeleton',
    't-popup': 'tdesign-miniprogram/popup/popup',
    't-switch': 'tdesign-miniprogram/switch/switch',
    't-slider': 'tdesign-miniprogram/slider/slider',
    't-date-time-picker': 'tdesign-miniprogram/date-time-picker/date-time-picker',
    't-picker': 'tdesign-miniprogram/picker/picker',
    't-picker-item': 'tdesign-miniprogram/picker-item/picker-item',
    't-image-viewer': 'tdesign-miniprogram/image-viewer/image-viewer',
    't-empty': 'tdesign-miniprogram/empty/empty',
  },
  window: {
    backgroundTextStyle: 'light',
    navigationBarBackgroundColor: '#f4f7fb',
    navigationBarTitleText: '友尚AI',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f4f7fb'
  },
  networkTimeout: {
    request: 15000,
    uploadFile: 30000
  }
};
