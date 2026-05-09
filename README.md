# Z7 RSS

一个支持多用户、套餐收费和 AI 能力的网页端 RSS 阅读平台。

## 已实现

- 多用户注册、登录、会话管理
- 账号安全：改密码、活跃会话管理、禁用账号立即失效
- 前台多页面独立入口：首页、会员套餐、帮助中心、更新日志、会员中心、阅读中心
- 模块化后端结构：认证、订阅、账单、套餐、内容抓取分层
- 全局 Feed 内容池 + 用户订阅关系隔离
- 套餐能力控制
- 免费版 / Pro / Team 套餐
- Demo 收费流
- Stripe Checkout 可选接入
- Stripe 订阅生命周期同步
- 管理员后台
- 系统配置、用户管理、订单管理
- 管理员账号安全处置：查看用户活跃会话、强制下线、重置密码
- 兑换码管理
- 邮件配置存储
- 插件管理
- 内容管理与过滤
- 网站和 IP 屏蔽
- 管理员关键操作审计日志
- 全站刷新任务调度：防重复执行、任务历史、手动触发
- RSS / Atom 抓取与 SQLite 持久化
- 网页正文抓取
- AI 翻译
- AI 总结
- AI 智能分类：规则兜底，后台可手动触发 AI 重新分类
- AI 邮件简报：按套餐配置规则数，每日定时生成约 500 字中文简报并发送邮箱
- Docker Compose 部署
- 订阅广场：公开分享订阅源、按分类浏览、搜索与一键订阅
- 阅读中心订阅源列表分批渲染，订阅源很多时先显示 80 个并按需加载更多
- Google Reader API 常用兼容接口，便于第三方客户端接入
- 隐私保护：API Key、SMTP 密码、订阅源抓取密码和 Cookie 加密存储且不回显明文

## 默认套餐

- `Free`
  - 0 元 / 月
  - 最多 5 个订阅源
  - 不含 AI 翻译和 AI 总结
  - 不含 AI 邮件简报
- `Pro`
  - 29 美元 / 月
  - 最多 50 个订阅源
  - 开启 AI 翻译和 AI 总结
  - 支持 3 条 AI 邮件简报规则
- `Team`
  - 99 美元 / 月
  - 最多 200 个订阅源
  - 开启 AI 翻译和 AI 总结
  - 支持 20 条 AI 邮件简报规则

## 技术栈

- Node.js 22
- Express
- SQLite
- 原生 HTML / CSS / JavaScript
- Stripe Node SDK

## 项目结构

```text
src/
  app.js
  config.js
  db.js
  lib/
  middleware/
  repositories/
  routes/
  services/
public/
  changelog.html
  help.html
  index.html
  member.html
  member.js
  plaza.html
  plaza.js
  pricing.html
  reader.html
  reader.js
  css/
    00-base.css
    pages/
      public.css
      reader.css
      member.css
      admin.css
    reader/
    shared/
      app-utilities.css
      theme-foundation.css
      ui-foundation.css
      data-surfaces.css
      compact-ui.css
      mobile-compact.css
    public/
    member/
      account-shell.css
    admin/
      account-shell.css
    themes/
```

## 前台页面

- `/`：首页，功能介绍与导航入口
- `/plaza.html`：订阅广场，查看公开分享的订阅源
- `/pricing.html`：会员套餐
- `/help.html`：帮助中心
- `/changelog.html`：更新日志
- `/member.html`：会员中心
- `/reader.html`：阅读中心
- `/admin.html`：管理后台

## 启动

1. 复制配置模板

```bash
cp .env.example .env
```

2. 按需修改 `.env`

至少建议确认：

- `APP_URL`
- `HOST_PORT`
- `APP_SECRET`
- `ADMIN_EMAILS`

当前推荐做法：

- `compose` 负责系统启动参数
- 首页、套餐、帮助、日志使用独立静态页面
- 管理后台负责平台默认配置
- 管理后台负责套餐简报权益、SMTP 邮件配置和订阅源 AI 重新分类
- 会员中心负责登录注册、套餐、账单和用户自己的 AI 配置
- 会员中心负责 AI 邮件简报规则：AI 来源、提示词、订阅源范围和接收邮箱
- 会员中心同时支持密码修改和其他设备会话管理
- 阅读中心负责订阅、文章阅读、订阅源分批加载、AI 翻译和 AI 总结
- 订阅广场负责展示用户公开分享的订阅源

3. 如需 Stripe 真正收费，改 `.env` 中：

- `STRIPE_SECRET_KEY`
- `STRIPE_PRICE_PRO_MONTHLY`
- `STRIPE_PRICE_TEAM_MONTHLY`
- `APP_URL`
- `BILLING_PROVIDER`

如果不配置 Stripe，系统默认使用 `demo` 模式，点击升级会直接激活套餐，便于本地联调。

4. 启动

```bash
docker compose up --build -d
```

5. 打开

```text
http://localhost:39118/
```

常用页面：

- `http://localhost:39118/`
- `http://localhost:39118/pricing.html`
- `http://localhost:39118/help.html`
- `http://localhost:39118/changelog.html`
- `http://localhost:39118/plaza.html`
- `http://localhost:39118/member.html`
- `http://localhost:39118/reader.html`
- `http://localhost:39118/admin.html`

更完整的 Docker 部署、端口、持久化和隐私说明见 [DOCKER.md](DOCKER.md)。

## 性能优化

- 启动优化：维护任务延迟 30 秒执行，数据库优化在后台异步执行
- 阅读中心订阅源列表分批渲染（默认 80 个），按需加载更多
- 文章列表支持虚拟滚动和分页加载

## 代码质量

- 删除未使用的 `getSystemAiConfig` 函数
- 合并重复的 `testSystemAi` / `testUserAi` 为单一函数 `testAi(userId)`
- 提取公共工具函数 `describeFetchError` 和 `normalizeText` 到 `src/lib/http.js`

## 主要接口

- `GET /api/config`
- `POST /api/auth/register`
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/auth/me`
- `GET /api/plaza`
- `GET /api/feeds`
- `POST /api/feeds`
- `DELETE /api/feeds/:feedId`
- `POST /api/feeds/:feedId/refresh`
- `POST /api/feeds/refresh-all`
- `GET /api/items`
- `GET /api/items/:id`
- `POST /api/items/:id/translate`
- `POST /api/items/:id/summarize`
- `GET /api/billing/overview`
- `POST /api/billing/checkout`
- `POST /api/billing/redeem`
- `POST /api/billing/webhook`
- `GET /api/account/preferences`
- `POST /api/account/preferences/ai`
- `POST /api/account/preferences/ai/test`
- `GET /api/account/digest-rules`
- `POST /api/account/digest-rules`
- `POST /api/account/digest-rules/:id`
- `DELETE /api/account/digest-rules/:id`
- `POST /api/account/digest-rules/:id/test`
- `GET /api/admin/dashboard`
- `POST /api/admin/refresh`
- `POST /api/admin/ai/test`
- `POST /api/admin/feeds/reclassify`
- `POST /api/admin/feeds/:feedId/reclassify`
- `POST /api/admin/users/:userId`
- `POST /api/admin/settings/:category`
- `POST /api/admin/redeem-codes`
- `POST /api/admin/plugins`
- `POST /api/admin/content-rules`
- `POST /api/admin/blocked-sites`
- `POST /api/admin/blocked-ips`

## 阅读中心体验

- 订阅源列表支持搜索、未读、归档、异常、长期未刷新、分类和公开状态筛选。
- 订阅源很多时，前端默认先渲染 80 个，底部点击“加载更多”继续追加，避免一次性渲染过多 DOM。
- 筛选和搜索仍基于完整订阅源数据执行，分批显示只影响页面渲染数量。
- 批量“全选可见”只选择当前已经显示的订阅源，避免误操作隐藏或未加载的订阅。
- 文章列表继续使用分页和加载下一页，支持列表、表格、杂志视图。

## 配置分层

- `.env` / `docker compose`
  - `HOST_PORT`
  - `APP_URL`
  - `PORT`
  - `DB_PATH`
  - `REFRESH_INTERVAL_MINUTES`
  - `MAINTENANCE_INTERVAL_MINUTES`
  - `DATABASE_BACKUP_ENABLED`
  - `DATABASE_BACKUP_RETENTION_DAYS`
  - `DATABASE_BACKUP_MAX_FILES`
  - `AUDIT_LOG_RETENTION_DAYS`
  - `AUDIT_LOG_MAX_ENTRIES`
  - `REFRESH_RUN_RETENTION_DAYS`
  - `REFRESH_RUN_MAX_ENTRIES`
  - `SESSION_COOKIE_NAME`
  - `APP_SECRET`
  - `ADMIN_EMAILS`
  - `BILLING_PROVIDER`
  - `STRIPE_*`
- 管理后台
  - 平台站点设置
  - 邮件默认配置
  - 平台默认 AI 接口、Key、模型
  - 套餐 AI 简报和邮件简报权益
  - 数据库自动备份开关、保留天数和最大份数
  - 订阅源 AI 智能分类
- 用户会员中心
  - 用户自定义 AI Base URL
  - 用户自定义 AI Key
  - 用户自定义 AI Model
  - 用户自定义翻译与总结 Prompt
  - AI 邮件简报规则、收件邮箱、简报 Prompt
  - 已配置 Key 不回显明文，留空表示保留原值

## Compose 启动参数

- `HOST_PORT`：宿主机暴露端口，默认 `39118`
- `PORT`：容器监听端口，默认 `39018`
- `APP_URL`：前端访问地址
- `DB_PATH`：SQLite 文件路径
- `SESSION_COOKIE_NAME`：会话 Cookie 名称
- `SESSION_TTL_DAYS`：会话有效天数
- `SESSION_COOKIE_SECURE`：是否只允许 HTTPS Cookie
- `TRUST_PROXY`：反向代理后是否信任代理头
- `APP_SECRET`：会话签名密钥，生产环境必须改为高强度随机值
- `ADMIN_EMAILS`：预设管理员邮箱，逗号分隔
- `REFRESH_INTERVAL_MINUTES`：自动刷新周期
- `MAINTENANCE_INTERVAL_MINUTES`：自动维护与数据清理周期
- `DATABASE_BACKUP_ENABLED`：自动维护时是否创建数据库备份，默认 `true`
- `DATABASE_BACKUP_RETENTION_DAYS`：自动备份保留天数，默认 `14`
- `DATABASE_BACKUP_MAX_FILES`：自动备份最多保留份数，默认 `24`
- `AUDIT_LOG_RETENTION_DAYS`：审计日志保留天数
- `AUDIT_LOG_MAX_ENTRIES`：审计日志最大保留条数
- `REFRESH_RUN_RETENTION_DAYS`：刷新历史保留天数
- `REFRESH_RUN_MAX_ENTRIES`：刷新历史最大保留条数
- `CRAWL_TIMEOUT_MS`：抓取超时
- `USER_AGENT`：抓取请求头
- `AI_ENABLED`：是否启用 AI 模块总开关
- 邮件简报依赖后台 SMTP 配置；SMTP 密码加密存储且不会回显明文。
- `AI_BASE_URL`：默认 AI 接口地址
- `AI_API_KEY`：默认 AI Key
- `AI_MODEL`：默认 AI 模型
- `DEEPLX_API_URL`：DeepLX 接口地址
- `BILLING_PROVIDER`：`demo` 或 `stripe`
- `STRIPE_SECRET_KEY`：Stripe Secret Key
- `STRIPE_PRICE_PRO_MONTHLY`：Pro 价格 ID
- `STRIPE_PRICE_TEAM_MONTHLY`：Team 价格 ID

## Docker 维护约定

- 修改代码后建议执行 `npm test`，再执行 `docker compose build z7rss` 和 `docker compose up -d z7rss` 重建并替换容器。
- 本项目默认只对外暴露 `HOST_PORT`，默认 `39118`；不要同时保留临时 `node src/server.js` 进程监听其他端口。
- 如需本地临时调试，结束后用 `lsof -nP -iTCP -sTCP:LISTEN` 检查并停掉临时端口。
- 生产数据在 `data/`，重建镜像不会清空数据；删除 `data/` 或数据库备份前必须先确认。

## 管理后台范围

- 系统配置：站点名、邮件发件人、SMTP 主机等键值配置
- 用户管理：查看用户、切换管理员、禁用/启用用户、查看会话、强制下线、重置密码
- 订单管理：查看全部账单与支付记录
- 兑换码管理：创建套餐兑换码并发给用户
- 邮件配置：后台配置 SMTP 后，AI 邮件简报可按规则自动发送
- 插件管理：登记插件、启用/停用插件元数据
- 内容管理：查看全站 Feed 与最新内容
- 后台刷新：查看全站刷新状态与历史，支持管理员手动触发
- 内容过滤：按标题/摘要/链接规则阻断内容入库
- 网站屏蔽：阻止订阅指定域名
- IP 屏蔽：阻止指定 IP 访问系统
- 会员中心：付费套餐可自定义 AI 接口和 Prompt
- AI 测试：后台和会员中心都支持测试当前配置

## 当前限制

- 暂未实现组织空间、邀请成员、共享订阅池
- AI Key 已改为加密存储在 SQLite；前端不会回显明文，但正式生产仍建议接入更强的密钥托管与轮换
- 暂未做邮件验证、找回密码与细粒度权限

## 隐私与仓库卫生

- `.env`、`data/`、数据库备份和本地依赖不应提交或复制给第三方。
- `.dockerignore` 已排除 `.env`、`data/`、`node_modules/`、测试目录和 `.DS_Store`，避免进入 Docker 构建上下文。
- `data/` 中的 SQLite 数据库可能包含用户邮箱、订阅地址、文章内容、会话信息和加密后的 Key，请按生产数据处理。
- 生产环境不要使用默认 `APP_SECRET`，并建议启用 HTTPS。
