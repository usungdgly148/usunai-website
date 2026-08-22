import React from 'react';

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { failed: false };
  }

  static getDerivedStateFromError() {
    return { failed: true };
  }

  render() {
    if (!this.state.failed) return this.props.children;

    return (
      <div className="min-h-screen bg-[#f0f4f9] px-5 py-16">
        <div className="mx-auto max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
          <h1 className="text-lg font-semibold text-slate-900">页面暂时没有正常显示</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">请重新加载页面。您的账号数据不会因此丢失。</p>
          <button type="button" onClick={() => window.location.reload()} className="mt-5 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-medium text-white">
            重新加载
          </button>
        </div>
      </div>
    );
  }
}
