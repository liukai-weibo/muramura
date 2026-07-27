# MySQL 主库迁移 — M3-A 正式稳定审阅、封板与 M3-B 实施授权

> 状态：**M3-A 已正式封板；M3-B 获得受限实施授权。**
>
> 本授权不改变运行主库。IndexedDB 仍是唯一运行主库；MySQL 仍仅为开发与合成测试中的候选 Repository；SQLite 保留为实验 / 测试资产。

## 【架构结论：通过】

M3-A 已满足退出门。

`003_method_lifecycle_constraints.sql` 在最小权限 migrator 与真实临时 MySQL 数据库中完成验证；四类存量脏数据均在 DDL 前被预检拒绝，未产生局部约束、Schema v3 成功记录或权限扩大。`MySqlMethodRepository` 的创建、验证、修订、版本与证据读模型保持既有 Contract 语义，并以真实集成测试证明多表写入失败时整体回滚。

M1 的 Schema 基线测试已仅同步已授权的 v3 成功路径预期：`schema_migrations` 为 `001 / 002 / 003`，`/health.schemaVersion` 为 `3`。checksum 漂移、幂等、advisory lock、app DML-only、`MYSQL_SCHEMA_NOT_READY`、健康检查脱敏和 `MYSQL_REQUIRED_SCHEMA_VERSION = 1` 均未改变。

真实 MySQL 串行组合回归共 4 个文件、26 项通过；工程验证已通过。串行运行用于避免多个独立临时数据库预检场景争用本地 MySQL 并触发测试框架默认超时，不代表放宽测试、减少场景或提高超时阈值。

## 【M3-A 是否封板】

**是，正式封板。**

M3-A 封板范围：

```text
Schema 003 约束与 DDL 前脏数据预检
MySqlMethodRepository 的 Method / MethodVersion / MethodEvidence 基础生命周期
创建、验证、修订的事务原子性与失败回滚
结构化证据、版本、回收站读取与可信历史降级
M1 Schema v3 集成测试基线同步
```

M3-A 封板不包含 MethodApplication、MethodTombstone、Method 永久清理、Item / Review 永久清理升级或方法生命周期 BackupData 回归。

## 【是否书面授权 M3-B】

**是，授权。**

M3-B 必须严格串行实施；只可在 M3-A 封板范围之上增加下列候选 Repository 等价验证：

```text
MySqlMethodApplicationRepository 全 Contract
MySqlMethodRepository.purgeDeletedBefore
MySqlItemRepository.purgeDeletedBefore 的 M3 跨对象清理替代
与既有 Review 删除安全拒绝的回归验证
```

M3-B 完成后必须先经过 QA 和独立架构稳定审阅，方可讨论 M3-C。不得将 M3-B 与 M3-C 混合实施。

## 【M3-B 最小允许修改层】

```text
packages/storage-mysql/src/method-application-repository.ts（可新增）
packages/storage-mysql/src/method-repository.ts
packages/storage-mysql/src/item-repository.ts
packages/storage-mysql/src/review-repository.ts（仅为维持既有删除拒绝 Contract 所必需的最小适配）
packages/storage-mysql/src/index.ts（仅限导出或既有 Repository 组装所必需的最小调整）
tests/mysql-m3b*.test.ts 或 tests/mysql-m3*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

不得修改 `migrations/**`。Schema 003 已冻结；若实施中发现 Schema 无法表达既有 Contract，必须停止并退回产品经理、架构师重新评审，不能新增 004 或修改 003。

## 【M3-B 事务、锁与失败回滚要求】

### 1. MethodApplication 创建

`createItem(input)` 必须在单一 app 用户 MySQL DML transaction 中完成：

```text
按 Item → Method → Version / Application 的固定顺序锁定
→ 校验 Method 活跃且当前 Version 真实存在
→ 创建 Item
→ 写入初始 ItemStatusEvent
→ 写入唯一 MethodApplication
→ COMMIT
```

任一语句、唯一约束或失败注入失败时，Item、初始事件、Application 必须全有或全无。不得创建 ItemLink，不得按标题、时间或版本计数推断方法关联。

### 2. Method 永久清理

`purgeDeletedBefore` 对每个候选 Method 必须在同一 transaction 中：

```text
锁定 Method
→ 锁定并读取 Version、Evidence、Application、已有 Tombstone
→ 验证每个 Application.methodVersion 可由真实 Version 证明
→ 创建可信 Tombstone
→ 删除 MethodVersion
→ 删除 Method
→ COMMIT
```

Evidence 与 Application 是历史事实，Method 清理后保留。Tombstone 创建、正文与 Version 删除必须全有或全无；无法证明的历史版本、重复 Tombstone、缺失 Method 或并发竞争必须 fail-safe，不得覆盖或补造墓碑。

### 3. Item 永久清理升级

以 M3 任务书规定的统一锁顺序执行：

```text
Item → Review → Method → Version / Evidence / Application → Tombstone
```

对过期软删除 Item，必须在**单一 MySQL DML transaction**中完成：收集结构化关联、删除 `item_links` 与状态事件、删除 Application、删除关联 Evidence、按保留历史事实决定删除 Method/Version 或仅清空受删 Review 的 `source_review_id`、按条件删除无历史引用的 Tombstone、最后删除 Review 与 Item。

不得使用 `CASCADE`、`TRUNCATE`、`FOREIGN_KEY_CHECKS = 0`、事务外旧快照覆盖写入或任何基于非结构化信息的关联推断。

### 4. Review 删除

`MySqlReviewRepository.delete()` 继续保持 M2-B Contract：只要存在 `MethodEvidence.reviewId` 或 `MethodVersion.sourceReviewId`，必须拒绝：

```text
复盘存在方法关联，暂不能删除
```

M3-B 不得把单独 Review 删除扩张为跨对象强制清理入口。

## 【M3-B 验收边界】

QA 必须在真实随机临时 MySQL 数据库中证明：

1. Application 创建时 Item、初始状态事件、Application 原子一致；不存在 / 回收站 Method、错误 Version 与重复 Application Item 均稳定拒绝且零副作用。
2. Application 读模型只由 Method、Version、Application、Tombstone 的结构化引用建立；逐项覆盖 `available`、`method-in-trash`、`method-purged`、`unavailable`、`no-association`，禁止伪造标题或正常关系。
3. Method purge 对可证明版本创建 Tombstone，保留 Evidence/Application；无法证明 Application Version 时拒绝并完整回滚。
4. Item purge 覆盖 Application、Evidence、Version source、ItemLink、状态事件、Review、Method、Version、Tombstone 的正向、交错和并发保护路径；每个末端失败注入均对完整受影响业务快照断言回滚。
5. 独立 Review 删除继续覆盖两类方法关联拒绝及无关联正向删除。
6. M1～M3-B 定向真实 MySQL 回归、无 `.env` 明确跳过、typecheck、全量 test、build:h5、`git diff --check` 均通过。

M3-B 不验证或修改 BackupData。含完整生命周期关系的导入导出、引用校验和 `replaceData()` 回归属于 M3-C 的独立阶段。

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
不得提前实施 M3-C BackupData 改造
不得新增或修改未经独立评审的 migration
不得删除或改造 SQLite 实验资产
不得引入 Kubernetes、云端同步、远程访问或协作
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**是，仅限 M3-B 已授权范围。** 完成后必须流转 QA；QA 通过后回流架构师进行 M3-B 稳定审阅。MySQL 候选测试通过不等于运行主库切换，IndexedDB 持续为唯一运行主库。
