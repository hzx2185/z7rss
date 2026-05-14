# Z7 RSS

Z7 RSS 是一个网页端 RSS 阅读平台，支持多用户、订阅广场、会员套餐、管理员后台、AI 翻译/总结/分类、邮件简报和 Google Reader API 常用兼容接口。

> 文档边界：`README.md` 面向 GitHub 源码仓库和开发人员，说明项目能力、代码结构、本地开发、测试和源码构建。公开镜像用户、普通部署模板、生产运行说明放在 [DOCKER.md](DOCKER.md)。以后修改文档时请先确认读者对象，避免把镜像部署说明写回 README，或把开发者细节写进 DOCKER。

## 功能概览

- 多用户注册、登录、会话管理、改密码和活跃会话管理
- 管理员后台：用户、订单、兑换码、系统配置、插件、内容过滤、站点/IP 屏蔽、审计日志
- RSS / Atom 抓取、网页正文抓取、SQLite 持久化、自动刷新和维护任务
- 全局 Feed 内容池和用户订阅关系隔离
- 阅读中心：订阅管理、文章阅读、分页加载、订阅源分批渲染、AI 翻译和 AI 总结
- 订阅广场：公开分享订阅源、分类浏览、搜索和一键订阅
- 套餐能力控制：Free / Pro / Team，支持 demo 收费流和 Stripe Checkout
- AI 智能分类和 AI 邮件简报
- Google Reader API 常用兼容接口，便于第三方客户端接入
- 隐私保护：API Key、SMTP 密码、订阅源抓取密码和 Cookie 加密存储且不回显明文

## 技术栈

- Node.js 22
- Express
- SQLite / better-sqlite3
- 原生 HTML / CSS / JavaScript
- Stripe Node SDK

## 项目结构

```text
src/
  app.js                 Express 应用组装
  bootstrap.js           服务启动前的依赖初始化
  config.js              环境变量、默认值和运行配置
  db.js                  SQLite 初始化
  lib/                   通用错误、HTTP、校验、安全和 SQLite 健康检查工具
  middleware/            认证中间件
  repositories/          SQLite 访问层
  routes/                HTTP API 路由
  services/              业务服务
public/
  *.html                 前台、会员中心、阅读中心和管理后台页面
  *.js                   页面脚本
  css/                   页面、组件、主题和响应式样式
test/
  *.test.js              node:test 测试
```

## 本地开发

安装依赖：

```bash
npm install
```

启动开发服务：

```bash
npm run dev
```

不通过 Docker 启动时，应用默认监听 `39018`：

```text
http://localhost:39018/
```

运行测试：

```bash
npm test
```

## 源码构建

仓库里的 `docker-compose.yml` 面向源码本地构建，使用 `build: .`：

```yaml
services:
  z7rss:
    build: .
    container_name: z7rss
    ports:
      - "39118:80"
    volumes:
      - ./data:/app/data
```

修改源码后建议：

```bash
npm test
docker compose build z7rss
docker compose up -d z7rss
```

这个 Compose 文件不是公开镜像部署模板。给普通用户复制的 `image: hzx2185/z7rss:latest` 模板请维护在 [DOCKER.md](DOCKER.md)。

## 运行配置分层

- `src/config.js` 维护运行时默认值、环境变量读取和生产安全检查。
- `Dockerfile` 固定镜像内默认值：`PORT=80`、`DB_PATH=/app/data/rss.db`、`APP_SECRET_FILE=/app/data/app-secret`。
- `docker-compose.yml` 只保留源码构建所需的端口和数据卷。
- 管理后台维护站点信息、SMTP、平台默认 AI、套餐权益、内容规则等运行配置。
- 会员中心维护用户自己的 AI 接口、Key、模型、Prompt 和邮件简报规则。

默认不需要 `.env`。只有本地调试高级变量、Stripe、反向代理或生产域名时，才按需添加环境变量。不要把 `.env`、密钥或生产数据提交到仓库。

## 页面入口

- `/`：首页
- `/plaza.html`：订阅广场
- `/pricing.html`：会员套餐
- `/help.html`：帮助中心
- `/changelog.html`：更新日志
- `/member.html`：会员中心
- `/reader.html`：阅读中心
- `/admin.html`：管理后台

## 主要 API 模块

- `/api/auth`：注册、登录、登出和当前用户
- `/api/account`：账号偏好、用户 AI 配置、邮件简报规则、OPML
- `/api/feeds`：订阅源、刷新、导入导出和订阅设置
- `/api/items`：文章列表、详情、翻译和总结
- `/api/billing`：套餐、结账、兑换码和 Stripe Webhook
- `/api/admin`：后台管理能力
- `/reader/api/0/*`：Google Reader API 常用兼容接口

## 文档维护约定

- `README.md` 写给源码维护者：功能、架构、开发、测试、本地源码构建、代码维护注意事项。
- `DOCKER.md` 写给公开镜像用户：镜像功能、最小部署、Compose 模板、生产建议、持久化、备份恢复。
- 不要在 `README.md` 里重复大段公开部署说明；只保留指向 `DOCKER.md` 的链接。
- 不要在 `DOCKER.md` 里展开源码目录、内部 API 清单、开发流程或测试细节；最多说明源码构建和公开镜像模板的区别。

## 隐私与仓库卫生

不要提交或公开本地环境文件、`data/`、数据库备份、日志、本地导出的 OPML 或真实密钥。`data/` 中的 SQLite 数据库可能包含用户邮箱、订阅地址、文章内容、会话信息和加密后的 API Key，请按生产数据处理。
