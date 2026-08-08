# Item Repository 并发一致性 P0 — 架构复审补充

> 日期：2026-07-21
> 结论：**常规写路径修复通过；P0 尚不可正式关闭，需补一处 `purgeDeletedBefore()` 事务内重检。**

## 【已确认通过】

以下四条常规 Item 写路径已按冻结方案实现事务内重新读取：

```text
changeStatus()
updateContent()
delete()
restore()
```

其中：

- `changeStatus()` 在同一 `rw(items, itemStatusEvents)` 事务内读取当前事项、校验状态机、写事项与写状态事件；
- `updateContent()` 在 `rw(items)` 事务内读取当前事项，仅合并 `content / updatedAt`，并继续严格限制为 `idea_to_try`；
- `delete()` 与 `restore()` 均在 `rw(items)` 事务内读取当前事实后更新；
- 复盘工作流仍通过嵌套 `changeStatus()` 维持外层全有或全无；
- QA 的内容—状态交错、删除 / 恢复保护与事件失败回滚测试均有效通过。

这些结果证明原本最主要的“旧内容保存回滚状态，导致事件与事项事实矛盾”问题已修复。

## 【发现的剩余 P0 窗口】

当前 `purgeDeletedBefore(cutoff)` 仍然按以下方式工作：

```text
事务外查询 deletedAt <= cutoff 的事项
→ 得到 expiredItemIds
→ 开启多表读写事务
→ 按事务外得到的 expiredItemIds 删除关联数据与事项
```

该路径会产生恢复—清理交错风险：

```text
T1: purge 在事务外读到 Item A 已过期且 deletedAt 存在
T2: restore(A) 在自己的事务内成功，移除 deletedAt
T1: purge 开始事务，仍按旧 expiredItemIds 删除 A
```

结果是：用户已成功恢复的事项可能被旧清理操作永久删除。这违反已冻结约束：

```text
恢复不能被旧操作抹掉
```

因此，不能仅因四条常规 mutation 已修复就宣告 Item Repository P0 完整关闭。

## 【最小补修方案】

将“发现过期事项”移动进现有 `purgeDeletedBefore()` 的同一个多表 `rw` 事务，并以事务内最新记录为唯一删除依据：

```text
transaction(rw, items, reviews, methods, ...)
→ 在 transaction 内查询 deletedAt <= cutoff 的 Item
→ 若为空，直接提交
→ 仅用事务内所得 expiredItemIds 删除关联数据与 Item
→ 提交
```

要求：

1. 不得继续在事务外计算并缓存 `expiredItems` / `expiredItemIds`；
2. 在事务内读到已恢复的事项（`deletedAt` 缺失）时，绝不清理它及其关联数据；
3. 保持现有事项、复盘、方法、墓碑引用完整性清理顺序不变；
4. 不增加 Schema、Migration、Contracts、Application、备份格式或前端锁；
5. 不用时间戳比较、重试或 UI busy 补救。

## 【必须新增自动化】

新增至少一项受控交错测试，证明旧实现会失败、新实现不会：

```text
准备一个已超过 30 天的回收站事项 A，并带有可验证关联数据
→ 让 purge 在“即将进入清理事务”前暂停
→ 在另一事务执行 restore(A)
→ 放行 purge
→ 断言：
  - A 仍存在；
  - A.deletedAt 不存在；
  - A 的 Review / ItemStatusEvent / MethodApplication 等关联未被清理；
  - 不产生额外状态事件；
  - 后续 list / backup / restore 均正常。
```

测试应使用受控事务同步点 / Repository hook，不能以 `setTimeout` 作为并发正确性证据。

还需保留并运行已通过的：

```text
内容 + 状态迁移并发
内容 + 删除 / 恢复
状态与事件失败原子性
completeReview() 全有或全无
全量 typecheck / test / build:h5 / diff --check
```

## 【修复后验收口径】

补修及专项测试通过后，才可正式写：

```text
Item Repository 并发读改写一致性 P0 已关闭。
```

在此之前，准确口径应为：

```text
常规 Item mutation 的旧快照覆盖已修复并通过定向测试；
到期清理与恢复交错仍待补齐事务内重检。
```

## 【允许修改范围】

```text
packages/storage-indexeddb/src/index.ts
tests/** 或 packages/**/tests/**
docs/architecture/**
```

禁止修改：

```text
apps/client/**
packages/contracts/**
packages/application/**
Schema / Migration
Backup 格式
状态机和状态事件语义
方法、复盘、证据关系
```

## 【下一责任岗】

```text
Application / Repository 工程师：将 purgeDeletedBefore 的过期筛选移入同一事务，并补恢复—清理交错测试
→ QA：仅复验该 P0 补修与全量回归
→ 架构师：确认 P0 正式关闭
→ 前端：再继续补充说明范围扩展
```
