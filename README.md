# 友尚 AI 平台代码基线（网页端 + 微信小程序端）

这是 `usunai.top` 生产版本的代码基线，包含网页端网站与微信小程序端两套客户端，以及它们共用的后端服务。用于版本管理、变更审计、检查和安全回退。

## 双端架构

| 端 | 目录 | 技术栈 | API 前缀 |
|---|---|---|---|
| 网页端 | `frontend/` | Vite + React 18 + Tailwind | `/api/*` |
| 微信小程序端 | `miniapp/` | Taro 4.2 + React 18 + TS（13 个页面） | `/api/miniapp/v1/*` |
| 共用后端 | `server/` | Node.js + Express 单进程 | — |

两端共用同一个后端进程：`server/index.mjs` 承载网页端业务路由，小程序端逻辑拆分在 `server/miniapp-*.mjs` 五个模块中（API / 认证 / 运行时 / 布局 / 可观测性）。网页端后台（`frontend/src/pages/AdminMiniappDesign.jsx`）负责编排小程序端首页布局。

## 仓库结构

- `frontend/`：网页端前端源码，可重复构建。
- `miniapp/`：微信小程序端源码（AppID `wx4f071fbfd1e51130`，主体：广州友尚文化传媒有限公司）。
- `server/`：共用后端源码。
- `deploy/`：不含密钥的 Nginx（HTTPS 基线）和 systemd 配置。
- `docs/`：仓库边界、部署、回退、恢复说明。
- `scripts/`：25 个契约检查脚本与构建/校验工具。
- `ops/`：监控探活与 Uptime Kuma 配置脚本。

构建产物（`dist/`）不入库，一律从源码构建：

```bash
npm run build --prefix frontend      # 网页端
npm run build:weapp --prefix miniapp # 小程序端（weapp）
npm run candidate:build              # 全栈候选包（构建 + 打包到 .tmp/candidates/）
```

## 不在仓库中的内容

生产数据库、用户上传文件、知识库文件、向量数据库、图片变体、服务器备份、`.env`、API Key、Token、OAuth 私钥和 SSH 私钥均不得提交。

详细边界见 [docs/REPOSITORY_BOUNDARIES.md](docs/REPOSITORY_BOUNDARIES.md)。

## 本地验证

```bash
npm run verify
```

验证包括：

- 敏感信息模式扫描
- 禁止文件和目录检查
- 后端 JavaScript 语法检查
- 前端入口引用完整性与语法检查（仓库内存在 `dist/` 时自动执行）

完整 CI 流程见 [.github/workflows/ci.yml](.github/workflows/ci.yml)：依赖审计、双端构建、小程序类型检查、候选包构建与校验。

## 版本流程

- `main`：只保存已验证、可对应生产发布的版本。
- `fix/*`：Bug 修复。
- `feature/*`：新功能。
- 每个任务一个分支，验证通过后再合并到 `main`。
- 每次生产发布创建 `candidate-*` 格式的 Git 标签（打标签会触发 CI 构建全栈候选包）。

仓库目前不启用自动生产部署。发布和回退流程见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 与 [docs/ROLLBACK.md](docs/ROLLBACK.md)。
