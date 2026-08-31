import { defineConfig, type UserConfigExport } from '@tarojs/cli';

export default defineConfig(async (merge, { command, mode }) => {
  const base: UserConfigExport = {
    projectName: 'usunai-miniapp',
    date: '2026-08-31',
    designWidth: 750,
    sourceRoot: 'src',
    outputRoot: 'dist',
    framework: 'react',
    compiler: 'webpack5',
    cache: { enable: true },
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
