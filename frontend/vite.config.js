import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

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
  server: {
    host: true,
    port: 5177,
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
