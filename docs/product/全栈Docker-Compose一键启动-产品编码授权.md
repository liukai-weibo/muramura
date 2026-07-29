# 全栈 Docker Compose 一键启动：产品编码授权

日期：2026-07-27
状态：已授权实施；未验收、未封板

## 目标

在一台新机器的干净目录中，用户配置本机 `.env` 后，可用单一 Docker Compose 命令启动完整的本地 H5、API 与 MySQL 运行环境；既有宿主机入口和本地优先边界保持不变。

## 允许修改范围

- `Dockerfile`
- `docker-compose.yml`
- `nginx.conf`
- `.dockerignore`
- 新增 `docker/app-entrypoint.sh`
- 必要运行文档、直接 Docker 测试、QA 记录与当天贡献记录

## 冻结实施规则

- 仅使用官方 `mysql:8.4` 与本机 Docker 命名 volume；不得构建或提交自定义 MySQL 数据镜像、`mysql-data`、备份、导出或个人数据。
- Compose 包含：`mysql`、复用应用镜像的一次性 `migrate`、以及同一镜像内运行 Node API、H5 静态站点和 Nginx 的 `app`。
- `migrate` 仅连接日常 `knowledge_base` 并复用既有 migration；不得修改、回滚或新增 migration。
- Nginx 只在 app 容器内将 `/api`、`/health` 转发到同容器 Node API `127.0.0.1:32146`；不得引入远程或公网代理。
- 宿主机仅绑定 `127.0.0.1:10086`、`127.0.0.1:32146`、`127.0.0.1:3306`；保持既有 H5 和 API 入口语义。
- `.env` 只由用户在本机提供，严禁写入镜像层、日志或 Git。不得自动恢复 Backup；用户只能在服务就绪后经既有 API 显式恢复 Backup V3。
- 端口被 UAT 或未知进程占用时，Compose 必须失败，且不得停止、替换、切换或干扰对方进程。
- 停止仅允许 `docker compose stop`；禁止 `docker compose down -v`、删除 volume 或清库。

## 明确不授权

- 不修改 `apps/api`、`apps/client`、`packages`、Contracts、Application、Repository、业务路由或 DTO。
- 不修改数据库结构、Migration、Backup V3 格式、业务对象、字段、状态、关系、unknown-outcome 或 503 语义。
- 不新增远程访问、公网监听、域名、隧道、云同步、账户、权限、监控、镜像仓库或个人数据自动迁移。

## 验收门

1. 干净目录与空命名 volume 能完成构建、migration 和启动；health 返回 `ready / knowledge_base / schemaVersion=4`。
2. H5、API、health 三个既有入口可用，且宿主机只监听冻结的 loopback 地址。
3. UAT 或未知端口占用时启动失败且不干扰原进程。
4. Backup V3 必须由用户显式恢复；恢复前后业务语义、unknown-outcome 与 503 保护无回归。
5. `docker compose stop` 后 MySQL 命名 volume 仍保留；镜像、Git 与日志不包含密钥或个人数据。
6. QA 完成干净目录演练、直接 Docker 验证与必要回归后，才可申请产品验收和 Git 归档。
