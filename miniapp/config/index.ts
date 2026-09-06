import { defineConfig, type UserConfigExport } from '@tarojs/cli';
import path from 'path';

export default defineConfig(async (merge, { command, mode }) => {
  const requestedEnvironment = process.env.MINIAPP_ENV || (process.env.NODE_ENV === 'development' ? 'development' : 'production');
  if (!['development', 'experience', 'production'].includes(requestedEnvironment)) {
    throw new Error(`Unsupported MINIAPP_ENV: ${requestedEnvironment}`);
  }
  const defaultApiBase = requestedEnvironment === 'development' ? 'http://127.0.0.1:8787' : 'https://www.usunai.top';
  const apiBase = String(process.env.MINIAPP_API_BASE || defaultApiBase).replace(/\/+$/, '');
  if (requestedEnvironment !== 'development' && !apiBase.startsWith('https://')) {
    throw new Error(`${requestedEnvironment} builds require an HTTPS MINIAPP_API_BASE`);
  }
  const version = String(process.env.MINIAPP_VERSION || '0.1.0');
  const build = String(process.env.MINIAPP_BUILD || 'local');
  const base: UserConfigExport = {
    projectName: 'usunai-miniapp',
    date: '2026-08-31',
    designWidth: 750,
    sourceRoot: 'src',
    outputRoot: 'dist',
    framework: 'react',
    compiler: 'webpack5',
    cache: { enable: true },
    alias: {
      '@/tdesign': path.resolve(__dirname, '..', 'node_modules/tdesign-miniprogram/miniprogram_dist'),
      // 把 marked/dayjs/tslib/tinycolor2 内联进 tdesign 包，避免运行时解析嵌套 miniprogram_npm 路径或裸包名
      'marked': path.resolve(__dirname, '..', 'node_modules/marked/lib/marked.esm.js'),
      'dayjs': path.resolve(__dirname, '..', 'node_modules/dayjs'),
      'tinycolor2': path.resolve(__dirname, '..', 'node_modules/tinycolor2'),
      'tslib': path.resolve(__dirname, '..', 'node_modules/tslib/tslib.es6.js'),
    },
    copy: {
      patterns: [
        {
          from: 'node_modules/tdesign-miniprogram/miniprogram_dist/',
          to: 'dist/miniprogram_npm/tdesign-miniprogram/',
          ignore: ['*.ts', '*.map'],
        },
        // TDesign 内嵌依赖：chat-markdown.js 运行时通过 import 'marked' / 'tslib' 解析。
        // 必须同时复制到顶层 miniprogram_npm 才能被小程序基础库 ESM 找到。
        // 用 UMD/CommonJS 版本（marked 用 .umd.js、tslib 用 tslib.js），避免运行时 ESM `export` 报错。
        { from: 'node_modules/marked/lib/marked.umd.js', to: 'dist/miniprogram_npm/marked/index.js' },
        { from: 'node_modules/tslib/tslib.js', to: 'dist/miniprogram_npm/tslib/index.js' },
        // dayjs：date-time-picker 运行时 require('dayjs') + require('dayjs/plugin/localeData')，
        // locale/*.js 运行时 require('dayjs/locale/xx')。dayjs 主入口/locale/plugin 均为 UMD（CJS 兼容），
        // 直接物理复制到顶层 miniprogram_npm 供裸名 require 解析（无需 ESM→CJS 转换）。
        { from: 'node_modules/dayjs/dayjs.min.js', to: 'dist/miniprogram_npm/dayjs/index.js' },
        { from: 'node_modules/dayjs/plugin/localeData.js', to: 'dist/miniprogram_npm/dayjs/plugin/localeData.js' },
        { from: 'node_modules/dayjs/locale/ar.js', to: 'dist/miniprogram_npm/dayjs/locale/ar.js' },
        { from: 'node_modules/dayjs/locale/en.js', to: 'dist/miniprogram_npm/dayjs/locale/en.js' },
        { from: 'node_modules/dayjs/locale/it.js', to: 'dist/miniprogram_npm/dayjs/locale/it.js' },
        { from: 'node_modules/dayjs/locale/ja.js', to: 'dist/miniprogram_npm/dayjs/locale/ja.js' },
        { from: 'node_modules/dayjs/locale/ko.js', to: 'dist/miniprogram_npm/dayjs/locale/ko.js' },
        { from: 'node_modules/dayjs/locale/ru.js', to: 'dist/miniprogram_npm/dayjs/locale/ru.js' },
        { from: 'node_modules/dayjs/locale/zh-cn.js', to: 'dist/miniprogram_npm/dayjs/locale/zh-cn.js' },
        { from: 'node_modules/dayjs/locale/zh-tw.js', to: 'dist/miniprogram_npm/dayjs/locale/zh-tw.js' },
        // tinycolor2：color-picker 运行时 require('tinycolor2/esm/tinycolor')。esm 版是 ESM（IDE 模拟器
        // CommonJS 加载会报 export），故复制 CJS 版（tinycolor2/cjs/tinycolor.js）到 esm 路径，等价覆盖导出。
        { from: 'node_modules/tinycolor2/cjs/tinycolor.js', to: 'dist/miniprogram_npm/tinycolor2/esm/tinycolor.js' },
      ],
      options: {},
    },
    defineConstants: {
      __MINIAPP_ENV__: JSON.stringify(requestedEnvironment),
      __MINIAPP_API_BASE__: JSON.stringify(apiBase),
      __MINIAPP_VERSION__: JSON.stringify(version),
      __MINIAPP_BUILD__: JSON.stringify(build),
    },
    mini: {
      postcss: {
        pxtransform: { enable: true, config: {} },
        cssModules: { enable: false, config: { namingPattern: 'module', generateScopedName: '[name]__[local]___[hash:base64:5]' } },
      },
    },
  };
  if (process.env.NODE_ENV === 'development') return merge({}, base, (await import('./dev')).default);
  return merge({}, base, (await import('./prod')).default);
});
