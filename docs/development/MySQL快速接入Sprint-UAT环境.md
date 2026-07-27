# MySQL 快速接入 Sprint：浏览器级 UAT 环境

## 目标与边界

本机只运行一个 MySQL 容器和一个持久数据目录；UAT 是同一容器内的独立数据库：

```text
浏览器 / Playwright Chromium
→ http://127.0.0.1:10086
→ 同源 /api 开发代理
→ http://127.0.0.1:32146
→ MySQL：127.0.0.1:3306
   ├─ knowledge_base      日常 H5 / API
   └─ knowledge_base_uat  隔离 UAT / 破坏性测试
```

`.env` 固定日常 API 到 `knowledge_base`；`.env.uat` 仅在显式启动 UAT API、迁移或测试时加载，固定到 `knowledge_base_uat`。每个 API 进程只读取一组 `MYSQL_*`，不会同时连接两个业务库。

不引入 IndexedDB fallback、双写、同步、回填、浏览器直连 MySQL、远程访问或 wildcard CORS。浏览器验收入口保持 `http://127.0.0.1:10086`。

## 初始化与启动

1. 从模板创建本机 `.env` 和 `.env.uat`。`.env` 必须提供日常与 UAT 的四个独立业务身份；`.env.uat` 仅提供 UAT API 的通用 `MYSQL_*` 运行身份。

2. 启动单一 MySQL 容器、收敛四个最小权限账户并独立迁移 UAT：

```sh
sh scripts/uat-db-up.sh
```

该脚本仅启动默认 Compose 的 `mysql` 服务，执行容器内 `reconcile-mysql-users`，再以 `.env.uat` 的 UAT migrator 执行 migration。

3. 在两个终端分别启动 UAT API 与 H5：

```sh
sh scripts/start-uat-api.sh
```

```sh
corepack pnpm dev:h5
```

确认实际目标库：

```sh
curl http://127.0.0.1:32146/health
```

响应中的 `database` 必须为 `knowledge_base_uat`；若不是，停止 UAT 验收。

## 重置可重复的 UAT 基线

只允许在 `Knowledge_Base` 根目录执行：

```sh
sh scripts/reset-uat-db.sh
```

该脚本拒绝非 `127.0.0.1:3306 / knowledge_base_uat` 的 `.env.uat`，并在同一个 MySQL 容器中依序：

```text
DROP DATABASE knowledge_base_uat
→ CREATE DATABASE knowledge_base_uat
→ reconcile-mysql-users
→ 仅以 UAT migrator 迁移 knowledge_base_uat
```

它不会停止容器、删除 `mysql-data`、删除或迁移 `knowledge_base`，也不会操作任何旧独立 UAT 容器或数据目录。

## QA 执行规则

1. 先确认 `/health.database = knowledge_base_uat`。
2. 通过浏览器创建、导出、UAT reset、恢复与 API/MySQL 重启验证 UAT 数据闭环。
3. 仅可通过 `sh scripts/reset-uat-db.sh` 清空 UAT；禁止对 `knowledge_base` 执行清库或恢复。
4. 浏览器请求只允许同源 `/api/`，不得出现 MySQL 连接。
5. 新建无复盘事项时 `GET /api/v1/reviews/by-item/:id` 返回 404 的前端 Console 噪声是独立 P2，不属于 UAT 环境任务。
