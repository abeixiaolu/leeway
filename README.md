# Leeway · 个人财务

一个以人民币记账的私人财务空间。记录可用资金、投资、借贷、日常支出与固定支出，并按中国时间计算月度计划和安全月数。

## 本地运行

需要 Node.js 20+、pnpm 和 PostgreSQL。复制 `.env.example` 为 `.env.local`，填写 `DATABASE_URL`。首次安装和建库：

```bash
pnpm install
pnpm db:generate
pnpm exec prisma migrate deploy
pnpm dev
```

打开 [http://localhost:3000](http://localhost:3000)，注册昵称和私人密码。首版没有密码找回，请妥善保存密码。

## Docker 部署

服务器需要 Docker 和 Docker Compose。将项目放到服务器后，在项目目录执行：

```bash
cp .env.production.example .env.production
# 编辑 .env.production，将两处数据库密码改成同一个随机密码，并设置独立的 CRON_SECRET
docker compose up -d --build
docker compose logs -f app
```

建议用 `openssl rand -hex 32` 分别生成数据库密码和定时任务密钥。数据库只在 Compose 网络内开放；应用默认只监听服务器的 `127.0.0.1:3001`，容器内部仍使用 3000 端口。如 3001 也被占用，可运行 `LEEWAY_PORT=3002 docker compose up -d --build` 改用 3002。首次启动会自动执行数据库迁移。确认 `http://127.0.0.1:3001` 可访问后，用服务器现有的 Nginx 或其他反向代理将域名转发到这个地址，并为域名配置 HTTPS。生产环境的登录 Cookie 需要 HTTPS。

更新项目代码后执行 `docker compose up -d --build`。数据保存在 `postgres_data` 卷中；请定期备份数据库，不要使用 `docker compose down -v` 删除数据卷。

Docker 构建默认从 npmmirror 下载 pnpm 和项目依赖。如果需要改回官方 npm 源，可运行 `docker compose build --build-arg NPM_REGISTRY=https://registry.npmjs.org app`，随后运行 `docker compose up -d`。

自行托管的每日扣款任务可以放在服务器的 crontab 中。服务器使用中国时区时，设置每天 00:05 执行；若服务器使用 UTC，设置每天 16:05 执行。请求地址默认为 `http://127.0.0.1:3001/api/cron/recurring`，请求头为 `Authorization: Bearer <CRON_SECRET>`。例如：

```cron
5 16 * * * curl --fail --silent --show-error -H 'Authorization: Bearer 这里填写CRON_SECRET' http://127.0.0.1:3001/api/cron/recurring >/dev/null
```

上例适用于服务器的 crontab 使用 UTC 的情况。任务可重试，同一固定支出每月只会生成一笔扣款。

## 定时扣款

设置 `CRON_SECRET`。部署在 Vercel 时，`vercel.json` 会每天在中国时间 00:05 调用扣款接口；自行托管时，让定时器每天在该时间之后调用 `GET /api/cron/recurring`，并携带 `Authorization: Bearer <CRON_SECRET>`。同一固定支出每月只会生成一笔扣款，任务可以重试。用户打开首页时也会补齐已到期的扣款。

## 验证

测试使用单独的 PostgreSQL 数据库。将测试库的 `DATABASE_URL` 写入 `.env.local` 后运行：

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```
