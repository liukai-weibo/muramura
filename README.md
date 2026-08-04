# MaruMaru｜圈圈

MaruMaru（圈圈）将下面这条个人运行闭环落在一个本地优先的系统中，帮助用户把想法推进为行动，通过复盘形成、验证和修订方法，再用方法发起新的行动。

```text
想法
→ 执行
→ 复盘
→ 形成 / 验证 / 修订方法
→ 用方法发起新行动
→ 新证据继续优化方法
```

系统强调数据可恢复、业务关系可追溯，以及不同账户之间的数据隔离。

## 当前能力

- 快速捕获想法，并进入“想试试”或“以后再说”。
- 支持开始、暂停、恢复、完成、放弃和复盘。
- 支持形成、验证、修订及复用方法，并保留版本和证据关系。
- 提供全局搜索、周期 Dashboard、状态历史和统一回收站。
- 支持 Backup V1 / V2 / V3 的预览、完整 JSON 导出和安全恢复。
- 支持注册、登录、退出、Cookie 会话和会话过期。
- 全部业务数据按当前会话用户隔离，跨用户资源统一不可见。
- 支持平台管理员查看脱敏用户列表、授予或撤销他人的管理员角色、撤销他人的全部会话。
- 平台管理员不能绕过业务 owner scope，也不能查看密码、密码哈希、Cookie、Token 或会话秘密。

## 当前状态

- 在线账户与单用户数据隔离 V0 已完成产品验收、Git 归档并封板。
- 平台角色与最小权限管理 V1 已完成产品验收、真实运行接入、Git 归档并封板。
- 当前 MySQL Schema 为版本 6，共 17 张 base table。
- 所有用户固定拥有 `member`；`platform_admin` 是可选附加角色。
- 系统不会创建默认管理员，也没有默认管理员密码。

运行路径、数据库、阶段和禁止事项以 [`docs/product/当前运行事实.md`](<docs/product/当前运行事实.md>) 为唯一高优先级状态锚点。

## 技术架构

```text
Taro + React + TypeScript H5
→ /api 同源代理
→ loopback Node API
→ Application
→ Repository
→ MySQL
```

- 前端：Taro + React H5。
- API：当前实际启动入口为 `apps/api/src/main.ts`，运行原生 Node HTTP 实现。
- Application / Repository 分层：页面不直接访问数据库。
- 数据库：MySQL 8.4，Migration 001–006。
- 部署：Docker Compose，MySQL 与应用使用独立容器，应用容器同时运行 loopback API 与 Nginx H5。
- `apps/api/src/hono` 是尚未接入主启动入口的并行路由骨架，不能视为当前实际运行 API。

## 环境要求

- Node.js 22
- Corepack
- pnpm 10.28.2（由 Corepack 管理）
- Docker 与 Docker Compose v2
- MySQL 8.4

## 安装依赖与首次配置

当前源码开发入口以 WSL/Linux 为准。首次在一台机器上准备项目：

```bash
corepack enable
pnpm install
pnpm setup
```

`corepack enable` 只需在机器上执行一次，之后直接使用 `pnpm`。第一次执行 `pnpm setup` 时，如果 `.env` 不存在，脚本只会从 `.env.example` 创建它并退出，不会启动服务、迁移数据库或覆盖已有配置。

打开新生成的 `.env`，至少确认并修改所有密码占位值，尤其是：

```text
MYSQL_ROOT_PASSWORD
MYSQL_APP_PASSWORD
MYSQL_MIGRATOR_PASSWORD
UAT_MYSQL_APP_PASSWORD
UAT_MYSQL_MIGRATOR_PASSWORD
```

不同身份应使用不同的强密码，不要保留 `replace-*`、`change-me` 等示例值，也不要把密码写入命令、README 或日志。`.env` 和 `.env.uat` 必须保持私有，禁止提交 Git、复制到镜像或与他人共享。填写完成后再次执行：

```bash
pnpm setup
```

第二次执行只校验日常配置必须指向 `127.0.0.1 / knowledge_base / 127.0.0.1:32146`，并确认既有 MySQL 可达；它不会自动创建、迁移、清空或重建数据库。日常与 UAT 的内部数据库标识继续固定为 `knowledge_base / knowledge_base_uat`。数据库创建与 Migration 继续使用既有受控流程，执行前必须根据 [`docs/product/当前运行事实.md`](<docs/product/当前运行事实.md>) 和 `/health` 确认实际数据库与 Schema，不能根据 Compose 名称或端口猜测目标。

## 日常源码启动

保持日常 MySQL 运行后，只需一个终端：

```bash
pnpm dev
```

`pnpm dev` 会固定读取 `.env` 和 `knowledge_base`，确认 MySQL 可达及 `32146`、`10086` 未被占用，前台启动 API，等待 `/health` 确认为 `ready / knowledge_base / 有效 Schema` 后再启动 H5。API/H5 日志直接显示在当前终端；按 `Ctrl+C` 只停止本次创建的 API 和 H5，不停止 MySQL，也不会接管 UAT 或未知进程。

默认入口：

- H5：`http://127.0.0.1:10086`
- API：`http://127.0.0.1:32146`
- API 文档：`http://127.0.0.1:32146/docs`
- MySQL：`127.0.0.1:3306`

H5 通过 `/api` 和 `/health` 同源代理访问 loopback API，浏览器不直接连接 MySQL。原生 Windows 前台编排暂未支持，请在 WSL/Linux 中运行；旧 `kb-init/start/stop.ps1` 已移入 `archive/scripts/windows-local-launcher/`，只作为历史实现保留，不再是活动启动入口。

常见拒绝原因：

- `ENV_MISSING` / `ENV_INVALID`：先执行 `pnpm setup` 并检查 `.env`，不要保留示例密码。
- `PORT_UNAVAILABLE`：已有 API、H5、UAT 或未知进程占用端口；启动器不会替换它。
- `MYSQL_UNAVAILABLE`：先根据当前运行事实确认并启动正确的日常 MySQL。
- `MYSQL_SCHEMA_NOT_READY`：停止启动，确认真实目标库后再走受控 Migration，不能手工修改 `schema_migrations`。

需要单独调试服务时，WSL/Linux Shell 可先加载 `.env` 后运行 `pnpm dev:api`，并在另一个终端运行 `pnpm dev:h5`。详细边界见 [`docs/development/本机迁移与一键启动.md`](<docs/development/本机迁移与一键启动.md>)。

## Docker Compose 启动与更新

首次使用时复制私有配置模板，并替换所有密码占位值：

```bash
cp .env.example .env
```

`.env` 必须保持私有，不得提交 Git、进入镜像或写入日志。

登录既有阿里云镜像仓库：

```bash
docker login crpi-v8ex1zrhoe87bb3d.cn-hangzhou.personal.cr.aliyuncs.com
```

当前测试服务器更新策略固定使用 `latest`。在 `.env` 中设置：

```text
KB_APP_IMAGE_TAG=latest
```

随后执行：

```bash
docker compose config --quiet
docker compose pull
docker compose up -d
docker compose ps
```

每次 `docker compose pull` 都会向镜像仓库查询远端 `latest`：digest 未变化时复用本地镜像，digest 变化时只下载变更镜像层。拉取失败时不应继续使用旧镜像完成更新。

Compose 启动顺序为：

```text
MySQL 健康
→ reconcile-users 收敛四个数据库账号及 grants
→ 执行既有 Migration
→ 启动 API 与 H5
```

因此 Compose 更新不是单纯重启应用。已有数据库或数据卷必须先完成备份，并确认 `.env` 中的数据库账号与密码配置正确。

启动后检查：

```bash
curl http://127.0.0.1:32146/health
```

正常结果应表示：

```text
ready / knowledge_base / schemaVersion=6
```

停止服务使用：

```bash
docker compose stop
```

不要执行 `docker compose down -v`；它会删除命名数据卷 `knowledge_base_mysql_data`。

## 首位平台管理员

系统不会自动把第一个注册用户设为管理员。首次部署流程是：

```text
完成 Migration 001–006
→ 用户通过 H5 正常注册
→ 该用户获得 member
→ 使用显式 userId 受控授予首位 platform_admin
```

先查询目标用户 ID：

```bash
docker compose exec mysql mysql -uroot -p knowledge_base \
  -e "SELECT id, username, created_at FROM users ORDER BY created_at DESC;"
```

再执行一次初始管理员 CLI：

```bash
KB_APP_IMAGE_TAG=latest docker compose run --rm --no-deps --entrypoint node migrate \
  apps/api/node_modules/tsx/dist/cli.mjs \
  apps/api/src/grant-initial-platform-admin.ts \
  --user-id=替换为目标用户ID \
  --expected-database=knowledge_base \
  --apply
```

看到 `granted` 后重新登录。该 CLI 仅用于初始化首位管理员；已有其他管理员时会拒绝继续扩张管理员。

## 会话与权限边界

- 注册或登录产生独立 Cookie 会话，固定有效期为 7 天，不自动滑动续期。
- 用户退出只撤销当前会话，并让浏览器 Cookie 过期。
- 管理员撤销其他用户全部会话后，目标用户的所有设备在下一次请求时返回 401。
- 撤销 `platform_admin` 不会强制退出用户；下一次请求读取最新角色后，该用户继续以 `member` 使用自己的数据。
- 管理员不能通过管理接口修改自己，也不能绕过十个业务集合和 Backup 的用户数据范围。

## 验证命令

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm --filter @knowledge-base/client build:h5
git diff --check
```

H5 构建产物位于 `apps/client/dist`。

## 数据安全

- 运行数据、MySQL volume、`.env`、`.env.uat`、备份、导出文件和秘密不得进入 Git。
- 用户密码仅保存安全哈希；密码和密码哈希不会出现在会话或 HTTP 响应中。
- 会话 Cookie 使用 `HttpOnly`、`SameSite=Lax` 和固定 Path；数据库只保存会话秘密哈希。
- Backup 只包含当前用户的十个业务集合，不包含用户、角色、会话、审计、Migration 或系统元数据。
- 跨用户资源读取、写入、关联、删除和恢复统一按不可见处理。

## 文档入口

1. [`docs/product/当前运行事实.md`](<docs/product/当前运行事实.md>)：当前运行路径、数据源、阶段和禁止事项。
2. [`docs/product/功能清单-v4.md`](<docs/product/功能清单-v4.md>)：当前有效产品范围与已验收行为。
3. [`docs/architecture/整体架构设计-v2.md`](<docs/architecture/整体架构设计-v2.md>)：整体技术架构。
4. [`docs/development/开发流程-v1.md`](<docs/development/开发流程-v1.md>)：开发与协作流程。
5. [`docs/development/Git与镜像约定.md`](<docs/development/Git与镜像约定.md>)：Git、隐私和 Docker 约定。
6. [`notes/code-map.md`](<notes/code-map.md>)：代码职责和当前活跃入口的理解型地图；与运行事实冲突时以当前运行事实为准。

## 当前非目标

以下能力尚未纳入当前封板范围：

- 邮箱验证、找回密码、修改密码和邀请码。
- 团队共享、自定义角色、动态权限和协作编辑。
- 多端同步、云端同步、Tauri 和安卓客户端。
- HTTPS、域名、反向代理、Kubernetes 和正式公网生产部署。

## 仓库边界

仓库只保存项目代码、测试、公开配置模板和产品 / 设计 / 架构 / QA 文档；不保存个人运行数据、私有密码、Cookie、Token、备份或导出文件。
