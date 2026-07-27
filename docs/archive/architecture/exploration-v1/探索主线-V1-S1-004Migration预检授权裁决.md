# 探索主线 V1 S1：004 Migration 预检授权裁决

> 日期：2026-07-24
>
> 结论：**授权方案 A。仅授权补齐 004 专属 DDL 前预检及其真实 MySQL 集成测试；未授权 004 SQL、基础 Contracts 或任何 S2 / S3 能力实现。**
>
> 依据：`docs/product/当前运行事实.md`、`docs/architecture/探索主线-V1-数据ApplicationRepository实施任务书-封板后生效.md`、`packages/storage-mysql/src/index.ts`。

## 【裁决】

确认存在硬门禁缺口：现有 `runMySqlMigrations()` 仅在 version 003 执行专属预检。仅增加 `004_add_exploration_tracks.sql` 不能证明 `exploration_tracks`、`items.exploration_track_id`、冻结索引和外键在 DDL 前作为一个集合均不存在；也不能阻止对象部分已存在时进入可能产生局部 DDL 的执行路径。

因此，S1 在完成下述最小预检补正前，**不得创建、执行或提交 004 migration，也不得提交基础 Contracts**。

现有 runner 已具备 migration version 专属预检、同一 migrator connection、同一 advisory lock、SQL 执行成功后才写入 `schema_migrations` 的稳定扩展点。选择方案 A 是最小且符合既有 runner 模式的补正；无需引入新的 migration 框架或运行组合。

## 【本次唯一允许修改范围】

```text
packages/storage-mysql/src/index.ts
tests/mysql-s1-exploration-tracks.integration.test.ts
docs/daily-contributions/YYYY-MM-DD.md（仅在实际完成工程验证后，按项目规则记录实际修改）
```

允许在 `runMySqlMigrations()` 中为 **version 004 且尚未执行** 的 migration 增加私有专属预检函数或等价局部逻辑；不要求也不授权抽象为通用 migration DSL。

本次不允许创建、改动或执行：

```text
migrations/004_add_exploration_tracks.sql
packages/contracts/**
packages/domain/**
packages/application/**
packages/storage-mysql/src/**（index.ts 除外）
apps/api/**
apps/client/**
BackupData / BackupDocumentV3
日常 knowledge_base 或 knowledge_base_uat 的 Schema / 业务数据
```

## 【004 DDL 前预检冻结语义】

在取得既有 `knowledge_base_schema_migration` advisory lock、读取 `schema_migrations` 并确认 004 未执行后，且在对 004 调用 `splitStatements()` / 执行任一 SQL statement 前，使用 **同一 migrator connection** 查询当前 `DATABASE()` 对应 schema 的 `information_schema`。

预检必须确认以下对象全部不存在：

```text
1. 表：exploration_tracks
2. 列：items.exploration_track_id
3. 索引：
   - exploration_tracks_normalized_name_unique
   - exploration_tracks_active_updated_idx
   - items_exploration_track_created_idx
4. 外键约束：items_exploration_track_fk
```

查询必须按当前 connection 的 database 精确限定，例如使用 `table_schema = DATABASE()`；不得硬编码 `knowledge_base` 或 `knowledge_base_uat`，以确保日常、UAT 和随机临时测试库语义一致。

任一对象存在时，预检必须：

```text
在执行任何 004 DDL 前抛出明确错误
不得执行 004 中任一 statement
不得 INSERT schema_migrations version 004
不得改变既有 schema_migrations 001 / 002 / 003 记录
```

错误文案至少可定位为 `004 migration 预检失败`，并表明冲突对象类别；不得输出 MySQL 凭据或连接信息。预检不是应用运行时读写能力，不改变 health 最低 schema readiness 语义。

当 004 已在 `schema_migrations` 存在时，保持既有版本 / 文件名 / checksum 校验与幂等跳过逻辑；不得重复执行预检或 DDL，不得弱化 checksum 漂移拒绝。

## 【测试授权与验收门】

新增的 `tests/mysql-s1-exploration-tracks.integration.test.ts` 只允许验证 migration runner，不得通过测试实现或引入业务 Repository、Application、API 或 Backup 行为。

每个预检失败场景必须使用独立随机临时 database、独立 app / migrator 用户及临时 migration 目录，并按以下流程运行：

```text
执行 001 / 002 / 003
→ 使用 migrator 预置一个目标冲突对象
→ 将 004 文件放入临时 migration 目录
→ migrator 执行 runMySqlMigrations()
→ 断言在 DDL 前失败
→ finally 删除临时 database、用户与目录
```

至少覆盖：

```text
exploration_tracks 已存在
items.exploration_track_id 已存在
任一冻结索引已存在
items_exploration_track_fk 已存在
```

每个失败场景必须断言：

```text
schema_migrations 仅保留 001 / 002 / 003
不存在 version 004 成功记录
未出现本次场景之外的 004 目标对象
既有 001 / 002 / 003 schema 保持可用
app 用户持续 DML-only，不具备 DDL 权限
```

还必须保留或新增成功路径测试，证明在**无任何目标对象**的随机临时数据库中，加入 004 后 runner 可按既有行为执行全部 SQL 并只在 SQL 成功后记录 version 004。该成功路径仅在后续 `migrations/004_add_exploration_tracks.sql` 获得独立 S1 授权并实际存在后实施；本次补正不得先创建占位或试验性 004 文件。

本次预检补正完成后的验收命令至少包括：

```text
加载仅用于临时 MySQL 集成测试的环境变量后，定向运行 tests/mysql-s1-exploration-tracks.integration.test.ts
typecheck
test
git diff --check
```

不得对日常 `knowledge_base` 或隔离 UAT `knowledge_base_uat` 执行 004、清库、恢复或破坏性测试。本补正的真实 MySQL 证据只能使用独立临时 database。

## 【后续阶段门】

本裁决只解除“004 DDL 前预检机制缺口”的实现阻塞，不解除 S1 的其他实现门。

预检补正完成、QA 定向验证通过并经架构复审后，必须获得下一份书面授权，才可依次：

```text
1. 新增并执行 migrations/004_add_exploration_tracks.sql；
2. 提交基础 Contracts；
3. 进入 S1 完整验收。
```

S1 完整验收前继续禁止 S2、S3、前端、Repository、Application、API、Backup V3 及任何运行组合改动。
