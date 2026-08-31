# 阶段 2：微信登录与已有账号绑定

## 目标与边界

- 小程序使用 `wx.login` 获取一次性 `code`，仅由服务器向微信 `jscode2session` 换取身份。
- 微信身份映射到现有网站 `userId`，继续复用原用户、算力、有效期、资产、订单和历史数据。
- 新微信身份先创建零余额临时用户；已有用户必须通过邮箱密码或手机短信验证后绑定。
- 不按昵称、头像或未经验证的手机号自动合并账号。
- 本阶段不包含小程序界面、微信支付或生产部署。

## 服务器配置

```text
WECHAT_MINIAPP_APP_ID=wx4f071fbfd1e51130
WECHAT_MINIAPP_APP_SECRET=<仅配置在服务器环境变量或密钥管理服务>
```

`AppSecret` 不进入源码、前端包、接口响应或日志。未配置时登录接口返回 `503 MINIAPP_NOT_CONFIGURED`。

## 接口

### POST `/api/miniapp/v1/auth/login`

请求：

```json
{ "code": "wx.login 返回的一次性 code" }
```

成功响应的 `data`：

```json
{
  "token": "普通小程序用户 token",
  "user": {},
  "isNewUser": true,
  "bindingRequired": true
}
```

- 相同微信身份重复登录不会产生重复网站账号。
- 响应不返回 `openid`、`unionid`、`session_key` 或 AppSecret。
- Token 带有 `client=miniapp` 和内部身份索引，只用于小程序用户会话。

### POST `/api/miniapp/v1/auth/bind`

需要 `Authorization: Bearer <miniapp-token>`。

邮箱绑定：

```json
{ "method": "email", "email": "user@example.com", "password": "用户密码" }
```

手机绑定：

```json
{ "method": "phone", "phone": "手机号", "code": "已发送的短信验证码" }
```

- 邮箱必须验证现有密码；手机必须通过现有短信验证码逻辑。
- 管理员账号禁止绑定到小程序。
- 一个网站账号在同一 AppID 下只能绑定一个微信身份。
- 绑定事务只重定向微信身份，不覆盖目标账号余额、有效期、资产、订单和历史。
- 临时用户会标记为 `merged`，业务使用应在绑定完成后开始。

### GET `/api/miniapp/v1/auth/status`

需要小程序 Token，返回当前身份是否已经绑定。

## 数据存储

继续使用现有 SQLite/KV，不新建第二套用户库。身份键使用 SHA-256 摘要，避免将 OpenID/UnionID 直接暴露为可读键：

- `wxmini_identity_<hash(AppID:OpenID)>`
- `wxmini_union_<hash(AppID:UnionID)>`
- `wxmini_user_<hash(AppID:userId)>`

首次登录解析/创建和账号绑定均使用 SQLite 事务，避免并发重复账号或绑定中间态。

## 会话隔离

- 小程序绑定与状态接口只接受 `client=miniapp` 的普通用户 Token。
- Web 普通用户 Token 不能冒充小程序身份。
- 管理员 Token 永远不能访问小程序用户绑定接口，也不会下发给小程序。
- 绑定成功后签发指向原网站 `userId` 的新 Token。

## 稳定错误码

| 错误码 | 含义 |
|---|---|
| `MINIAPP_NOT_CONFIGURED` | 服务器未配置小程序密钥 |
| `INVALID_LOGIN_CODE` | 一次性 code 格式错误 |
| `WECHAT_CODE_INVALID` | 微信 code 无效或过期 |
| `WECHAT_LOGIN_UNAVAILABLE` | 微信登录服务暂时不可用 |
| `MINIAPP_SESSION_REQUIRED` | 当前不是小程序会话 |
| `ACCOUNT_VERIFICATION_FAILED` | 邮箱密码或短信验证码错误 |
| `ACCOUNT_NOT_FOUND` | 已验证手机号没有对应网站账号 |
| `ACCOUNT_ALREADY_BOUND` | 目标网站账号已绑定其他微信身份 |
| `ADMIN_BIND_FORBIDDEN` | 管理员账号禁止绑定 |

## 验收状态

- 已通过自动化测试：首次登录、重复登录、敏感字段不下发、验证失败、成功绑定、余额保留、Web/小程序会话隔离、缺少配置时安全失败。
- 已通过服务器语法检查和现有阶段 1 契约检查。
- 尚未进行真实 `wx.login -> jscode2session` 联调；该步骤必须在服务器安全配置 AppSecret 后使用微信开发者工具或真机完成。
- 尚未提交或部署生产。
