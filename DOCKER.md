# Docker 部署说明

Z7 RSS 默认使用 Docker Compose 启动，宿主机端口默认是 `39118`，容器内端口默认是 `39018`。

## 快速启动

```bash
cp .env.example .env
docker compose up --build -d
```

打开：

```text
http://localhost:39118/
```

常用命令：

```bash
docker compose ps
docker compose logs -f z7rss
docker compose restart z7rss
docker compose down
```

每次修改代码后的推荐流程：

```bash
npm test
docker compose build z7rss
docker compose up -d z7rss
docker compose ps
```

本项目默认只需要保留 Docker 暴露的 `HOST_PORT`。如果临时启动过 `node src/server.js` 或其他调试端口，发布前请先停掉，避免 39010、39098 等临时端口继续监听。

## 配置

Compose 会自动读取根目录 `.env`。不要把 `.env` 提交或发送给别人。

关键变量：

- `HOST_PORT`：宿主机访问端口，默认 `39118`
- `PORT`：容器内监听端口，默认 `39018`
- `APP_URL`：外部访问地址，本地默认 `http://localhost:39118`
- `DB_PATH`：容器内 SQLite 路径，默认 `/app/data/rss.db`
- `DATABASE_BACKUP_ENABLED`：维护任务是否自动创建数据库备份，默认 `true`
- `DATABASE_BACKUP_RETENTION_DAYS`：备份按天保留，默认 `14`
- `DATABASE_BACKUP_MAX_FILES`：备份最多保留份数，默认 `24`
- `APP_SECRET`：会话签名密钥，生产环境必须改成高强度随机值
- `ADMIN_EMAILS`：管理员邮箱，逗号分隔
- `BILLING_PROVIDER`：`demo` 或 `stripe`
- `STRIPE_*`：Stripe 收费所需配置
- `AI_*`、`DEEPLX_API_URL`：AI 和翻译服务配置

AI 邮件简报使用后台“系统设置”里的 SMTP 配置发送。容器不需要额外端口；只要容器能访问你的 SMTP 服务即可。邮件密码和 AI Key 会加密落库，页面只显示“已配置”状态。

## 数据持久化

Compose 将宿主机 `./data` 挂载到容器 `/app/data`。SQLite 数据库、WAL 文件和备份都在这个目录中。

这些文件可能包含用户邮箱、订阅 URL、文章内容、会话信息、加密后的 API Key 等敏感数据。备份、迁移或排障时请按生产数据处理。

## 隐私与安全

- 不要提交 `.env`、`data/`、数据库备份、日志或本地导出的 OPML。
- 生产环境必须设置新的 `APP_SECRET`，不要使用默认占位值。
- 生产环境建议使用 HTTPS，并将 `APP_URL` 改为 HTTPS 地址。
- 如果系统部署在反向代理后，可按需要设置 `TRUST_PROXY=true` 和 `SESSION_COOKIE_SECURE=true`。
- Stripe、AI、翻译 API Key 应只放在 `.env` 或后台配置中，不要写入源码。
- SMTP 密码、简报收件邮箱、用户订阅源和文章内容都属于敏感数据，会进入 SQLite 数据库和备份。
- `data/` 目录建议定期备份，并限制文件权限。
- 发布或排障前可清理 `.DS_Store`、临时日志和本地导出文件；不要为了“清理”直接删除 `rss.db` 或备份，除非确认要清空生产数据。

## 端口与进程检查

检查当前监听端口：

```bash
lsof -nP -iTCP -sTCP:LISTEN
```

只保留预期的 Docker 端口后，再访问：

```text
http://localhost:39118/
```

如果要换端口，修改 `.env` 中的 `HOST_PORT` 和 `APP_URL`，然后重新构建并启动容器。

## AI 分类与简报

- 后台订阅源列表可点击“AI 分类”，也可以调用 `POST /api/admin/feeds/reclassify` 批量重分。
- 分类采用“大类”策略：规则分类兜底，AI 只允许输出内置大类，避免过细或跑偏。
- Pro 默认支持 3 条简报规则，Team 默认支持 20 条；可在后台套餐配置里调整。
- 简报规则默认每天 `09:00`（Asia/Shanghai）触发，选择订阅源范围、AI 来源、提示词和接收邮箱后自动发送。

## 构建上下文

`.dockerignore` 会排除 `.env`、`data/`、`node_modules/`、测试目录和系统临时文件，避免隐私数据和本地依赖被发送到 Docker 构建上下文。
