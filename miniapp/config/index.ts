import { defineConfig, type UserConfigExport } from '@tarojs/cli';

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
