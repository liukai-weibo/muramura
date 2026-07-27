# MySQL 主库迁移 — M2-B 稳定审阅与 IndexedDB 状态历史 P1 分流裁决

> 状态：**M2-B 有条件通过，暂不封板。IndexedDB 状态历史排序 P1 必须独立修复并完成全量回归后，才可封板。**
>
> IndexedDB 仍为唯一运行主库；MySQL 仍只是候选 Repository 与合成测试存储。

## 【架构结论：有条件通过】

M2-B 的冻结范围已经完成稳定审阅：Review 基础持久化、关联删除安全拒绝、`002_add_system_metadata.sql`、BackupData 九集合导出与单一 DML transaction 替换、非法备份零写入、末端失败回滚和 metadata 隔离均与 M2 任务书一致。

但常规全量测试曾在 `tests/sprint-eleven.test.ts` 暴露 IndexedDB 单事项状态历史排序错误。该路径是当前唯一运行主库的一部分，不能因 MySQL 定向测试通过而忽略。

本次单独运行该测试可能通过，不改变结论：这属于时间戳碰撞时的非确定性 P1，而非已被消除的问题。

## 【M2-B 是否封板】

**否，暂不封板。**

M2-B 的候选 MySQL 范围可视为审阅通过，但以下条件未满足前不得描述为 M2-B 封板：

```text
IndexedDB 状态历史排序 P1 已修复
→ 定向测试稳定通过
→ 常规全量 test 通过且无跳过的 MySQL 集成验收已留存
→ QA 对 P1 回归及 M2-B 重新确认
```

在此之前：

```text
不得进入 M3 或任何 MySQL 下一阶段
不得开始 Application 运行组合、业务 HTTP API、前端切换、真实迁移、双写或主库切换
```

## 【P1 分流裁决】

**是。** IndexedDB 状态历史排序 P1 独立立项，流转给数据 / Application / Repository 工程师做最小修复。

问题根因：当前 `IndexedDbItemRepository.listStatusEvents()` 只按 `createdAt` 排序。连续状态操作可处于同一毫秒，`createdAt` 相同不能表达发生先后；存储层在相同排序键下的返回顺序不可作为业务历史顺序的可信依据。

不得以“本次重跑通过”或按随机 ID 二次排序来掩盖问题。随机 ID 能提供确定性，但不能证明真实发生顺序。

## 【P1 最小允许修改层】

```text
packages/storage-indexeddb/src/index.ts
tests/sprint-eleven.test.ts
必要时新增：tests/indexeddb-item-status-history*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

禁止修改：

```text
packages/contracts/**
packages/application/**
apps/client/**
packages/storage-mysql/**
migrations/**
BackupData / JSON 格式
现有业务状态机语义
```

## 【稳定排序契约与实现约束】

需修复的不是展示排序，而是**状态事件发生顺序的持久化事实**。

冻结规则：

1. 对同一 Item，新写入的 `ItemStatusEvent.createdAt` 必须严格晚于该 Item 已有最后一条状态事件的 `createdAt`。
2. 若物理当前时间不晚于最后事件时间，Repository 必须为新事件分配“最后事件时间 + 1ms”的 UTC ISO 时间；不得依赖随机 ID 或数据库返回顺序打破同毫秒并列。
3. 初始创建事件与后续迁移均遵守该规则；Item 的 `updatedAt` 可等于或晚于对应事件时间，但不得让后续状态事件回退。
4. `listStatusEvents(itemId)` 继续按 `createdAt ASC` 返回；可加 ID 作为仅防损坏历史数据的确定性次级排序，但它不能替代新事件的单调时间分配。
5. 既有备份中的历史同毫秒事件不伪造重写、不新增 Contract 字段；恢复后以稳定次级排序展示即可。P1 只保证新写入状态历史的可信发生顺序。
6. 修复必须保持 `create`、`changeStatus`、`startExecution` 中 Item 与事件的原子事务边界；不得拆分写入或引入全局状态。

## 【P1 必测场景】

1. 对单一 Item 连续执行：

   ```text
   create
   → doing
   → paused
   → doing
   ```

   连续多次运行，历史都严格按发生顺序返回。

2. 使用受控时间或测试 hook 强制每次真实 `Date` 落在同一毫秒，仍按上述顺序返回。
3. 不同 Item 的事件互不影响；一个 Item 的单调时间分配不得改变另一 Item 的事件。
4. 通过 `BackupApplicationService` 导出并恢复含同毫秒历史的旧备份：不改写原事件、不破坏九集合备份兼容；读取顺序稳定。
5. 既有 `Sprint 11` 状态历史测试、IndexedDB 全量回归、MySQL M1/M2-A/M2-B 集成和工程验证均通过。

## 【M2-B 范围确认】

待 P1 修复后，M2-B 需要保留的已审阅结论：

- 临时 migrator 仅有冻结的目标库 DDL / DML 权限，未使用 `ALL PRIVILEGES` 或全局 `*.*` 权限；
- Review 删除遇 `MethodEvidence.reviewId` 或 `MethodVersion.sourceReviewId` 关联时，统一以 `复盘存在方法关联，暂不能删除` 安全拒绝并零副作用；
- `002_add_system_metadata.sql` 仅新增私有 metadata 表；
- `replaceData()` 只以 app 身份、单一 DML transaction 使用 `DELETE + INSERT`，不使用 `TRUNCATE` 或 `FOREIGN_KEY_CHECKS`；
- metadata 不属于业务备份，也不受导出或替换影响。

## 【下一责任岗】

**数据 / Application / Repository 工程师：仅处理 IndexedDB 状态历史排序 P1。**

修复完成后：

```text
数据 / Application / Repository 工程师
→ QA：P1 + M2-B 定向回归
→ 架构师：M2-B 最终封板判断
```

## 【是否允许写代码】

**允许，仅限上述 IndexedDB P1 最小修复范围。**
