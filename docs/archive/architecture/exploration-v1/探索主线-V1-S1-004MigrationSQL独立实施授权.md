# 探索主线 V1 S1：004 Migration SQL 独立实施授权

> 日期：2026-07-24
>
> 结论：**P2 MySQL 集成测试调度稳定性前置已满足；授权新增并验证正式 `004_add_exploration_tracks.sql`。本授权仅覆盖 Schema 004 及 migration 事实测试，不授权基础 Contracts 或 S2 / S3。**
>
> 依据：`docs/product/当前运行事实.md`、`docs/architecture/探索主线-V1-S1-004Migration预检复审与测试稳定化裁决.md`、`package.json`、`migrations/` 当前目录状态。

## 【前置复审】

P2 前置关闭，依据如下：

```text
无 .env 常规全量测试：37 files passed / 12 skipped，171 passed / 109 skipped。
.env 下 test:mysql:integration：12 files / 109 tests 全部通过。
该入口固定 vitest run --no-file-parallelism，覆盖 M1–M5、api-m5b、003 预检与 S1 004 预检。
003 核心预检场景 3120ms 通过；004 六个冲突场景均通过，无超时。
typecheck、git diff --check 通过。
正式 migrations/ 目录仍仅有 001 / 002 / 003；未触及 knowledge_base 或 knowledge_base_uat。
```

这证明测试稳定化采用了显式串行 MySQL integration suite，而非提高 timeout、减少场景或隐藏失败。允许进入 004 SQL 的独立实施门。

## 【本次授权范围】

仅允许修改：

```text
migrations/004_add_exploration_tracks.sql
tests/mysql-s1-exploration-tracks.integration.test.ts
package.json（仅当为了在既有 test:mysql:integration 中纳入 004 成功路径测试而绝对必要；当前入口已包含该文件，通常不应修改）
docs/daily-contributions/YYYY-MM-DD.md（实际完成工程验证后追加）
```

不得修改：

```text
packages/contracts/**
packages/domain/**
packages/application/**
packages/storage-mysql/src/**
apps/api/**
apps/client/**
BackupData、BackupDocumentV3 或 restore 行为
既有 001 / 002 / 003 migration
MySQL Compose、容器、端口、用户、权限或运行组合
```

`packages/storage-mysql/src/index.ts` 的既有 004 专属预检不得在本轮删除、弱化或重构。

## 【004 DDL 冻结内容】

新增且只能新增文件：

```text
migrations/004_add_exploration_tracks.sql
```

DDL 内容固定为：

```sql
CREATE TABLE exploration_tracks (
  id VARCHAR(128) NOT NULL,
  name VARCHAR(80) NOT NULL,
  normalized_name VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY exploration_tracks_normalized_name_unique (normalized_name),
  KEY exploration_tracks_active_updated_idx (deleted_at, updated_at DESC)
) ENGINE=InnoDB;

ALTER TABLE items
  ADD COLUMN exploration_track_id VARCHAR(128) NULL,
  ADD KEY items_exploration_track_created_idx (exploration_track_id, created_at DESC),
  ADD CONSTRAINT items_exploration_track_fk
    FOREIGN KEY (exploration_track_id) REFERENCES exploration_tracks(id);
```

固定语义：

```text
items.exploration_track_id 为 NULL 表示无关联。
一条 Item 最多关联一条主线，由单列和外键表达；不创建中间表。
外键允许 Item 引用 soft-deleted Track；软删除不解除或改写关系。
全生命周期名称唯一由 normalized_name 唯一索引承载；删除不释放名称。
不增加 cascade、trigger、default、数据回填或历史迁移。
```

不得用 `IF NOT EXISTS` 规避预检。004 的 DDL 前对象集合完整性只可由已封板的 runner 预检证明；任何冲突都必须在 DDL 前失败。

## 【执行与环境边界】

本轮首先只允许在随机临时真实 MySQL database 中使用临时 migration 目录验证。不得执行正式日常或 UAT migration：

```text
禁止执行 .env → knowledge_base 的 db:migrate
禁止执行 .env.uat → knowledge_base_uat 的 db:migrate
禁止对两库清库、恢复、破坏性写入或运行 H5 / API 业务验证
```

在 S1 Schema 004 通过 QA、架构稳定审阅和下一次明确的环境部署授权前，`knowledge_base` 与 `knowledge_base_uat` 的 schema version 必须继续保持 3。

migrator 仅在临时库可执行 DDL；app 用户必须继续无法执行 DDL。不得调整用户权限来迁就测试。

## 【必须新增 / 保持的自动化验证】

`tests/mysql-s1-exploration-tracks.integration.test.ts` 必须在保留现有六个 DDL 前冲突拒绝场景基础上，增加正式 004 成功路径：

```text
随机临时 database + 独立 app / migrator 用户 + 临时 migration 目录
→ 001 / 002 / 003 / 正式 004
→ migrator 执行 runMySqlMigrations()
→ 断言 schema_migrations 为 001 / 002 / 003 / 004
→ 断言表、列、三个索引与指定外键存在且定义正确
→ 再次执行 runner：不重复 DDL，004 文件名 / checksum 完全一致时幂等成功
→ 修改临时目录中的 004 内容：既有 checksum 漂移拒绝
→ app 用户尝试 DDL：ER_TABLEACCESS_DENIED_ERROR
→ finally 清除临时 database、用户与目录
```

同时保留：

```text
表、列、每个索引、外键各自预置时：004 在 DDL 前失败。
schema_migrations 仅保留 001 / 002 / 003。
不存在 version 004 记录，且不出现额外 004 目标对象。
```

测试不得创建、迁移、清理或读取日常 / UAT 实库。

## 【验收门与后续流转】

研发完成后，必须提供：

```text
1. 定向真实 MySQL：tests/mysql-s1-exploration-tracks.integration.test.ts 全部通过；
2. .env 下 corepack pnpm test:mysql:integration：12 files / 全部测试通过；
3. 无 .env 常规全量 test、typecheck、git diff --check 通过；
4. 证明 migrations/ 仅新增正式 004，001–003 未改变；
5. 证明日常 / UAT 未触及且 schemaVersion 仍为 3；
6. 当天 daily contribution 仅记录实际增加项 / 未完成项。
```

QA 定向验证与架构复审均通过后，才可签发下一份独立授权，讨论：

```text
基础 Contracts
日常与 UAT 的受控 004 部署顺序
S1 Schema 004 的正式环境验收
```

在此之前，继续禁止基础 Contracts、Repository、Application、API、H5、Backup V3、S2 和 S3。
