# SQLite 主库迁移 — S2 稳定审阅与 S3 开工决策

> 状态：**S2 候选数据层通过架构稳定审阅；允许按本任务书进入 S3。**
>
> 该结论不代表 SQLite 已成为运行主库。当前唯一运行主库仍是 IndexedDB。
>
> 关联：
> - `docs/architecture/SQLite主库迁移-分阶段实施基线与S1任务书.md`
> - `docs/architecture/SQLite主库迁移-S1稳定审阅与S2开工决策.md`
> - `docs/architecture/SQLite主库迁移-S2墓碑与事项永久清理裁决补充.md`

## 【技术结论：有条件可行，S2 通过并授权 S3】

SQLite S2 已在候选层证明下列基础能力：

```text
Item 基础读写、状态事件、启动动作、删除 / 恢复
Review 基础 Repository 契约
九集合 BackupData 导出与单事务替换
写入失败 rollback
方法关联事项永久清理的安全拒绝
system_metadata 与业务备份恢复隔离
```

定向 QA 已验证：孤立 `MethodTombstone` 不阻断无关联 Item 的永久清理；三类真实结构化方法关联会使 S2 `purgeDeletedBefore()` 整体拒绝且无副作用。

因此允许开始 S3 的**方法生命周期候选 Repository 实现**。但 S2 不是完整业务层，更不是 SQLite 主库迁移完成。

## 【S2 稳定边界】

### 已确认的候选实现边界

```text
packages/storage-sqlite/
├─ SqliteItemRepository
├─ SqliteReviewRepository
├─ SqliteBackupRepository
└─ createSqliteS2Repository
```

S2 保持既有 `ItemRepository`、`ReviewRepository`、`BackupRepository` Contracts 的基础形状；未修改：

```text
apps/client/**
packages/application/**
packages/contracts/**
packages/storage-indexeddb/**
JSON BackupDocument 格式
```

前端、Application 和运行时组合均未切换到 SQLite；不存在 IndexedDB / SQLite 双写，也未导入真实个人数据。

### S2 明确不承担的语义

以下能力尚未由 SQLite 候选层实现或验收，不能被假定为可用：

```text
完整方法生命周期与方法永久清理
ReviewWorkflow.completeReview() 编排
Search、Dashboard 与批量方法来源展示
严格的完整备份业务引用校验
Local API、恢复点、前端 API client、阻断页
旧 IndexedDB JSON 的真实迁移与重启 UAT
```

`SqliteReviewRepository.create()` 当前仅实现基础 Review 写入与单事项唯一性；其与状态迁移、方法形成 / 验证 / 修订的跨表原子编排属于后续 `ReviewWorkflow` 范围，不得将其误用于替代完整复盘闭环。

## 【确认的 P0 不变量】

### 1. 当前主库关系

```text
IndexedDB = 当前唯一运行主库
SQLite    = 仅用于临时合成数据自动化的候选数据层
```

禁止：

```text
前端接入 SQLite
真实个人数据写入 SQLite
IndexedDB 与 SQLite 双写
以 SQLite 结果替换 IndexedDB 运行读取
将 SQLite 称作主库或迁移完成
```

### 2. Item 写入与状态事件

SQLite S2 的 `changeStatus()`、`startExecution()`、`updateContent()`、`delete()`、`restore()` 均必须在 SQLite 写事务内重新读取当前 Item，并仅合并本次允许改变的字段。

特别是：

```text
startAction + idea_to_try → doing + ItemStatusEvent
= 同一事务

状态事件失败或 Item 写入失败
= 整体 rollback

updateContent
= 仅 content 与 updatedAt
= 不改写 status、startAction、状态事件
```

### 3. S2 Item 永久清理

`MethodTombstone` 不直接参与 `Item.purgeDeletedBefore()` 的阻断判断。

S2 仅当存在下列任一真实结构化关系时安全拒绝：

```text
MethodApplication.itemId = target Item.id
MethodEvidence.reviewId = target Item 对应 Review.id
MethodVersion.sourceReviewId = target Item 对应 Review.id
```

拒绝语义：

```text
throw "SQLite 方法关联清理尚未实施"
→ 当前 write transaction rollback
→ Item、Review、ItemStatusEvent、ItemLink、Method、MethodVersion、
  MethodEvidence、MethodApplication、MethodTombstone 均不得出现半成品变更
```

无上述关联时，可清理普通 Review、状态事件、ItemLink 与 Item；孤立墓碑必须保留且不得阻断该清理。

### 4. BackupData 与系统元数据隔离

S2 `BackupData` 仍为九个业务集合：

```text
items
reviews
methods
methodEvidence
methodVersions
methodApplications
itemStatusEvents
itemLinks
methodTombstones
```

`replaceData()` 必须：

```text
在单一 SQLite write transaction 内删除并重建上述九集合
发生任一约束或映射写入错误时整体 rollback
不得删除、覆盖或从 BackupData 恢复 system_metadata
```

S2 的导出 / 替换只证明九集合的存储完整性、基础数据库约束和事务回滚；S5 才负责将既有 `parseAndValidate` 的严格业务引用校验与 SQLite 导入导出逐集合等价性完整闭环。

## 【S3 最小范围】

S3 仅实现 SQLite 候选层中的方法生命周期事实及其可信读模型：

```text
Method
MethodVersion
MethodEvidence
MethodApplication
MethodTombstone
```

允许的能力：

1. `SqliteMethodRepository` 与 `SqliteMethodApplicationRepository` 实现现有 Contracts；
2. 方法形成、仅验证、修订所需的版本、证据与验证次数写入；
3. 方法移入回收站、恢复、30 天到期永久清理；
4. 方法永久清理时生成最小 `MethodTombstone`，删除 Method 与 MethodVersion 正文，保留 Evidence 与 Application；
5. 已移入回收站、已永久清理、断裂关联的历史上下文降级：
   ```text
   available
   method-in-trash
   method-purged
   unavailable
   ```
6. 当 S3 已在同一可信事务内清理事项相关 Evidence / Application 后，依据剩余引用回收最后一个无引用墓碑；
7. 事项池批量方法来源展示的 SQLite Repository 读模型，与既有结构化展示 Contract 对齐。

## 【S3 非目标】

S3 禁止扩张为：

```text
ReviewWorkflow.completeReview() 或状态机编排
Search、Dashboard
Local API、静态 H5 托管、前端切换
JSON 自动恢复点
真实 IndexedDB → SQLite 导入
双写、读切换、主库切换
Schema v2、额外业务字段或 Backup v3
Todo、计划、同步、账号、云端
```

如 S3 实现发现既有 Contracts 不足以表达某项已冻结方法语义，必须停止并回架构评审；不得由 SQLite 表结构或前端展示需求自行新增字段、猜测历史关系或改变备份格式。

## 【允许修改的层与文件范围】

数据 / Application 工程师在 S3 可修改：

```text
packages/storage-sqlite/src/**
  - 新增方法 Repository、SQLite 映射、候选 bundle 组合
  - 必要的 schema v1 内现有表查询与事务实现

tests/sqlite-*.test.ts
  - S3 定向 SQLite Repository、生命周期、失败回滚和读模型测试

docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

只有在现有 Contracts 无法忠实实现已冻结语义、且提出明确证据时，才可申请修改：

```text
packages/contracts/**
packages/application/**
```

本授权不允许修改：

```text
apps/client/**
packages/storage-indexeddb/**
BackupDocument 版本与 JSON 格式
Local API / server 目录
```

## 【S3 自动化测试与验收】

S3 必须以真实临时 SQLite 文件完成自动化测试，至少覆盖：

1. 方法形成、验证、修订的版本、证据 relation 与 `methodVersion`；
2. 方法应用冻结的版本与历史上下文；
3. 方法回收站、恢复及活跃方法不可见 / 不可发起新行动的边界；
4. 到期方法永久清理：Method 和 MethodVersion 删除、Evidence 与 Application 保留、最小墓碑产生；
5. `method-in-trash`、`method-purged`、`unavailable` 的可信降级，且不通过标题、时间、版本号或文案猜关系；
6. 应用引用的版本不存在、墓碑写入失败等场景下的方法永久清理整体 rollback；
7. Item purge 与方法关联：S3 接管后，只清理有确定结构化关系的关联记录；最后引用消失才回收墓碑；
8. `MethodTombstone` 与同 ID 活跃 Method 不得共存；
9. S2 Item / Review / Backup、S1 打开与完整性检查、既有 IndexedDB 全量回归。

验证通过的最低门槛：

```text
typecheck
test（含 S3 定向与全量）
build:h5
git diff --check
```

每完成一轮工程验证，必须按项目规则将当天实际修改追加到：

```text
docs/daily-contributions/YYYY-MM-DD.md
```

## 【交付给数据层工程师的技术约束】

```text
S2 已稳定，允许开始 S3；但 SQLite 仍是候选存储。

1. 只能以既有结构化 methodId、reviewId、itemId、冻结 version
   和 tombstone 版本映射建立关系；不得猜测。
2. 方法永久清理与墓碑写入必须是同一 SQLite write transaction；
   失败不得留下半清理状态。
3. S3 接管 Item purge 前，不得移除 S2 的三类安全拒绝。
4. S3 接管后，清理关联与墓碑最后引用回收必须同事务完成。
5. 不得接入前端、Application 运行路径、Local API、真实迁移或双写。
6. 未被自动化证明的 SQLite 语义不得描述为已与 IndexedDB 等价。
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**允许，仅限 S3 候选 SQLite 方法生命周期 Repository 与定向测试。**
