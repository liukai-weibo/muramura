# Knowledge_Base

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

将下面这条个人运行闭环做成可视化、可长期使用、可完整导出和恢复的应用：

```text
想法 → 执行 → 复盘 → 当前有效的方法 → 新想法
```

## 当前技术路线

```text
Taro + React + TypeScript
├── 第一阶段：H5 / Web 本地优先应用 + Docker 部署
├── 第二阶段：方向层与计划体系
└── 后续阶段：微信小程序、CloudBase 与多设备
```

第一阶段使用 IndexedDB 保存本地数据，以完整 JSON 作为正式备份与恢复格式；Markdown + ZIP 保留为后续可读导出能力。

## 当前阶段

**Sprint 11 第一阶段收口中。**

当前已完成想法、执行、复盘、方法复用、全局搜索、状态流转历史、周期仪表盘下钻、回收站以及安全备份恢复闭环。当前工作聚焦工程标准核验、文档对齐和 `v0.1.0` 封板。

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

### Docker 构建与运行

```bash
docker build -t kkk-personal-system:local .
docker run --rm -d --name kkk-personal-system-test -p 8080:8080 kkk-personal-system:local
```

打开 `http://localhost:8080` 验证应用。停止测试容器：

```bash
docker stop kkk-personal-system-test
```

也可以使用 Compose：

```bash
docker compose up -d --build
docker compose down
```

## 文档入口

1. [`docs/product/功能清单-v2.md`](<docs/product/功能清单-v2.md>)：当前有效产品范围与第一阶段完成标准
2. [`docs/product/功能清单-v1.md`](<docs/product/功能清单-v1.md>)：早期产品设计，仅保留决策历史
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
