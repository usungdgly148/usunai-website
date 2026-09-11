import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const ROOT = path.dirname(fileURLToPath(import.meta.url));

// 开发/预览环境动态代理：将 /coze-run/<path>?target=<baseUrl> 转发到任意扣子部署域名，
// 解决浏览器直接访问 *.coze.run / *.coze.site 时的 CORS 问题。
function createCozeProxyMiddleware() {
  return async (req, res, next) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      const targetBase = url.searchParams.get('target');
      if (!targetBase) {
        res.statusCode = 400;
        res.end('Missing target parameter');
        return;
      }

      // 构造上游 URL：baseUrl + path（去掉 /coze-run 前缀）
      const targetUrl = new URL(targetBase);
      const path = url.pathname.replace(/^\/coze-run/, '');
      targetUrl.pathname = (targetUrl.pathname.replace(/\/$/, '') + path) || '/';

      // 转发关键 header
      const headers = {
        'content-type': req.headers['content-type'] || 'application/json',
      };
      if (req.headers.authorization) headers.authorization = req.headers.authorization;
      if (req.headers.accept) headers.accept = req.headers.accept;

      // 读取请求体
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const body = Buffer.concat(chunks);

      const response = await fetch(targetUrl.toString(), {
        method: req.method,
        headers,
        body: body.length ? body : undefined,
      });

      res.statusCode = response.status;
      response.headers.forEach((value, key) => {
        // 跳过 hop-by-hop 与编码相关 header，避免破坏流式传输
        if (['content-encoding', 'transfer-encoding', 'connection', 'content-length'].includes(key)) return;
        try { res.setHeader(key, value); } catch { /* ignore invalid headers */ }
      });

      if (response.body) {
        const reader = response.body.getReader();
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    } catch (e) {
      res.statusCode = 502;
      res.end('Proxy error: ' + (e.message || e));
    }
  };
}

function cozeDynamicProxy() {
  const middleware = createCozeProxyMiddleware();
  return {
    name: 'coze-dynamic-proxy',
    configureServer(server) {
      server.middlewares.use('/coze-run', middleware);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/coze-run', middleware);
    },
  };
}

export default defineConfig({
  plugins: [react(), cozeDynamicProxy()],
  resolve: {
    alias: [
      /*
       * 后台「小程序设计」的手机画布要**直接复用小程序真机组件**（src/miniapp-preview/），
       * 而真机组件 import 的是 Taro 提供的这两个包。这里把它们换成替身实现，
       * 于是「画布 = 真机渲染结果」成为构造性事实，而不是靠人肉比对两套代码。
       *   @tarojs/components → <view>/<text>/<image> 自定义元素
       *   @tarojs/taro       → 存储 / 事件总线 / 跳转上报
       * ⚠️ frontend 自身不依赖 @tarojs/*（不是小程序包），所以这两个 alias 只可能被画布命中。
       */
      { find: '@tarojs/components', replacement: path.resolve(ROOT, 'src/miniapp-preview/taro-components.jsx') },
      { find: '@tarojs/taro', replacement: path.resolve(ROOT, 'src/miniapp-preview/taro.js') },
    ],
  },
  define: {
    /*
     * 小程序侧由 Taro 的 defineConstants 注入（见 miniapp/config/index.ts）。
     * 画布复用了 miniapp/src/services/api.ts（渲染器要取 API_BASE），
     * 所以这里必须补齐这四个构建期常量，否则运行期直接 ReferenceError。
     * API_BASE 取空串：画布与后台同源，内容里的 /api/... 相对路径直接可用。
     */
    __MINIAPP_ENV__: JSON.stringify('preview'),
    __MINIAPP_API_BASE__: JSON.stringify(''),
    __MINIAPP_VERSION__: JSON.stringify('preview'),
    __MINIAPP_BUILD__: JSON.stringify('preview'),
  },
  optimizeDeps: {
    // 这两个包没有装（由上面的 alias 接管），别让预打包器去 node_modules 里找
    exclude: ['@tarojs/taro', '@tarojs/components'],
  },
  server: {
    host: true,
    port: 5177,
    fs: {
      // dev 模式下要读 miniapp/src 里的组件源码（在 frontend 目录之外）
      allow: [ROOT, path.resolve(ROOT, '..')],
    },
    proxy: {
      // 第二阶段后端代理：前端同源访问 /api，由后端（server/index.mjs）带 Token 转发扣子，
      // 浏览器不再持有任何扣子 Token，也不存在 CORS 问题。
      '/api': {
        target: 'http://localhost:8787',
        changeOrigin: true,
      },
      // 开发环境：将 /coze-api 转发到扣子官方 API，规避浏览器 CORS。
      // 生产环境请改为后端网关代理，前端不直接持有 PAT / 私钥。
      '/coze-api': {
        target: 'https://api.coze.cn',
        changeOrigin: true,
        secure: true,
        rewrite: (p) => p.replace(/^\/coze-api/, ''),
      },
    },
  },
});
