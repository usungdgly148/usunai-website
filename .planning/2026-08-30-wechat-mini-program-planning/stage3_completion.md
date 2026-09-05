# 阶段 3：小程序基础界面完成记录

## 已完成

- 建立 Taro 4 + React 18 + TypeScript 微信小程序工程。
- 完成首页、分类、搜索、智能体/工作流详情。
- 完成用户中心、余额与有效期、算力记录、资产、订单记录和账号绑定。
- 完成错误边界、缓存、版本提示、下拉刷新、12 条分页、加载、重试和空状态。
- 生产构建输出位于 `miniapp/dist`，该目录为可再生成产物，不提交 Git。
- 阶段 1、2 的 `/api/miniapp/v1/*` 接口已部署生产。

## 生产验证

- 主站首页返回 HTTP 200。
- `/api/miniapp/v1/health` 返回 HTTP 200。
- `/api/miniapp/v1/content` 返回已上架内容，且未发现凭证、密钥、System Prompt 或第三方内部 ID 字段。
- 未登录访问 `/api/miniapp/v1/me` 返回 HTTP 401 与 `USER_AUTH_REQUIRED`。
- 空登录参数访问 `/api/miniapp/v1/auth/login` 返回 HTTP 400 与 `INVALID_LOGIN_CODE`。
- `usun.service` 重启后保持 `active`，启动日志未出现新增错误。

## 后续边界

- 真实微信登录、账号绑定和界面视觉需在微信开发者工具或真机中完成首次联调。
- 本阶段未上传微信版本、未提交审核，也未开发阶段 4 的智能体对话与工作流运行能力。
