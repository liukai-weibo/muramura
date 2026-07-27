# MySQL 主库迁移 — M3-B 正式稳定审阅、封板与 M3-C 实施授权

> 状态：**M3-B 已正式封板；M3-C 获得受限实施授权。**
>
> 本授权不改变运行主库。IndexedDB 仍是唯一运行主库；MySQL 仍仅为开发与合成测试中的候选 Repository；SQLite 保留为实验 / 测试资产。

## 【架构结论：通过】

M3-B 已满足退出门。M2-A 三条历史“存在方法关联即拒绝永久清理”测试已被准确同步为 M3-B 冻结的跨对象清理 Contract，验证的是实际数据库清理结果与保留关系，不是将 `rejects` 表面替换为 `resolves`。

真实 MySQL 串行组合回归覆盖 M1、M2-A、M2-B、M3-A、M3-B，共 5 个文件、32 项测试通过；全量工程回归也已通过。串行文件模式仅隔离多个随机临时 MySQL 数据库的本地资源竞争，不降低任何断言或测试场景。

M3-B 的以下边界持续成立：

```text
MethodApplication 创建与 Item / 初始状态事件原子一致
结构化方法应用读模型与可信历史降级
Method purge 的 Tombstone、Method / Version 原子清理
Item purge 的跨对象事务编排
独立 Review 删除仍对方法关联安全拒绝
```

## 【M3-B 是否封板】

**是，正式封板。**

M3-B 封板仅覆盖候选 Repository 的方法应用、墓碑、Method 永久清理与 Item 跨对象永久清理等价验证；不代表 MySQL 成为运行主库，也不代表 IndexedDB 已退出业务读写。

## 【是否书面授权 M3-C】

**是，授权。**

M3-C 是独立、串行的 BackupData 验证切片，只能证明 M2-B 已有 `MySqlBackupRepository` 在包含完整方法生命周期数据时仍保持导入、导出、严格校验及原子恢复的等价性。

M3-C 不得新增 Repository 业务能力，不得把 M3-B 的候选实现接入 Application 或任何运行路径。

## 【M3-C 最小允许修改层】

```text
packages/storage-mysql/src/backup-repository.ts
  （仅为完整既有九集合映射、确定性排序或原子导入导出所必需的最小修正）
packages/storage-mysql/src/index.ts
  （仅限既有导出或测试组装所必需的最小调整）
tests/mysql-m3c*.test.ts 或 tests/mysql-m3*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

任何修改必须直接服务于 M3-C BackupData 闭环。若发现现有 Contract、Schema 或 parser 无法表达所需事实，必须停止并重新走产品、架构评审；不得自行改造数据模型。

## 【M3-C 严格允许范围】

仅允许验证和必要修正以下既有能力：

```text
包含 Method、MethodVersion、MethodEvidence、MethodApplication、
MethodTombstone 的 BackupData 九集合导出
parseAndValidate() 后的 replaceData() 单一 MySQL DML transaction
完整生命周期关系的引用校验、导入顺序与确定性导出排序
非法备份零写入
末端 SQL 失败的完整 rollback
system_metadata 不导出、不删除、不恢复、不覆盖
v1 / v2 兼容与既有 JSON format / version 语义
```

## 【M3-C 原子恢复与引用校验约束】

`replaceData()` 必须继续严格遵循：

```text
parseAndValidate()
→ app 用户单一 MySQL DML transaction
→ DELETE：links / events / applications / evidence / versions /
          tombstones / reviews / methods / items
→ INSERT：items / methods / reviews / versions / evidence /
          applications / tombstones / links / events
→ COMMIT
```

必须保持：

1. `parseAndValidate()` 失败时不得开始 `replaceData()`，既有候选 MySQL 业务数据与 `system_metadata` 均不得改变。
2. M3 生命周期引用只能使用现有结构化 ID / version 字段：
   - `method_versions.method_id` 必须对应导入 Method；
   - `method_evidence.review_id` 必须对应导入 Review；
   - `method_applications.item_id` 必须对应导入 Item；
   - Application 指向的 Method / Version 必须能由活跃 Method / Version 或 Tombstone 中真实版本证明；
   - Tombstone 不得与活跃 Method 同 ID，墓碑版本必须有效。
3. M3 Schema 003 的 Review 外键约束要求 Review 先于 Evidence / Version 导入，Evidence / Version 先于 Review 清理。
4. 任一集合的末端 SQL 写入失败，全部业务集合必须回滚到导入前快照；不得仅检查单表。
5. 禁止使用 `TRUNCATE`、`CASCADE`、`FOREIGN_KEY_CHECKS = 0`、root 或 migrator 写入业务数据。
6. 导出排序必须确定：Method、Evidence、Application 按主键；Version 按 `method_id, version, id`；Tombstone 按 `method_id`。

## 【M3-C 自动化验收门】

QA 必须在真实随机临时 MySQL 数据库中验证：

1. 含完整方法生命周期关系的 v2 BackupData 满足：

   ```text
   parse → replaceData → export
   → 既有规范化语义下等价
   ```

2. v1 / v2 兼容持续成立；既有可选 `sourceReviewId` 归一化语义未被改写。
3. 非法备份在进入 SQL transaction 前拒绝，覆盖至少：必填引用断裂、重复 Application Item、活跃 Method 与 Tombstone ID 冲突、无法证明的 Tombstone Version、错误方法关联。
4. 最后一集合或末端 SQL 失败注入时，Items、Reviews、Methods、Versions、Evidence、Applications、Tombstones、Links、Events 全部恢复至导入前业务快照。
5. `system_metadata` 在有效恢复、非法备份与末端失败回滚中均保持真实原值，且从不出现在业务备份 JSON。
6. M1～M3-C 串行真实 MySQL 回归、无 `.env` 时明确 skip、typecheck、全量 test、build:h5、`git diff --check` 全部通过。

M3-C 完成后必须流转 QA，再回流架构师进行 M3 总体稳定审阅；不得自行宣布 MySQL 主库迁移完成。

## 【持续冻结边界】

```text
不得接入 Application 运行组合
不得修改 apps/client/**
不得新增前端 HTTP Client 或 MySQL 业务 HTTP API
不得真实 IndexedDB → MySQL 迁移
不得 IndexedDB / MySQL 双写
不得主库切换
不得浏览器直连 MySQL
不得实现 completeReview() 或完整 ReviewWorkflow
不得新增或修改未经独立评审的 migration
不得删除或改造 SQLite 实验资产
不得引入 Kubernetes、云端同步、远程访问或协作
不得新增任何 Repository 业务能力
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**是，仅限 M3-C BackupData 等价与原子恢复验证范围。** 完成后流转 QA；QA 通过后必须回流架构师进行 M3 总体封板判断。MySQL 仍是候选 Repository，IndexedDB 持续是唯一运行主库。
