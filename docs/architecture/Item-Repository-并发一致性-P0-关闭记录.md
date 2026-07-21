# Item Repository 并发读改写一致性 P0 — 关闭记录

> 关闭日期：2026-07-21
> 依据：P0 定向 QA 复验通过；全量测试 19 文件 / 72 项通过；typecheck、H5 build 与 diff 检查通过。
> 关联文档：
> - `Item-Repository-并发一致性-P0-技术评审与修复任务书.md`
> - `Item-Repository-并发一致性-P0-复审补充.md`

## 【技术结论：P0 已关闭】

架构复核确认：先前发现的最后一个恢复—清理交错窗口已修复。

`IndexedDbItemRepository.purgeDeletedBefore(cutoff)` 不再在事务外计算 `expiredItems` 或 `expiredItemIds`。过期筛选、关联清理与事项永久删除现在均处于同一个 IndexedDB 多表 `readwrite` transaction 内。

在“恢复先于 purge 清理事务提交”的受控交错中，purge 会在事务内重新读取到已恢复事项，此时该事项已无 `deletedAt`，不会被识别为过期，也不会删除其 Review、状态事件、方法应用或其他关联事实。

## 【已关闭的风险】

```text
事务外读取过期回收站事项
→ 用户在清理事务前成功恢复
→ 清理仍使用旧 ID 永久删除已恢复事项
```

该风险已由事务内过期筛选消除。

同时保持已通过的常规 Item mutation 不变量：

```text
changeStatus / updateContent / delete / restore
→ 每条路径在自身 readwrite transaction 内重新读取最新 Item
→ 只合并本操作允许修改的字段

changeStatus
→ Item 与 ItemStatusEvent 同一事务
→ fromStatus 取自事务内当前状态
→ 任一写入失败则整体回滚
```

## 【验证证据】

QA 已验证：

1. purge 的 `expiredItems` / `expiredItemIds` 仅在多表事务内创建与使用；
2. 受控 Promise 门闩下，恢复在 purge transaction 前提交后：
   - 事项仍存在；
   - `deletedAt` 已移除；
   - Review、ItemStatusEvent、MethodApplication 均保留；
   - 不产生额外状态事件；
3. 导出并恢复完整 JSON 后，事项、复盘和方法应用关系仍完整；
4. 内容—状态交错、删除 / 恢复、状态事件失败回滚、`completeReview()` 全有或全无继续通过；
5. 全量验证通过：19 个测试文件、72 项测试、typecheck、H5 build、`git diff --check`。

## 【数据可信边界】

本次关闭结论仅覆盖：

```text
同一 IndexedDB 数据库内
Item 的 changeStatus / updateContent / delete / restore
与 purgeDeletedBefore 的读改写、恢复—清理交错和状态事件原子性
```

不宣称新增以下能力：

```text
跨设备同步冲突解决
多用户协作编辑
两个并发内容草稿的文本合并
全库备份恢复与普通写入并发协议重构
```

对两个并发 `updateContent()`，当前仍是单用户显式保存模型下的最后提交内容为准；但不会再回滚无关字段，如状态或删除标记。

## 【恢复的后续流转】

P0 关闭后，先前被冻结的“补充说明可写状态范围扩展”可以回到产品澄清阶段，但当前稳定契约仍为：

```text
查看补充说明：所有状态可读
编辑补充说明：仅 idea_to_try 可写
回收站：只读
```

在产品未明确 `doing` 与 `archived_no_review` 的范围前，前端不得开放其他状态的编辑入口。

## 【下一责任岗】

```text
产品经理：确认补充说明可写范围是否覆盖全部八种未删除 ItemStatus
→ 架构师：确认 updateContent 最终写入守卫
→ Application / Repository：仅调整已冻结守卫并补测试
→ QA：范围扩展定向验收
→ 架构师：稳定契约审阅
→ 前端：开放对应状态编辑入口并执行 H5 UAT
```
