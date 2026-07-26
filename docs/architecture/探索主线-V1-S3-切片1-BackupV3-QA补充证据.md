# 探索主线 V1 S3 切片 1：Backup V3 QA 补充证据

> 日期：2026-07-25
> 范围：仅切片 1 Backup V3（后端）测试与审计证据补充

## 补充的预写入拒绝测试

`tests/mysql-m2b.integration.test.ts` 在随机临时 MySQL database 中分别构造 V3：

- 空 Item ID；
- 空白 Track 名称；
- 与名称不一致的 Track `normalizedName`；
- 非法 Track `createdAt`。

每种输入均在 `parseAndValidate()` 阶段拒绝，随后以 MySQL Backup 导出比较十个业务集合，结果与基线完全一致；未调用恢复写入。

## 13 文件 MySQL 回归与运行库隔离

执行 `corepack pnpm test:mysql:integration` 时，测试创建并清理随机临时 database。结果：13 个测试文件、125 个测试通过。

运行库在回归前后使用既有 `scripts/uat-schema004-readonly-snapshot.sh` 进行只读深度快照。快照位于项目外受限临时目录，未纳入 Git，覆盖 `schema_migrations`、十个业务集合与 `system_metadata` 的稳定排序完整记录、行数和 SHA-256 manifest。

比较结论：

```text
knowledge_base: SNAPSHOTS_IDENTICAL
knowledge_base_uat: SNAPSHOTS_IDENTICAL
```

快照脚本只运行固定 `SELECT`、information_schema 查询和只读 `mysqldump`；未对任一运行库执行 DDL 或 DML。

## 切片 1 文件清单

```text
packages/contracts/src/index.ts
packages/application/src/index.ts
packages/storage-mysql/src/backup-repository.ts
tests/mysql-m2b.integration.test.ts
tests/mysql-m3c.integration.test.ts
tests/api-m5b.integration.test.ts
tests/sprint-three.test.ts
docs/architecture/探索主线-V1-S3-切片1-BackupV3-QA补充证据.md
docs/daily-contributions/2026-07-25.md
```

本清单不包含当前工作树中其他岗位或历史遗留改动。切片 2 未开始。
