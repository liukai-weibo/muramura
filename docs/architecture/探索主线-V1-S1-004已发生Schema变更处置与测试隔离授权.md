# 探索主线 V1 S1：004 已发生日常 Schema 变更处置与测试隔离授权

> 日期：2026-07-24
>
> 结论：**确认 `knowledge_base` 已实际执行 004，当前为 schemaVersion 4；禁止 DDL 回退。授权仅处理测试隔离及随 migration 目录演进的测试事实基线。004 尚未完成 S1 环境验收，基础 Contracts、S2、S3 继续冻结。**
>
> 依据：`docs/product/当前运行事实.md`、`docs/architecture/探索主线-V1-S1-004MigrationSQL独立实施授权.md`、`tests/mysql-m1.integration.test.ts`、`tests/mysql-m5a.integration.test.ts`。

## 【事实与责任边界】

已发生的事实必须如实保留：历史 `mysql-m1.integration.test.ts` 直接读取 `.env`，使用 `knowledge_base` 的 migrator pool 调用 `runMySqlMigrations(migrationsDirectory)`。正式 004 加入目录后，该测试实际对日常库执行 004，使 `knowledge_base` 的 `schemaVersion` 从 3 升至 4。

这不是“仅测试预期失配”：它是对日常 schema 已产生的真实 DDL 变更。当前运行事实已同步此现场状态。它不等于：

```text
S1 已验收
基础 Contracts 已授权
探索主线功能已实现
knowledge_base_uat 已部署 004
```

禁止以反向 DDL、修改已执行 migration、删除 schema_migrations 004 或其他手工手段回退 / 掩盖此状态。MySQL DDL 非一般性事务回滚，且本阶段没有日常库回退授权。

## 【环境裁决】

```text
knowledge_base：当前 schemaVersion 4，保留既成状态；禁止继续以集成测试路径对其迁移、清库、恢复或写入合成业务数据。
knowledge_base_uat：当前 schemaVersion 3；继续禁止执行 004、清库、恢复或业务写入。
后续 004 Schema 行为验证：仅随机临时 MySQL database，独立 app / migrator 用户与临时 migration 目录。
```

正式部署 004 至 UAT、日常库进一步确认或回退策略属于独立运行环境部署评审，必须在 S1 SQL 与测试隔离 QA / 架构复审通过后另行授权。

## 【本次最小授权】

允许修改：

```text
tests/mysql-m1.integration.test.ts
tests/mysql-m5a.integration.test.ts
package.json（仅在 test:mysql:integration 的文件集合或显式入口需要同步时）
docs/daily-contributions/YYYY-MM-DD.md（实际验证完成后追加）
```

本次不允许修改：

```text
migrations/**
packages/storage-mysql/src/**
packages/contracts/**
packages/domain/**
packages/application/**
apps/api/**
apps/client/**
BackupData / BackupDocumentV3
MySQL Compose、用户、权限、端口或运行组合
knowledge_base / knowledge_base_uat 的 schema 或业务数据
```

## 【测试隔离与基线同步要求】

### 1. `mysql-m1.integration.test.ts` 必须迁出日常库

M1 的 migration 幂等、checksum 漂移、app DML-only 与 ready health 成功路径必须改在随机临时 database 中运行。每个测试或受控测试 fixture 应：

```text
root 创建随机 database 与独立 app / migrator 用户
→ 授予与既有临时 MySQL 集成测试一致的最小权限
→ migrator 对临时 database 运行当前 migrations/ 目录
→ 执行 M1 断言与临时 API health
→ finally 删除临时 database、用户及临时 migration 目录
```

不得再创建 `.env` 指向日常库的 appPool / migratorPool，也不得通过 M1 测试读取、迁移或写入 `knowledge_base`。未迁移 schema health 场景继续使用随机临时未迁移库。

M1 的 records 断言不得硬编码旧版本上限。它必须从**当前受控 migration directory 的文件集合**构造预期版本 / 名称 / SHA-256 checksum，仍严格断言：

```text
已执行 migration 与当前文件集合一一对应
重复运行幂等
任意已执行 migration 内容漂移被拒绝
健康成功 DTO 的 schemaVersion 等于当前文件集合最大 version
app 用户 DML-only
health 不泄露连接细节
```

这不是弱化 migration 可信性；它将“最新版本”从历史数字常量改为当前迁移资产的显式事实，同时保留 exact version/name/checksum 对应与漂移拒绝。

### 2. `mysql-m5a.integration.test.ts` 同步临时库事实

该文件已经使用随机临时 database，允许仅将 health 成功路径的 `schemaVersion: 3` 改为由当前 migration directory 最大 version导出的明确期望。不得改动 API、读模型、测试数据或任何业务断言。

不得把健康断言降级为 `expect.any(Number)`；必须断言当前 migration 文件集合的精确最大 version。

### 3. 不得让测试吞没环境事故

测试改造完成后，必须存在明确断言或测试辅助保护，证明 M1 / M5 / S1 MySQL integration tests 的目标 database 名称是随机临时库前缀，而不是 `.env` 的 `knowledge_base` 或 `.env.uat` 的 `knowledge_base_uat`。如发现测试无法证明目标隔离，停止并重新审查。

## 【验收门】

完成后必须由 QA 复验：

```text
1. 004 正式 SQL 定向临时库测试 7/7 或增加后的全部场景通过；
2. mysql-m1 与 mysql-m5a 均只使用随机临时库，且当前 migrations/ 集合为断言唯一事实源；
3. 加载 .env 后 test:mysql:integration 12 files 全部通过，不触及 knowledge_base / knowledge_base_uat；
4. 无 .env 常规全量 test、typecheck、git diff --check 通过；
5. 运行前后分别核对 knowledge_base = schemaVersion 4、knowledge_base_uat = schemaVersion 3，且两库 schema_migrations 与业务数据快照无新增测试写入；
6. daily contribution 记录实际增加项 / 修复项，不记录验证过程。
```

若任何随机临时库清理失败、或任何测试仍连到日常 / UAT，停止并按 P1 环境隔离问题重新裁决。

## 【后续门禁】

本授权不允许进入基础 Contracts。只有本次隔离复验、004 SQL QA、架构稳定审阅全部通过后，才可签发下一份独立授权讨论：

```text
S1 基础 Contracts
004 向 knowledge_base_uat 的受控部署与验证
knowledge_base schemaVersion 4 的运行环境验收
```

在此之前继续禁止 S2、S3、API、H5、Backup V3 与任何业务功能实现。
