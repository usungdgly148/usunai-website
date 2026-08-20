# 前端源码恢复说明

## 来源

恢复源为本地历史工程 `D:\WorkBuddy\2026-07-18-14-08-59\prototype`。原目录没有 Git 历史，但其 React/Vite 源码能够稳定构建，并可复现该目录原有的 2026-08-05 前端产物。

## 白名单内容

- `frontend/src/`
- `frontend/index.html`
- `frontend/package.json`
- `frontend/package-lock.json`
- `frontend/vite.config.js`
- `frontend/postcss.config.js`
- `frontend/tailwind.config.js`

没有导入旧后端、运行数据、依赖目录、旧构建产物、发布压缩包、截图、诊断脚本或环境变量文件。

## 当前限制

恢复源码早于当前生产版本。它不包含 2026-08-05 之后的全部网站功能与修复，因此 GitHub Actions 目前只负责安全扫描和构建验证，不执行生产部署。

## 后续步骤

1. 以当前生产行为和历史补丁记录为依据，建立功能差异清单。
2. 将后续功能逐项迁回 `frontend/src/`，每项单独验证。
3. 完成桌面端、手机端、后台、智能体、工作流、DeepSeek 和 RAG 回归测试。
4. 在源码构建结果与生产功能一致后，建立候选发布版本和回滚点。
5. 经人工确认后再讨论启用自动生产部署。
