# 人工受控发布流程

当前 GitHub Actions 只做验证和候选产物打包，不执行自动生产部署。GitHub Actions 不连接生产服务器。

## 1. 生成候选包

本地执行：

```bash
npm run candidate:build -- <candidate-label>
```

候选构建要求已跟踪工作区保持干净，确保 `manifest.json.sourceCommit` 能精确对应候选内容。

输出目录为 `.tmp/candidates/<candidate-label>/`，包含：

- `dist/`：由恢复后的前端源码重新构建的静态文件；
- `server/`：后端源码及锁定依赖清单；
- `deploy/`：systemd 与 Nginx 配置样例；
- `manifest.json`：源码提交号、文件大小与 SHA-256 清单。

推送 `candidate-*` 候选标签会完成全部检查并提供保留 14 天的候选产物下载，不会发布到服务器。工作流进入默认分支后，也可以在 GitHub Actions 中手动运行 `Verify code baseline` 生成同样的候选包。

## 2. 发布前条件

1. 候选提交的 GitHub Actions 必须绿色通过。
2. 核对 `manifest.json` 的 `sourceCommit` 与待发布提交一致。
3. 完成 [阶段 E 人工验收清单](./STAGE_E_RELEASE_READINESS.md)。
4. 明确记录当前生产版本、候选版本和回滚版本。
5. 在服务器创建本次将被覆盖文件的精确备份。
6. 必须取得明确的生产部署确认，才可执行后续步骤。

## 3. 生产边界

- 后端代码目标：`/opt/usun/server`
- 前端静态文件目标：`/opt/usun/dist`
- Nginx 与 systemd 配置只有在本次确实变更时才单独发布。
- `/opt/usun/.env`、`/opt/usun-data`、数据库、上传文件、知识库文件、向量数据和备份目录不得被候选包覆盖。
- 不把 `manifest.json` 当作运行文件部署；它只用于校验。

## 4. 人工发布步骤

1. 将候选包上传到服务器新的临时目录，不直接覆盖生产目录。
2. 根据 `manifest.json` 校验候选文件完整性，确认包内没有 `.env`、数据库或用户数据。
3. 在临时目录按锁文件安装后端生产依赖并执行服务端语法检查。
4. 只替换 `dist/` 和本次确认变化的 `server/` 文件；保留旧版本目录作为回滚点。
5. 重启 `usun.service`，确认服务处于 active 状态。
6. 执行首页、登录、后台、智能体、工作流、资产、历史、算力和订单烟雾测试。
7. 持续检查后端日志；若出现新增持续错误，立即执行回滚。

## 5. 发布完成

验证通过后记录发布时间、提交号、候选标签、操作者和验收结果。生产发布不得仅以“页面能打开”作为成功标准。
