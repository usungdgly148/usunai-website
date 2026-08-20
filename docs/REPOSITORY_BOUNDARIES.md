# 仓库边界

## 纳入 GitHub

| 目录 | 内容 |
|---|---|
| `server/` | 后端源码、依赖清单和无真实值的环境变量示例 |
| `dist/` | 当前生产前端入口及其实际引用的部署产物 |
| `deploy/` | 不含密钥的服务与反向代理配置 |
| `scripts/` | 本地和 CI 验证脚本 |
| `docs/` | 开发、发布、回退和边界说明 |

## 永不纳入 GitHub

| 生产位置或内容 | 原因 |
|---|---|
| `/opt/usun/.env` | 包含真实环境变量和凭证 |
| `/opt/usun-data/usun.db*` | 生产业务和用户数据 |
| `/opt/usun-data/uploads` | 用户上传文件 |
| `/opt/usun-data/knowledge-files` | 知识库原文件 |
| `/opt/usun-data/qdrant-*` | 向量数据与快照 |
| `/opt/usun-data/image-variants` | 运行时生成的图片变体 |
| `/opt/usun-backups-v2` | 灾难恢复备份，不是源码 |
| `node_modules` | 可由依赖清单重建 |
| `*.bak*`、`*.pre-*` | 临时备份由 Git 历史和发布标签替代 |

GitHub 管理代码历史；腾讯云与 COS 继续管理数据库和整站灾难恢复，两套机制互补。
