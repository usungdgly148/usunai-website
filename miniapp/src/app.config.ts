export default {
  pages: [
    'pages/home/index',
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
