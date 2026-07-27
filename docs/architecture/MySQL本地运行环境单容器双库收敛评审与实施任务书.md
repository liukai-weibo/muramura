# MySQL 本地运行环境单容器双库收敛评审与实施任务书

> 状态：**已批准一次性实施。**
>
> 本任务仅收敛本地 MySQL Docker 拓扑，不修改业务 Contracts、Application、Repository、Schema 业务结构或 BackupData 语义。当前 H5 写入故障必须独立排查，不得混入本次变更。

## 结论

采用一个本地 MySQL 8.4 Docker 容器、一个持久数据目录、两个独立数据库：

```text
127.0.0.1:3306
├─ knowledge_base      日常 H5 / API
└─ knowledge_base_uat  隔离 UAT / 破坏性测试
```

API 每次进程启动只通过一组通用 `MYSQL_*` 变量读取一个 database；日常环境固定目标为 `knowledge_base`，UAT 进程通过独立 `.env.uat` 切换为 `knowledge_base_uat`。API 不得从一个进程连接、读取、写入或比较两个业务库。

## 一、修改范围

### Compose

修改 `docker-compose.yml`：

- 保持单一 `mysql` 服务、`127.0.0.1:3306:3306`、`./mysql-data:/var/lib/mysql`；
- 固定日常 `MYSQL_DATABASE=knowledge_base`，新增初始化专用 `MYSQL_UAT_DATABASE=knowledge_base_uat`；
- 日常与 UAT 各使用独立 app / migrator 身份和密码环境变量；
- 不开放 3307，不添加第二服务、第二 volume 或远程端口；
- 不改变 app DML-only、migrator 目标库 DDL / DML 最小权限集合。

删除 `docker-compose.uat.yml`。不得把 UAT 变为第二 Compose project 或第二容器。

### 初始化与权限收敛

修改 `docker/mysql/scripts/reconcile-users.sh`，使其幂等完成：

```text
CREATE DATABASE IF NOT EXISTS knowledge_base
CREATE DATABASE IF NOT EXISTS knowledge_base_uat

日常 app      → 仅 knowledge_base.* 的 SELECT, INSERT, UPDATE, DELETE
日常 migrator → 仅 knowledge_base.* 的 SELECT, INSERT, UPDATE, DELETE,
                CREATE, ALTER, DROP, INDEX, REFERENCES

UAT app       → 仅 knowledge_base_uat.* 的 SELECT, INSERT, UPDATE, DELETE
UAT migrator  → 仅 knowledge_base_uat.* 的 SELECT, INSERT, UPDATE, DELETE,
                CREATE, ALTER, DROP, INDEX, REFERENCES
```

约束：

- 四个业务身份均不得是 root；app 与对应 migrator 不得复用；
- 先 `REVOKE ALL PRIVILEGES, GRANT OPTION`，再按目标库重新授予；
- 禁止 `ALL PRIVILEGES`、`*.*`、跨库 grant；
- 对已有 `mysql-data`，必须提供受控脚本执行容器内 `reconcile-mysql-users`，因为 entrypoint init 仅在全新数据目录运行；
- 不得从 API、浏览器或测试运行时执行 DDL / grant。

### 环境示例与启动配置

更新 `.env.example`，作为容器初始化和日常 API 示例，固定：

```text
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=knowledge_base
MYSQL_APP_USER=<daily-app-user>
MYSQL_APP_PASSWORD=<daily-app-password>
MYSQL_MIGRATOR_USER=<daily-migrator-user>
MYSQL_MIGRATOR_PASSWORD=<daily-migrator-password>
MYSQL_ROOT_PASSWORD=<root-password>
MYSQL_UAT_DATABASE=knowledge_base_uat
MYSQL_UAT_APP_USER=<uat-app-user>
MYSQL_UAT_APP_PASSWORD=<uat-app-password>
MYSQL_UAT_MIGRATOR_USER=<uat-migrator-user>
MYSQL_UAT_MIGRATOR_PASSWORD=<uat-migrator-password>
```

更新 `.env.uat.example`，仅作为 UAT API / migration / 测试运行时配置，固定：

```text
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=knowledge_base_uat
MYSQL_APP_USER=<uat-app-user>
MYSQL_APP_PASSWORD=<uat-app-password>
MYSQL_MIGRATOR_USER=<uat-migrator-user>
MYSQL_MIGRATOR_PASSWORD=<uat-migrator-password>
MYSQL_ROOT_PASSWORD=<root-password>
```

`.env.uat` 不得被日常 API 自动加载；日常 API 只加载 `.env` 的 `knowledge_base` 配置。UAT API / 测试只在显式 source / env-file `.env.uat` 后启动。

## 二、UAT 创建、迁移与清理

新增或改造以下脚本：

- `scripts/uat-db-up.sh`：只启动默认 Compose 的 `mysql`，等待健康；拒绝 host / port / database 不是 `127.0.0.1:3306 / knowledge_base_uat` 的 `.env.uat`；执行容器内权限收敛；以 `.env.uat` 运行现有 migration。
- `scripts/reset-uat-db.sh`：只允许固定 UAT 配置；在同一容器中以 root：

```text
DROP DATABASE IF EXISTS `knowledge_base_uat`
CREATE DATABASE `knowledge_base_uat`
→ 容器内重新执行 reconcile-mysql-users
→ 以 .env.uat 的 UAT migrator 执行现有 migration
```

禁止：

```text
停止 / 删除日常 mysql 服务
删除 ./mysql-data
DROP knowledge_base
操作 3307
操作 mysql-uat-data
改变 knowledge_base 的 schema_migrations 或业务数据
```

迁移必须对两个 database 分别独立执行，且每次 migration runner 的 `MYSQL_DATABASE` 仅为一个目标库。不得用单个连接跨库运行 migration。

## 三、删除第二容器和 3307 依赖顺序

1. 停止 UAT API、H5 / Playwright 等访问 3307 的进程；不停止日常 API。
2. 如需保留旧 UAT 数据，先由 UAT API 导出现有 JSON 备份；旧 `mysql-uat-data` 不迁入日常容器。
3. 更新默认 Compose、权限收敛脚本、环境示例和 UAT 脚本，使单容器先具备双库创建与权限收敛能力。
4. 启动 / 保持默认 `docker compose up -d mysql`，执行受控 reconcile；分别执行日常与 UAT migration。
5. 使用 `.env` 验证日常 API 只连 `knowledge_base`；使用 `.env.uat` 验证 UAT API / 测试只连 `knowledge_base_uat`；完成 UAT 清库隔离验证。
6. 验证成功后，执行旧独立项目：

```text
docker compose -p knowledge_base_uat --env-file .env.uat -f docker-compose.uat.yml down --remove-orphans
```

7. 删除 `docker-compose.uat.yml`、`mysql-uat-data/` 以及所有脚本 / 文档 / npm script 中的 3307 与 `mysql-uat` 容器依赖。
8. 最后更新 `docs/product/当前运行事实.md`：单容器 3306、两个 database、日常 / UAT 环境变量和 UAT 隔离清库事实。不得改写历史阶段文档的历史事实。

## 四、运行环境变量

### 日常 H5 / API

```text
source .env
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=knowledge_base
MYSQL_APP_USER=<daily app>
MYSQL_MIGRATOR_USER=<daily migrator>
```

H5 / API 固定使用该配置；不得加载 `.env.uat`。

### UAT / 破坏性测试

```text
source .env.uat
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_DATABASE=knowledge_base_uat
MYSQL_APP_USER=<uat app>
MYSQL_MIGRATOR_USER=<uat migrator>
```

UAT API 与破坏性测试进程显式使用该环境。每次 API 启动只有上述一组 `MYSQL_*`，只能连接一个业务 database。

## 五、最小验证

```sh
# 单容器、单端口
docker compose ps

# 分别迁移日常库和 UAT 库
set -a && . ./.env && set +a
corepack pnpm --filter @knowledge-base/api migrate

set -a && . ./.env.uat && set +a
corepack pnpm --filter @knowledge-base/api migrate

# 日常 API 目标库
set -a && . ./.env && set +a
corepack pnpm --filter @knowledge-base/api start

# UAT 隔离清库：仅允许清理 knowledge_base_uat
sh scripts/reset-uat-db.sh

# UAT 定向 API / 浏览器测试在显式 .env.uat 下运行
# 日常库数据与 schema_migrations 在 UAT reset 前后保持快照等价

corepack pnpm typecheck
corepack pnpm test
corepack pnpm build:h5
git diff --check
```

后端实现须补充自动化或脚本级证据：

- app / migrator 对各自目标库拥有且仅拥有冻结权限；
- UAT reset 后 `knowledge_base` 的业务数据与 migration 记录不变；
- 两库可各自独立 migrate 且 migration checksum / advisory lock 语义保持；
- 日常与 UAT 配置均只构造单一 database connection config；
- 3307、`mysql-uat`、第二 MySQL 容器和 `mysql-uat-data` 不再被运行脚本引用。

## 六、允许修改范围

```text
docker-compose.yml
docker-compose.uat.yml（仅删除）
docker/mysql/init/**
docker/mysql/scripts/reconcile-users.sh
.env.example
.env.uat.example
scripts/uat-db-up.sh
scripts/reset-uat-db.sh
scripts/start-uat-api.sh
package.json（仅删除 / 更新 UAT 启动脚本引用）
docs/product/当前运行事实.md（在拓扑生效后的最终事实更新）
docs/development/MySQL快速接入Sprint-UAT环境.md
tests/**（仅本地环境收敛、权限、迁移和 UAT 隔离验证）
docs/daily-contributions/YYYY-MM-DD.md（工程验证后按规则追加实际修改）
```

持续禁止修改：

```text
apps/client/**（包括当前 H5 写入故障修复）
apps/api/**
packages/application/**
packages/contracts/**
packages/storage-mysql/**
packages/storage-indexeddb/**
packages/storage-sqlite/**
migrations/**
BackupData parser / format / v1/v2 语义
```

## 交付与流转

后端工程师一次性实施本任务书。完成后流转 QA，报告：

```text
单容器双库拓扑
两库独立 migration 与最小权限
UAT reset 对日常库零污染
日常 / UAT 单目标 API 配置
3307 与第二容器依赖已移除
验证结果与未修改边界
```
