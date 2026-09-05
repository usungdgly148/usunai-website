# 阶段 1：小程序统一 API 契约

## 目标与边界

- 小程序 API 固定前缀：`/api/miniapp/v1`。
- 仅增加适配层，不修改现有 Web API 的请求或响应。
- 小程序与 Web 共用同一个 SQLite/KV 数据源和既有业务规则；不复制用户、算力、订单、资产、历史记录。
- 阶段 1 只提供读取接口。登录换码、账号绑定和写操作在后续阶段实现。

## 统一响应

成功：

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "requestId": "server-generated-or-client-request-id",
    "timestamp": "ISO-8601"
  }
}
```

失败：

```json
{
  "ok": false,
  "error": {
    "code": "STABLE_ERROR_CODE",
    "message": "可展示的中文提示"
  },
  "meta": {
    "requestId": "server-generated-or-client-request-id",
    "timestamp": "ISO-8601"
  }
}
```

服务端始终返回 `X-Request-Id`。客户端可以传入合法的 `X-Request-Id` 便于排障。

## 鉴权约定

- 公开接口无需 Token。
- 用户接口使用 `Authorization: Bearer <user-token>`。
- 管理员 Token 不能访问用户接口，返回 `403 USER_AUTH_REQUIRED`。
- 阶段 2 由微信登录换取普通用户 Token；阶段 1 沿用现有用户会话校验验证数据边界。

## 分页约定

- 请求参数：`page` 从 1 开始；`pageSize` 默认 12，最大 100。
- 响应 `meta` 增加：`page`、`pageSize`、`total`、`totalPages`。
- 列表默认按 `updatedAt / createdAt / time / timestamp` 从新到旧排序。

## 幂等约定

阶段 1 无写接口。后续所有会产生扣费、资产、订单或任务的 `POST` 接口必须：

1. 要求 `Idempotency-Key` 请求头；
2. 相同用户、接口和 Key 返回首次执行结果，不重复扣费或写资产；
3. 相同 Key 但请求体不同返回 `409 IDEMPOTENCY_CONFLICT`；
4. 服务端业务事务继续复用现有 SQLite 原子扣费和记录函数，不在小程序适配层重复实现。

## 接口清单

| 方法 | 路径 | 鉴权 | 同源数据 |
|---|---|---|---|
| GET | `/api/miniapp/v1/health` | 公开 | 服务状态 |
| GET | `/api/miniapp/v1/content` | 公开 | `agents`、`workflows`、`categories`、`categoryGroups`、`banners`、`announcements`、`recommended` |
| GET | `/api/miniapp/v1/me` | 用户 | `reg_<userId>` + `user_<userId>` |
| GET | `/api/miniapp/v1/assets` | 用户 | `assets_<userId>` |
| GET | `/api/miniapp/v1/compute-records` | 用户 | `compute_*` 中当前用户记录 |
| GET | `/api/miniapp/v1/orders` | 用户 | `order_*` 中当前用户记录 |
| GET | `/api/miniapp/v1/history` | 用户 | `hist_*` 中当前用户记录 |

列表接口支持 `page`、`pageSize`、`type`、`q`。

## 公开字段安全边界

- 智能体只返回卡片、教程、开场白、建议问题、价格和展示统计等公开字段。
- 工作流只返回卡片、教程、公开表单字段、输出字段、结果类型、价格和展示统计。
- 明确不返回：`apiKey`、`privateKey`、Token、`authProviderId`、`systemPrompt`、`baseUrl`、`projectId`、`botId`、`workflowId`、`workspaceId`。
- `/content` 只返回已上架的智能体和工作流；推荐列表会移除已下架或不存在的 ID。

## 阶段 1 验收

- 小程序接口读取的用户、算力、资产、订单、历史与 Web 使用相同数据键。
- 管理员 Token 不能读取用户个人接口。
- 公开内容不会下发后台提示词、凭证关联或密钥。
- Web 原接口及构建行为保持不变。
- 已随提交 `5e603f6` 部署生产；首页、健康接口、公开内容字段白名单和鉴权边界烟雾测试通过。
