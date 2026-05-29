# Z7 RSS Docker 镜像说明

Z7 RSS 是一个网页端 RSS 阅读平台，支持多用户、订阅广场、会员套餐、管理员后台、AI 翻译/总结/分类、邮件简报和 Google Reader API 常用兼容接口。

> 文档边界：`DOCKER.md` 是公开镜像说明，面向直接使用 `hzx2185/z7rss:latest` 的部署用户，主要说明功能、最小部署、生产配置、持久化和恢复。源码结构、本地开发、测试、内部 API 和源码构建细节放在 [README.md](README.md)。以后修改文档时请先确认读者对象，避免把开发者说明写进公开镜像文档。

## 镜像默认约定

- 镜像：`hzx2185/z7rss:latest`
- 容器内端口：`80`
- 推荐宿主机端口：`39118`
- SQLite 默认路径：`/app/data/rss.db`
- 数据持久化目录：`/app/data`
- `APP_SECRET` 未配置时会自动生成，并保存到 `/app/data/app-secret`
- 第一个注册用户会自动成为管理员；也可以用 `ADMIN_EMAILS` 预设管理员邮箱

## 最小部署

新建 `docker-compose.yml`：

```yaml
services:
  z7rss:
    image: hzx2185/z7rss:latest
    container_name: z7rss
    ports:
      - "39118:80"
    volumes:
      - ./data:/app/data
```

启动：

```bash
docker compose up -d
```

访问：

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

## Compose 模板说明

- `image` 使用已发布镜像；只有源码本地构建或自建镜像时才使用 `build`。
- `container_name` 方便固定容器名；同一台机器部署多个实例时可以去掉。
- `ports` 左侧是宿主机端口，默认 `39118`；右侧是容器内端口，固定 `80`。要换端口，改成 `"8080:80"` 这类格式即可。
- `./data:/app/data` 保存 SQLite 数据库、WAL 文件、备份、恢复快照和自动生成的应用密钥。
- `build`、`env_file`、`.env`、`environment` 和 `restart` 都不是最小启动必需项。
- 生产部署建议按需要加回 `restart: unless-stopped`。

仓库源码里的 `docker-compose.yml` 使用 `build: .`，是开发者本地源码构建版，不是公开镜像部署模板。

## 可选 RSSHub 特殊路由

Z7 RSS 不强制依赖 RSSHub。默认会先尝试直接 Feed 发现、后台抓取模板和网页 JSON 自动识别；RSSHub 只是部分网站的兜底转换服务。需要内置 RSSHub 时，可使用下面的模板：

```yaml
services:
  z7rss:
    image: hzx2185/z7rss:latest
    container_name: z7rss
    restart: unless-stopped
    ports:
      - "39118:80"
    environment:
      RSSHUB_BASE_URLS: "http://rsshub:1200"
    volumes:
      - ./data:/app/data
    depends_on:
      - rsshub

  rsshub:
    image: diygod/rsshub:chromium-bundled
    container_name: z7rss-rsshub
    restart: unless-stopped
    ports:
      - "127.0.0.1:1200:1200"
    environment:
      NODE_ENV: production
      CACHE_TYPE: redis
      REDIS_URL: redis://rsshub-redis:6379/
    depends_on:
      - rsshub-redis

  rsshub-redis:
    image: redis:alpine
    container_name: z7rss-rsshub-redis
    restart: unless-stopped
```

- `http://rsshub:1200` 是 Z7 容器访问 RSSHub 的内部地址，不是浏览器访问地址。
- `127.0.0.1:1200:1200` 只把 RSSHub 暴露给本机调试。确实需要外部访问时，把左侧改为 `0.0.0.0:1200:1200`，并自行做好访问控制。
- 已有自建 RSSHub 时，不需要 sidecar，只要在管理后台“特殊路由基址”填写外部地址，或设置 `RSSHUB_BASE_URLS=https://rsshub.example.com`。
- 多个基址用逗号或空格分隔；填 `none` 可以禁用特殊路由候选。

### 定期更新 RSSHub 规则版本

RSSHub 的核心是其庞大的订阅抓取规则库。由于目标网站频繁变动，官方（DIYgod）的抓取规则每天都在发生更新。

如果您在管理后台“系统状态”中点击“检查 RSSHub”发现 **“当前版本”** 和 **“最新版本”** 不一致，或者在其他部署机器上遇到某些路由检查异常，请运行以下命令来拉取最新的 RSSHub 镜像并重启服务：

```bash
docker compose pull rsshub && docker compose up -d rsshub
```

## 推荐生产配置

默认无需 `.env`。生产域名和站点名称优先在管理后台保存；反向代理 HTTPS 场景会自动识别 `X-Forwarded-Proto` / `X-Forwarded-Host`，通常也不需要额外环境变量。需要预设管理员邮箱时，可以按需添加 `ADMIN_EMAILS`：

```yaml
services:
  z7rss:
    image: hzx2185/z7rss:latest
    container_name: z7rss
    restart: unless-stopped
    ports:
      - "39118:80"
    volumes:
      - ./data:/app/data
    environment:
      ADMIN_EMAILS: "admin@example.com"
```

真实收费再加入 Stripe 配置：

```yaml
      BILLING_PROVIDER: "stripe"
      STRIPE_SECRET_KEY: "sk_live_..."
      STRIPE_WEBHOOK_SECRET: "whsec_..."
      STRIPE_PRICE_PRO_MONTHLY: "price_..."
      STRIPE_PRICE_TEAM_MONTHLY: "price_..."
```

不建议设置 `PORT` 或 `DB_PATH`。容器内端口固定为 `80`，数据库默认在 `/app/data/rss.db`。

## 应用内配置

AI、SMTP、套餐权益和站点信息建议在管理后台维护。密钥、SMTP 密码、订阅源抓取密码和 Cookie 会加密存储，前端不会回显明文。

默认 `BILLING_PROVIDER=demo`，点击升级会直接开通套餐，便于试用。真实收费需要配置 Stripe Secret、Webhook Secret 和价格 ID。

## 自动默认值

这些参数不需要写进 Compose：

- 自动刷新周期：`REFRESH_INTERVAL_MINUTES=30`
- 维护任务周期：`MAINTENANCE_INTERVAL_MINUTES=360`
- 数据库自动备份：默认开启，保留 `14` 天、最多 `24` 份
- SQLite 同步级别：默认 `FULL`
- SQLite 忙等待：默认 `10000ms`
- 审计日志保留：默认 `30` 天、最多 `5000` 条
- 刷新历史保留：默认 `14` 天、最多 `1000` 条
- 抓取超时：默认 `15000ms`
- 网页地址自动订阅：默认会发现网页里的 RSS/Atom/JSON Feed；如果页面只有内嵌 JSON 数据，会自动推断 JSON 列表、标题、链接、日期、摘要和正文路径，并写入该订阅的高级抓取配置，用户可再微调。RSSHub 特殊路由是可选兜底能力，配置方式见上方说明。
- 会话 Cookie 名称：默认 `z7rss_session`
- 会话有效期：默认 `30` 天
- 认证、AI 和订阅写入接口限流：应用内置默认值

如果确实需要调整这些高级项，可以按需添加 `environment` 或 `env_file`，无需把它们展开到默认 Compose 模板。

## 数据持久化与恢复

Compose 将宿主机 `./data` 挂载到容器 `/app/data`。默认包含：

- `rss.db`、`rss.db-wal`、`rss.db-shm`
- `backups/` 自动备份
- `recovery-snapshots/` 恢复快照
- `app-secret` 自动生成的应用密钥

这些文件可能包含用户邮箱、订阅 URL、文章内容、会话信息和加密后的 API Key，请按生产数据处理。

不要在服务运行时单独删除 `rss.db-wal` 或 `rss.db-shm`。如果要恢复数据库，先停止容器，再从 `data/backups/` 或 `data/recovery-snapshots/` 选择完整备份恢复。

迁移服务时，请连同整个 `data/` 目录一起迁移；如果使用自动生成的 `app-secret`，缺失该文件会导致旧会话失效。

## 安全建议

- 在管理后台填写公网域名，便于公开页面、帮助页和对外链接显示正确地址。
- 反向代理需要保留 `Host`、`X-Forwarded-Host` 和 `X-Forwarded-Proto` 头；应用会据此处理同源校验和 HTTPS Cookie。
- 可以继续使用自动生成的 `data/app-secret`；也可以显式设置高强度 `APP_SECRET`。
- 不要把 `APP_SECRET`、Stripe Key、AI Key、SMTP 密码、`data/` 或数据库备份提交到公开仓库。
- 定期备份 `data/`，并限制目录权限。

## 页面入口

- `/`：首页
- `/plaza.html`：订阅广场
- `/pricing.html`：会员套餐
- `/help.html`：帮助中心
- `/changelog.html`：更新日志
- `/member.html`：会员中心
- `/reader.html`：阅读中心
- `/admin.html`：管理后台
