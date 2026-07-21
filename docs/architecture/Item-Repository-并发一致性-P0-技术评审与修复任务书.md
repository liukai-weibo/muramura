# Item Repository 并发读改写一致性 — P0 架构评审与修复任务书

> 优先级：**P0**
> 状态：**立即冻结前端范围扩展；授权 Application / Repository 工程师实施最小修复与自动化测试。**
> 触发原因：`changeStatus()`、`updateContent()`、`delete()`、`restore()` 均存在“事务外读取旧 Item → 内存合成 → put”的潜在读改写覆盖窗口。

## 【技术结论：可行】

问题成立，且必须在 Repository 层修复。

当前 `changeStatus()` 虽已将 Item 写入与 `ItemStatusEvent` 写入放入同一事务，但其读取和 `updated` 对象构造发生在事务外。若 `updateContent()` 同时基于同一个旧 Item 执行 `put()`，后提交的一方可能写回旧的 `status` 或旧的 `content`。这会导致：

```text
状态事件记录 doing
但 Item 被旧 content 保存写回 idea_to_try
```

这属于数据事实与状态历史不一致，不能靠页面 busy、按钮禁用、延迟或重试补救。

采用最小方案：**所有对既有 Item 的读—校验—合成—写入均在同一 IndexedDB readwrite 事务中完成，并在事务内重新读取当前 Item。**

不需要新增字段、乐观锁版本、Schema、Migration、备份格式、状态机或全局状态库。

## 【根因与覆盖范围】

必须纳入统一修复的既有 Item 写入路径：

| 路径 | 当前风险 | 修复要求 |
|---|---|---|
| `changeStatus()` | 外部旧读取可覆盖并发内容更新；事件与最终 Item 可能矛盾 | 事务内重新读取，状态写入与事件同事务 |
| `updateContent()` | 外部旧读取可回滚状态或 `deletedAt` | 事务内重新读取，只合并 content / updatedAt |
| `delete()` | 外部旧读取可覆盖并发内容或状态 | 事务内重新读取，只合并 deletedAt / updatedAt |
| `restore()` | 外部旧读取可覆盖回收站期间仍有效的字段更新，或错误恢复 | 事务内重新读取，删除 `deletedAt` 后写回最新对象 |
| `complete()` 工作流内的状态迁移 | 内部调用 `changeStatus()`，必须继续加入外层复盘事务 | `changeStatus()` 的事务嵌套必须保持 Dexie 事务继承，不能脱离外层事务 |

不属于本次普通并发写入范围：

```text
BackupRepository.replaceData()
```

它是全库安全恢复操作，已有恢复锁定 / 确认流程是其排他边界。不得把本次单事项并发修复扩张为备份恢复协议重构；但不得削弱现有恢复锁定状态。

## 【一、冻结的最小实现方案】

### 1. 统一事务内 mutation helper

在 `IndexedDbItemRepository` 内部增加私有辅助能力（名称可等价）：

```ts
private async mutateCurrentItem<T>(
  id: string,
  tables: Dexie.Table[],
  operation: (item: Item) => Promise<T> | T,
): Promise<T>
```

或以更清晰、但等价的独立事务实现。关键不在抽象形式，而在每个命令都遵守下列顺序：

```text
开启 readwrite transaction
→ 在 transaction 内 database.items.get(id)
→ 校验当前事实
→ 以事务内最新 Item 为基底，仅合并本操作允许改变的字段
→ 写入
→ 如需要，同一 transaction 写状态事件
→ transaction 成功后返回
```

禁止在事务开始前调用 `getById()` 后，把其返回对象作为即将 `put()` 的基底。

### 2. `changeStatus()`

冻结顺序：

```text
transaction(rw, items, itemStatusEvents)
→ items.get(id)
→ 不存在或 deletedAt：事项不存在
→ assertTransition(current.status, targetStatus)
→ items.put({ ...current, status: targetStatus, updatedAt: now })
→ itemStatusEvents.add({
    itemId,
    fromStatus: current.status,
    toStatus: targetStatus,
    createdAt: now,
  })
→ 返回更新后的 Item
```

不变量：

- 状态事件的 `fromStatus` 必须来自事务内最新状态；
- 若 Item 写入或事件写入任一步失败，整个事务回滚；
- 不得为“并发成功”跳过 `assertTransition()`；
- 不得出现事件写入成功而 Item 状态未写入，或反之。

### 3. `updateContent()`

冻结顺序：

```text
transaction(rw, items)
→ items.get(id)
→ 不存在或 deletedAt：事项不存在
→ content.trim()
→ items.put({ ...current, content, updatedAt: now })
→ 返回更新后的 Item
```

当前 P0 修复先只保证不回滚状态、不覆盖 `deletedAt`。本操作的可写状态范围仍依赖产品正在评审的“补充说明可写状态范围扩展”结论：

- 在该产品范围正式冻结前，保留当前 `idea_to_try` 保护；
- 若后续批准全部未删除状态可写，只在**同一事务内**移除 `idea_to_try` 判断；
- 无论范围为何，回收站永远拒绝，且不允许 `updateContent()` 意外移除 `deletedAt`。

### 4. `delete()`

冻结顺序：

```text
transaction(rw, items)
→ items.get(id)
→ 不存在或已删除：保持现有幂等 no-op
→ items.put({ ...current, deletedAt: now, updatedAt: now })
→ 提交
```

这确保删除保留同一事务中已提交的最新 `content` 和 `status`，不会用过期快照回滚它们。

### 5. `restore()`

冻结顺序：

```text
transaction(rw, items)
→ items.get(id)
→ 不存在或 deletedAt 不存在：回收站中不存在该事项
→ 从事务内当前对象删除 deletedAt
→ items.put({ ...currentWithoutDeletedAt, updatedAt: now })
→ 返回恢复后的 Item
```

约束：

- 恢复不创建状态事件；
- 恢复不修改内容、状态、标题、关联或复盘；
- 恢复不会复活已被到期永久清理的事项；该情形已不存在 Item，稳定报“回收站中不存在该事项”。

### 6. `purgeDeletedBefore()`

现有多表永久清理已经在事务中执行。保留其事务边界，不将前置读取出的对象重新 `put()` 回 `items`。

与其他 Item mutation 的正确交互依赖 IndexedDB readwrite transaction 串行提交：普通 mutation 在自身事务内读取当前事实；永久清理在自身多表事务内删除事实。任何操作若在事务内读到 Item 不存在 / 已删除，必须按冻结错误语义结束，不得写回过期对象。

## 【二、数据可信边界】

本修复保证的是**同一 IndexedDB 数据库内的 Item 行级读改写不丢字段**：

```text
updateContent 与 changeStatus 并发
→ 内容以事务内最新 Item 合并
→ 状态以事务内最新 Item 合并
→ 状态事件与最终状态一致
```

不新增以下能力：

```text
跨设备同步冲突解决
多用户协作
用户可见的版本冲突提示
自动合并任意两个内容文本
写入重试 / 时间戳裁决
```

对于两个并发 `updateContent()`，最后一个事务提交的内容仍是最终内容；这符合当前“单用户、显式保存、无协作编辑”产品模型。关键是其不能回滚无关字段（状态、删除标记等）。

## 【三、Contracts / Application / Schema 影响】

| 边界 | 结论 |
|---|---|
| Contracts | 不涉及 |
| Application | 不涉及 |
| Repository | **必须修改：Item mutation 全部改为事务内读取与合成** |
| IndexedDB Schema | 不涉及 |
| Dexie Migration | 不涉及 |
| JSON 备份格式 / 版本 | 不涉及 |
| Item 状态机 | 不涉及；继续严格 `assertTransition()` |
| ItemStatusEvent 语义 | 不涉及；只强化其与状态写入的原子一致性 |
| 前端 | 当前冻结，修复和 QA 完成后再继续补充说明范围扩展 |

## 【四、最小自动化测试】

测试必须使用真实 IndexedDB / Dexie transaction 行为（现有 fake-indexeddb 测试环境可用），不得用前端 busy 模拟代替。

### 1. 内容与状态并发

至少对以下迁移分别构造并发：

```text
idea_to_try → doing
doing → paused
paused → doing
doing → waiting_review
```

每组断言：

```text
最终 Item.status === targetStatus
最终 Item.content === 本次内容更新值
ItemStatusEvent 恰好新增 1 条
事件 fromStatus / toStatus 与最终迁移一致
无 deletedAt 被意外写入或移除
```

测试应设计为能暴露旧实现的读后写覆盖窗口，而不是仅 `Promise.all()` 后碰巧按安全顺序执行。允许通过受控 Repository / Dexie hook 在读取后、写入前建立屏障；不得通过 `setTimeout` 作为正确性依据。

### 2. 内容与回收站交错

至少覆盖：

1. 内容保存事务先提交、删除后提交：
   - 事项保留最新内容；
   - `deletedAt` 存在；
   - 内容更新后不能意外复活事项；

2. 删除先提交、内容更新事务后读取：
   - 内容更新拒绝 `事项不存在`；
   - 不改变删除标记；
   - 不产生状态事件；

3. 回收站事项尝试更新：
   - 拒绝 `事项不存在`；
   - 不意外恢复；

4. 恢复与内容更新交错：
   - 恢复使用事务内最新对象；
   - 仅当内容更新发生在活跃时期并已提交时，恢复后的内容保留该值；
   - 内容更新如果读到已删除对象必须拒绝；
   - 不产生状态事件。

### 3. 事务回滚

- 注入 `itemStatusEvents.add()` 失败，确认状态写入随事务回滚；
- 注入 `items.put()` 失败，确认不新增状态事件；
- 内容更新失败时不改变 Item；
- 既有 `complete()` 复盘工作流在嵌套 `changeStatus()` 后仍保持全部或全无。

### 4. 全量回归

```text
状态机
回收站 / 30 天永久清理
备份导出恢复
方法应用
复盘形成 / 验证 / 修订
方法生命周期与墓碑
补充说明既有专项测试
```

并运行：

```bash
corepack pnpm -C Knowledge_Base typecheck
corepack pnpm -C Knowledge_Base test
corepack pnpm -C Knowledge_Base build:h5
git -C Knowledge_Base diff --check
```

## 【五、允许修改范围】

```text
packages/storage-indexeddb/src/index.ts
tests/** 或 packages/**/tests/**
docs/architecture/**
```

如仅 Repository 内部实现调整，`packages/contracts/**` 与 `packages/application/**` 不应修改。

明确禁止：

```text
apps/client/**
状态机规则
Schema / Dexie version / Migration
BackupDocument / BackupData
ItemStatusEvent 删除或语义改写
Review / Method / MethodApplication / MethodEvidence 规则
全局锁、全局状态库、自动重试、时间戳冲突裁决
```

## 【交付给研发的技术约束】

1. 不能只修 `updateContent()`；必须覆盖 `changeStatus()`、`delete()`、`restore()` 的事务内最新读取；
2. 不得在 transaction 外读取 Item 后，以该对象为 `put()` 基础；
3. `changeStatus()` 必须在 Item + ItemStatusEvent 的同一个事务内重新读取、校验、写入；
4. 不得放宽 `assertTransition()` 或删除状态事件以规避冲突；
5. 不得增加 Schema、Migration、备份字段或前端 busy 依赖；
6. 复盘工作流的嵌套事务语义必须保持原子；
7. 若 Dexie 嵌套 transaction 未能继承外层事务、或测试发现无法证明状态事件与 Item 原子一致，停止实施并上报架构师；
8. 通过专项自动化后必须先交 QA 定向复验；未验收前，前端不开放补充说明到其他状态。

## 【下一责任岗】

```text
Application / Repository 工程师：按本文修复 Item mutation 一致性并补并发测试
→ QA：P0 定向复验（并发、删除 / 恢复、事件原子性、全量回归）
→ 架构师：审阅修复证据与稳定性
→ 前端：恢复补充说明范围扩展的后续实施
→ QA：H5 人工 UAT
→ 产品经理：更新补充说明范围基线并封板
```
