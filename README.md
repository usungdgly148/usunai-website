# 友尚 AI 网站代码基线

这是 `usunai.top` 当前生产版本的私有代码基线，用于版本管理、变更审计、检查和安全回退。

## 当前基线的性质

- `server/`：可维护的 Node.js 后端源码。
- `dist/`：当前生产环境正在使用的前端部署产物。
- `deploy/`：不含密钥的 Nginx 和 systemd 配置基线。
- `docs/`：仓库边界、开发、发布和回退说明。

重要：目前没有找到完整的前端 React/Vite 工程源码。因此，`dist/` 只是“可部署产物基线”，不能当作完整前端源码。后续如果找回或重建前端工程，应以可重复构建的源码替换这部分维护方式。

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
- 当前前端入口引用完整性和 JavaScript 语法检查

## 版本流程

- `main`：只保存已验证、可对应生产发布的版本。
- `fix/*`：Bug 修复。
- `feature/*`：新功能。
- 每个任务一个分支，验证通过后再合并到 `main`。
- 每次生产发布创建带说明的 Git 标签。

仓库目前不启用自动生产部署。发布和回退流程见 [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) 与 [docs/ROLLBACK.md](docs/ROLLBACK.md)。
