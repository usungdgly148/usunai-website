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
    'pages/webview/index'
  ],
  usingComponents: {
    't-chat-message': 'tdesign-miniprogram/chat-message/chat-message',
    't-toast': 'tdesign-miniprogram/toast/toast',
    't-dialog': 'tdesign-miniprogram/dialog/dialog',
    't-skeleton': 'tdesign-miniprogram/skeleton/skeleton',
    't-tab-bar': 'tdesign-miniprogram/tab-bar/tab-bar',
    't-tab-bar-item': 'tdesign-miniprogram/tab-bar-item/tab-bar-item',
    't-popup': 'tdesign-miniprogram/popup/popup',
    't-switch': 'tdesign-miniprogram/switch/switch',
    't-slider': 'tdesign-miniprogram/slider/slider',
    't-date-time-picker': 'tdesign-miniprogram/date-time-picker/date-time-picker',
    't-picker': 'tdesign-miniprogram/picker/picker',
    't-picker-item': 'tdesign-miniprogram/picker-item/picker-item',
    't-notice-bar': 'tdesign-miniprogram/notice-bar/notice-bar',
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
