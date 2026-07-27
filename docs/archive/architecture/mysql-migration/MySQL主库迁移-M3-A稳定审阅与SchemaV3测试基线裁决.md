# MySQL 主库迁移 — M3-A 稳定审阅与 Schema v3 测试基线裁决

> 状态：**M3-A 有条件通过。仅授权修正既有 M1 集成测试的 Schema v3 基线预期；该修正经 QA 回归通过后，方可封板 M3-A 并由架构师授权 M3-B。**
>
> 本裁决不改变运行主库：IndexedDB 仍是唯一运行主库；MySQL 仍仅为开发与合成测试中的候选 Repository；SQLite 保留为实验 / 测试资产。

## 【架构结论：有条件通过】

M3-A 的候选实现与 `003_method_lifecycle_constraints.sql` 的约束策略满足冻结要求：方法、版本、证据的结构化关系由真实 ID 建立；创建、验证和修订维持同一 MySQL DML transaction 的原子性；MySQL DDL 不可回滚风险通过 DDL 前预检、失败即停和不写入成功 migration 记录得到控制。

QA 已证明以下四类历史脏数据会在 `003` 执行 DDL 前被拒绝，且不会留下 Schema v3 成功记录或局部 DDL：

- 重复 `method_evidence(method_id, review_id)`；
- 重复 `method_applications.item_id`；
- `method_evidence.review_id` 断裂；
- `method_versions.source_review_id` 断裂。

但现有 `tests/mysql-m1.integration.test.ts` 仍将已授权的 Schema 基线硬编码为 v2。这会使 M1～M3 的组合验证无法表达真实的 v3 Schema 状态。因此，M3-A 尚不得正式封板，也不得开始 M3-B；必须先完成本裁决授权的最小测试预期更新并经 QA 回归确认。

## 【M3-A 是否封板】

**否，待条件封板。**

封板条件仅为：完成本文限定的 M1 Schema v3 测试基线更新，并由 QA 确认 M1、M2-A、M2-B、M3-A 定向真实 MySQL 回归及全量工程回归均通过。

该条件不要求、也不授权任何生产运行路径、Contract、Repository 业务语义或 Schema 的进一步修改。

## 【是否授权对 `tests/mysql-m1.integration.test.ts` 作最小预期更新】

**授权。** 允许修改范围仅限 `tests/mysql-m1.integration.test.ts` 的已授权 Schema 基线预期：

1. `schema_migrations` 的期望从 `001 / 002` 更新为 `001 / 002 / 003`；
2. 增加对 `003_method_lifecycle_constraints.sql` 的版本、名称与既有 SHA-256 checksum 断言；
3. `/health` 成功 DTO 的 `schemaVersion` 期望从 `2` 更新为 `3`。

这是历史测试基线随已授权 migration 演进的同步，不是迁移行为、健康检查行为或业务能力变更。

## 【该更新的精确边界】

允许：

```text
tests/mysql-m1.integration.test.ts
→ 仅更新 Schema v3 的成功路径预期。
```

明确禁止：

```text
修改 migrations/**
修改 packages/** 生产代码
修改 MySQL 权限或运行配置
修改 Contracts
修改健康检查 DTO 结构或脱敏规则
修改 MYSQL_REQUIRED_SCHEMA_VERSION
弱化 checksum 漂移拒绝
弱化 migration 幂等或 advisory lock 验证
弱化 app DML-only 权限验证
弱化未迁移 Schema 的 MYSQL_SCHEMA_NOT_READY 分类验证
```

`MYSQL_REQUIRED_SCHEMA_VERSION = 1` 保持不变。它表达当前仅提供 `/health` 的 API readiness 最低 Schema 门槛，而不是数据库必须处于最新 migration 的声明。将其升为 `3` 会改变健康检查 readiness 语义，须另行立项和架构评审，不能借本次测试同步偷渡。

## 【是否在该更新和 QA 回归后授权 M3-B】

**是，但须满足以下顺序：**

```text
最小测试基线更新
→ QA 定向与全量回归通过
→ 架构确认 M3-A 正式封板
→ 书面授权 M3-B
```

在上述闭环完成前，任何人不得提前实现或混入 M3-B。

## 【M3-B 允许修改层与禁止边界】

在 M3-A 正式封板后的独立授权中，M3-B 仅可修改：

```text
packages/storage-mysql/**
tests/mysql-m3b*.test.ts 或 tests/mysql-m3*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

M3-B 的候选范围仅包括：

```text
MethodApplicationRepository
MethodTombstone
Method、Item、Review 的既有永久清理编排
相关事务、锁、结构化读模型与失败回滚测试
```

持续禁止：

```text
Application 运行组合
apps/client/**
前端 HTTP Client
MySQL 业务 HTTP API
真实 IndexedDB → MySQL 迁移
IndexedDB / MySQL 双写
MySQL 主库切换
浏览器直连 MySQL
completeReview()
完整 ReviewWorkflow
派生事项创建
ItemLink 新能力或新写入流程
M3-C BackupData 改造
SQLite 实验资产改造或删除
未获独立评审的新 migration
```

## 【需补充的风险控制】

1. M3-B 开始前，先以 Schema v3 的干净随机临时数据库运行 M1～M3-A 组合测试，防止仅在 v1/v2 测试环境中漏测约束影响。
2. M3-B 的永久清理必须以单一 MySQL DML transaction 包裹完整清理序列；不得借助 `CASCADE`、`FOREIGN_KEY_CHECKS = 0` 或事务外读取拼接处理。
3. 对 Item、Review、Method 交错清理分别注入末端失败，断言业务快照、Tombstone、Evidence、Application、Version 与关联 Item / Review 均完整回滚。
4. 墓碑只能由真实 Method ID、保留的 Evidence / Application 和已验证的 Version 关系解释；禁止按标题、时间、版本号、文本或计数补造历史关系。
5. M3-B 不得改变 BackupData；完整方法生命周期的备份导入导出与原子恢复只能在 M3-C 单独实施和验收。

## 【下一责任岗】

**数据 / Application / Repository 工程师（仅执行 M1 Schema v3 测试基线最小更新）。**

## 【是否允许写代码】

**有条件允许。** 仅允许修改 `tests/mysql-m1.integration.test.ts` 中本文明确列出的 Schema v3 测试预期；不得开始 M3-B。完成后流转 QA，QA 通过后回流架构师做 M3-A 封板与 M3-B 授权确认。
