# MaruMaru｜圈圈

## MySQL 本地主库开发

H5 当前通过开发代理调用 loopback API，并以 MySQL 作为唯一运行主库；浏览器不直接连接 MySQL。

```sh
cp .env.example .env
corepack pnpm db:up
# 既有 mysql-data：启动后必须由 root 路径重复收敛账号权限。
docker compose exec mysql /usr/local/bin/reconcile-mysql-users
set -a && . ./.env && set +a && corepack pnpm db:migrate
set -a && . ./.env && set +a && corepack pnpm api
corepack pnpm dev:h5
```

- MySQL：`127.0.0.1:3306`（仅本机回环；候选环境）
- API：`127.0.0.1:32146`（仅本机回环）
- H5 QA 验收入口：`http://127.0.0.1:10086`；开发服务器仅监听本机回环，并将 `/api` 代理到 loopback API。
- 新建 `mysql-data` 时，镜像初始化阶段会通过 root 路径创建 app 与 migrator；不使用 `MYSQL_USER` / `MYSQL_PASSWORD`，避免官方镜像授予 app `ALL PRIVILEGES`。
- 已有 `mysql-data` 不会重新执行初始化脚本。每次需要校正运行容器账号时执行：
  `docker compose exec mysql /usr/local/bin/reconcile-mysql-users`。该命令可重复执行，会收敛 app 为业务库 DML-only、收敛 migrator 为冻结 DDL 权限，并删除历史 `mysql_m1_forbidden_create` 测试表。
- 收敛脚本会输出 app 与 migrator 的 `SHOW GRANTS`。app 必须没有 `CREATE`、`ALTER`、`DROP`、`INDEX`、`REFERENCES` 或 `mysql` 系统库读取权限。
- 当前 H5 业务读写通过 `/api` 代理使用 MySQL 主库；浏览器不直接连接 MySQL。


## 项目目标

MaruMaru（圈圈）将下面这条个人运行闭环做成可视化、可长期使用、可完整导出和恢复的应用：

```text
想法 → 执行 → 复盘 → 当前有效的方法 → 新想法
```

## 当前技术路线

```text
Taro + React + TypeScript
├── H5 开发代理 → loopback Node API → Application → MySQL
├── Docker：单容器双库（knowledge_base / knowledge_base_uat）
└── Backup V3：完整 JSON 导出与安全恢复
```

MySQL 是当前 H5 唯一运行主库；浏览器不直接连接数据库。IndexedDB 仅保留为历史本地资产，SQLite 仅用于实验和测试，不参与当前运行读写。

## 当前阶段

**探索主线 V1 已封板；V1.1 已完成阶段性 Git 快照。**

当前已完成想法、执行、复盘、方法复用、全局搜索、状态流转历史、回收站及安全备份恢复闭环。运行路径、数据源和禁止事项以 `docs/product/当前运行事实.md` 为准。

## 开发与验证

### 环境要求

- Node.js 22
- Corepack
- Docker（仅镜像构建与容器运行需要）

### 安装依赖

```bash
corepack pnpm install
```

### 本地开发

```bash
corepack pnpm dev:h5
```

开发服务默认监听 `http://localhost:10086`。

### 类型检查与测试

```bash
corepack pnpm typecheck
corepack pnpm test
```

### H5 正式构建

```bash
corepack pnpm build:h5
```

构建产物位于 `apps/client/dist`。

### Docker Compose 本机启动

```bash
cp .env.example .env
# 编辑 .env，替换全部本机密码占位值后执行
docker login --username=<阿里云用户名> crpi-v8ex1zrhoe87bb3d.cn-hangzhou.personal.cr.aliyuncs.com
docker compose up -d --pull always
```

Compose 使用官方 `mysql:8.4`、本机未提交命名 volume `knowledge_base_mysql_data`，并以同一应用镜像运行一次性数据库账号初始化、migration 与 app 服务；新机器不需要本地 `docker/mysql/` 目录。app 内部的 Nginx 将 `/api` 和 `/health` 转发给同容器 loopback API；宿主机入口保持：

- H5：`http://127.0.0.1:10086`
- API / health：`http://127.0.0.1:32146`
- MySQL：`127.0.0.1:3306`

启动成功后，确认：

```bash
curl http://127.0.0.1:32146/health
```

它应返回 `ready / knowledge_base / schemaVersion=4`。当前交付包默认拉取不可变复测候选 `crpi-v8ex1zrhoe87bb3d.cn-hangzhou.personal.cr.aliyuncs.com/my-acr-demo/dnf:1.0.1-qa.1`；本机 `.env` 的 `KB_APP_IMAGE_TAG` 可显式选择其他已验收的固定版本。失败的 `latest` 和 `1.0.0` 不得使用。首次空 volume 会自动复用既有 migration；个人数据不会随镜像或 volume 迁移，如需迁移，请在服务就绪后通过既有 H5/API 显式恢复 Backup V3。

停止服务使用：

```bash
docker compose stop
```

禁止使用 `docker compose down -v`，它会删除本机命名 volume。`.env`、备份、导出、`mysql-data` 和个人数据均不得提交 Git 或进入镜像构建上下文。

### Compose 局域网 H5 发布

仅已启动并验证过的 Compose `app` 服务可以发布 H5 到同一私有局域网。脚本会自动选择唯一的本机 Private 私网 IPv4：

```powershell
powershell.exe -NoProfile -File scripts/kb-lan.ps1
```

在管理员 PowerShell 中执行。若有多个私网 IP，才需显式使用 `-LanBindIp 192.168.x.x` 选择其一。脚本只接受本机网卡上的 RFC1918 私网地址，允许 Windows 网络类别为 Private 或 Public，拒绝 `0.0.0.0`、回环和非私网地址，并仅为该 IP 的 TCP `10086` 新建防火墙入站规则。本机仍可通过 `http://127.0.0.1:10086` 访问；局域网设备同时通过 `http://<LAN_BIND_IP>:10086` 访问。API `32146` 和 MySQL `3306` 始终保持 `127.0.0.1`，不会对局域网开放。两个 H5 入口的 `/api` 与 `/health` 都由 app 内部同源代理处理。若检测到本工作区已有旧 Compose MySQL 容器，脚本只复用其 Compose 项目和网络并以 `--no-deps` 启动 app，不会启动、重建或修改 MySQL。

恢复仅本机访问：

```powershell
powershell.exe -NoProfile -File scripts/kb-lan.ps1 -Disable
```

## 文档入口

1. [`docs/product/功能清单-v4.md`](<docs/product/功能清单-v4.md>)：当前有效产品范围与已验收行为
2. [`功能清单历史版本`](<docs/archive/product/feature-list-history/>)：早期产品设计与版本演进，仅供追溯
3. [`docs/architecture/整体架构设计-v2.md`](<docs/architecture/整体架构设计-v2.md>)：当前有效技术架构
4. [`docs/development/开发流程-v1.md`](<docs/development/开发流程-v1.md>)：整体开发顺序
5. [`docs/development/Git与镜像约定.md`](<docs/development/Git与镜像约定.md>)：Git、隐私和 Docker 约定
6. [`docs/archive/整体架构设计-v1-已废弃.md`](<docs/archive/整体架构设计-v1-已废弃.md>)：早期 Next.js + SQLite 草案，仅保留决策历史

## MVP 完整演示

```text
新建想法
→ 开始、暂停或恢复执行
→ 执行结束并完成复盘
→ 产生新想法，或主动形成 / 验证 / 修订方法
→ 用方法发起新行动
→ 搜索、周期观察并下钻定位
→ 查看单事项完整时间线
→ 导出完整 JSON
→ 自动保存恢复前备份并完整恢复
```

## 仓库边界

该仓库只保存：

- 项目代码
- 项目设计与开发文档
- 测试代码
- Docker 和构建配置

该仓库不保存：

- `KKK个人知识库`
- `kkk自我价值`
- `mikey猎人特性（2.0）`
- `朱宇思维`
- 运行数据、个人导出文件和密钥
