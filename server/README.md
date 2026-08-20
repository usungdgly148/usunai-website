# 第二阶段后端代理（server/index.mjs）

纯 Node（零依赖，仅用内置 `http` / `https` / `fs` / `crypto`），作用是把扣子 Token 收归服务端，
前端只跟本后端通信（同源、无 CORS），由后端带 Token 转发到扣子。

## 为什么需要它
- **Token 不出浏览器**：前端不再持有任何扣子 API Token，避免 F12 被盗用、被刷额度。
- **生产无 CORS**：浏览器只访问自己的后端（同源），不再直接打 `*.coze.site`。
- **OAuth 可用**：OAuth JWT 在服务端用私钥锻造，私钥绝不进前端。
- **可扩展**：后续可加用户鉴权、按门店限流、计费/审计日志。

## 运行
```bash
npm run server          # 启动后端（默认 8787，可用 PORT 环境变量覆盖）
npm run dev             # 启动前端（Vite，5177，/api 已代理到后端）
```
生产可将前端 `npm run build` 后由本后端同源托管（已实现：非 /api 请求回退到 dist/index.html）。

## 接口
- `GET  /api/health`                         健康检查
- `POST /api/coze/chat`                      对话（SSE 流式），body: `{ agentId, sessionId, message }`
- `POST /api/coze/test`                      连接探测（后台「测试连接」用），body: 智能体配置
- `POST /api/coze/oauth-token`               锻造 OAuth JWT（需配置 server/data/oauth.json）
- `GET  /api/admin/agents`                   列出已配置智能体（Token 脱敏）
- `POST /api/admin/agents/:id`               保存/更新智能体配置（含 Token，存服务端）

## 配置存储
- `server/data/agents.json`  各智能体的 platform / baseUrl / projectId / botId / apiKey（**Token 在这里**）
- `server/data/oauth.json`   OAuth 私钥等（参考 `oauth.example.json`）
- 这两个文件已被 `.gitignore` 忽略，请勿提交到仓库。

## 平台支持
- `coze-new`：新版编程项目，调用 `/stream_run`（SSE 流式），需 Project ID + API Token + 部署域名。
- `coze-old`：旧版 Bot API，调用 `/v3/chat`（创建→轮询→拉取），需 Bot ID + PAT。
- `oauth`：由服务端锻造 JWT 后走 `/stream_run`。
