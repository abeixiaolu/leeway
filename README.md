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
