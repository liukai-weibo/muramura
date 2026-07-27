# SQLite 主库迁移 — S4 稳定审阅与 S5 开工决策

> 状态：**S4 候选数据层通过稳定审阅；允许按本任务书进入 S5。**
>
> SQLite 仍不是运行主库。当前唯一运行主库仍是 IndexedDB。
>
> 关联：
> - `docs/architecture/SQLite主库迁移-S3稳定审阅与S4开工决策.md`
> - `docs/architecture/SQLite主库迁移-S4定向补测与稳定审阅前置条件.md`

## 【技术结论：有条件可行，S4 封板并授权 S5】

S4 封板前要求的补测已具备可信证据：

```text
existingMethod 不存在        → 完整 BackupData 不变
existingMethod 位于回收站    → 完整 BackupData 不变
MethodEvidence INSERT 失败   → 在 Review 已写入后仍整体 rollback

回收站 Item                  → 不出现在 Search / Dashboard
活跃 Method                  → 可作为当前 method 搜索结果出现
回收站 Method                → 不作为当前 method 搜索结果或 Dashboard 方法出现
历史 MethodVersion           → 仍按独立历史事实检索
```

因此，SQLite 候选层已具备现有 Contracts 中 Item、Review、Method 生命周期、ReviewWorkflow、Search、Dashboard 与基础 Backup Repository 的实现证据。

但这不等价于主库迁移完成。S5 的责任是证明 **JSON 备份格式、严格校验和 SQLite 导入导出的完整等价性**，之后才有资格讨论 Local API 与真实迁移。

## 【S4 稳定边界】

### 1. ReviewWorkflow 的原子性

`SqliteReviewWorkflowRepository.complete()` 的所有写入必须始终处在一个 SQLite write transaction：

```text
Review
Method / MethodVersion / MethodEvidence
派生 Item / 初始 ItemStatusEvent / ItemLink
原 Item 的 reviewed 状态与状态事件
```

任何一个写入失败：

```text
所有上述事实整体 rollback
```

不得将该闭环拆为 Application 层的多个 Repository 调用，也不得先提交 Review 再写方法或最终状态。

### 2. Search / Dashboard 读模型边界

```text
回收站 Item 与 Method
→ 不作为活跃 Search / Dashboard 对象出现

MethodVersion
→ 是独立的历史事实
→ 不因当前 Method 进入回收站而被错误删除或隐藏
```

所有读模型只使用 SQLite 中现存结构化记录；不得根据标题、时间、文本或版本猜测断裂关系。

## 【S5 最小范围】

S5 只处理 SQLite 候选层的备份恢复可信闭环。目标是证明：

```text
既有 BackupDocument v1 / v2
→ BackupApplicationService.parseAndValidate()
→ SqliteBackupRepository.replaceData()
→ SqliteBackupRepository.exportData()
→ 规范化后业务事实等价
```

### S5 必须完成

1. **复用既有备份格式与 Application 校验逻辑**
   - `BackupDocument` 继续只支持 v1 / v2；
   - 不新增 Backup v3；
   - SQLite 恢复必须经 `BackupApplicationService.parseAndValidate()` 后才可调用 `replaceData()`；
   - 不得复制、弱化或绕过既有严格引用校验。

2. **全九集合的导入导出等价性**
   - 使用覆盖完整业务事实的 SQLite 合成数据：
     ```text
     Items（content、startAction、deletedAt）
     ItemStatusEvents
     Reviews
     Methods（含回收站状态）
     MethodVersions
     MethodEvidence（relation / methodVersion）
     MethodApplications
     ItemLinks
     MethodTombstones
     ```
   - 导出后恢复到新的临时 SQLite 文件，再次导出；
   - 忽略 JSON 数组天然顺序后，按稳定 ID、字段和墓碑版本映射逐字段等价；
   - 不得用 `JSON.stringify()` 的数组顺序相等代替规范化比较。

3. **v1 / v2 兼容和稳定降级**
   - v1 缺失 `methodTombstones`：归一化为空数组并可恢复；
   - v1 缺失历史可选集合时，沿用已冻结的现有 `parseAndValidate()` 归一化规则；
   - 旧数据缺失 `startAction`：恢复后保持 `undefined`；
   - 非字符串 `startAction` 必须拒绝；
   - 断裂的可选 `MethodVersion.sourceReviewId` 仅按既有规则归一化为空，不得猜测替代来源。

4. **严格非法备份拒绝与零覆盖**
   对每类非法文档，必须先在 SQLite 写入一份基线数据，再验证：

   ```text
   parseAndValidate() 拒绝
   → 不调用 replaceData()
   → SQLite 基线 BackupData 完全不变
   ```

   至少覆盖：

   ```text
   必填 Item / Review / Method / ItemLink 引用断裂
   MethodEvidence 的 method 或 review 引用断裂
   MethodApplication 的 item、method 或冻结版本不可证明
   活跃 Method 与同 ID Tombstone 并存
   无效 Tombstone 版本映射
   非法 Item 状态、非字符串 startAction
   重复或空 ID
   ```

5. **Repository 防御性边界**
   `SqliteBackupRepository.replaceData()` 仍必须是单个 write transaction，发生任意 SQL 约束、映射或最后集合写入失败时整体 rollback；并且：

   ```text
   system_metadata 不得被业务备份删除、覆盖或伪造
   ```

   Application 的解析校验是恢复入口的业务防线；Repository 的事务与数据库约束是最后一道存储防线。两者不得互相替代。

## 【S5 非目标】

禁止：

```text
Local API
127.0.0.1 运行入口或 H5 静态托管
前端 API Client、阻断页或运行时切换
真实 IndexedDB JSON 导入
真实个人数据迁移
自动恢复点文件与保留策略的运行时实现
IndexedDB / SQLite 双写
主库切换、灰度、回退、重启 UAT
Schema v2、BackupDocument v3、字段扩张
```

S5 的“恢复”仅限临时合成 SQLite 数据库中的自动化验证。不得以测试名义导入任何真实个人备份。

## 【允许修改的层与文件范围】

允许数据 / Application / Repository 工程师修改：

```text
packages/storage-sqlite/src/backup-repository.ts
packages/storage-sqlite/src/index.ts（仅必要的候选 bundle 组合）
tests/sqlite-*.test.ts

docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

如发现现有 `BackupApplicationService.parseAndValidate()` 无法对 SQLite 恢复保持已冻结的 v1/v2 语义，可提出最小补丁申请。未经架构复审，不得直接修改：

```text
packages/application/**
packages/contracts/**
packages/storage-indexeddb/**
apps/client/**
Schema 版本、备份格式
```

## 【S5 自动化测试与验收】

必须用真实临时 SQLite 文件执行：

1. 全九集合 v2 导出 → 解析 → 新库恢复 → 规范化逐字段等价；
2. v1 缺墓碑、缺可选历史集合及缺 `startAction` 的兼容恢复；
3. 新导出仍为 v2，并保留 `content`、`startAction`、删除状态、证据 relation / version、墓碑最小版本映射；
4. 上述每类非法备份均在解析前失败或恢复前失败，且已有 SQLite 数据不变；
5. `replaceData()` 的 SQL 末端失败整体 rollback，并保留 `system_metadata`；
6. S1–S4 SQLite 定向回归与既有 IndexedDB 全量回归；
7. 工程验证：
   ```text
   typecheck
   test
   build:h5
   git diff --check
   ```

每次工程验证后，必须按项目规则追加实际修改至：

```text
docs/daily-contributions/YYYY-MM-DD.md
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**允许，仅限 S5 SQLite 候选备份等价性、严格恢复校验的自动化测试与最小根因修复。**
