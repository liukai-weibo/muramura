# SQLite 主库迁移 — S5 断裂可选版本来源补测裁决

> 状态：**S5 核心备份恢复能力有条件通过，但暂不封板、不得进入 S6；须完成本文件规定的一条 SQLite 恢复闭环补测。**
>
> 当前唯一运行主库仍是 IndexedDB；SQLite 仅是临时合成数据自动化中的候选数据层。
>
> 关联：`docs/architecture/SQLite主库迁移-S4稳定审阅与S5开工决策.md`。

## 【技术结论：有条件可行，P1 测试证据须在封板前补齐】

已确认的 S5 证据成立：

```text
v2 九集合恢复后的规范化等价
v1 缺失集合 / startAction 的兼容降级
非法文档在 Application 解析阶段拒绝且不覆盖 SQLite 基线
replaceData() 最后集合写入失败整体 rollback
system_metadata 与普通 BackupData 隔离
```

但 `tests/sqlite-s5.test.ts` 当前 v1 用例中，生成的历史 `MethodVersion.sourceReviewId` 实际仍为：

```text
sourceReviewId = 'review'
```

且 `review` 存在。它只能证明有效可选来源可恢复，**不能证明断裂可选来源会按既有兼容规则被保守清除**。

该规则影响备份恢复后历史版本来源的事实表达。若不补测，S5 不能称为“已证明 v1/v2 兼容恢复等价”。因此裁决为：**P1 补测是 S5 封板前必需项。**

## 【冻结的兼容语义】

`MethodVersion.sourceReviewId` 是可选历史来源，不是通过猜测恢复的字段。

```text
备份中 sourceReviewId 存在，且对应 Review 存在
→ 保留

备份中 sourceReviewId 存在，但对应 Review 不存在
→ parseAndValidate() 仅移除该字段
→ 不拒绝整份合法历史备份
→ 不猜测、替换或补建任何来源 Review
→ SQLite 恢复后继续保持 sourceReviewId 不存在
```

该受限归一化仅适用于 `MethodVersion.sourceReviewId`。不得扩展为对必填关系的宽松处理：

```text
MethodEvidence.reviewId
MethodEvidence.methodId
MethodApplication.itemId
MethodApplication.methodId
MethodApplication.methodVersion
ItemLink.sourceReviewId
ItemLink.targetItemId
```

上述必填关系断裂仍必须严格拒绝。

## 【唯一允许的补测】

在 `tests/sqlite-s5.test.ts` 或等价的 SQLite S5 定向测试中，新增或修正一个完整闭环场景：

```text
1. 构造合法 v1 或 v2 BackupDocument：
   - MethodVersion.methodId 指向存在的 Method；
   - MethodVersion.sourceReviewId = 'missing-review'；
   - 不创建 ID 为 missing-review 的 Review；
   - 其他必填引用全部合法。

2. 调用 BackupApplicationService.parseAndValidate()：
   - 不抛错；
   - parsed.data.methodVersions 对应记录不再有 sourceReviewId 属性。

3. 调用 restoreBackup(parsed) 写入新的临时 SQLite 文件。

4. 调用 SqliteBackupRepository.exportData()：
   - 对应 MethodVersion 仍不含 sourceReviewId；
   - Method、Version、Evidence、Application、Item、Review 等其余预期事实保持；
   - 不出现自动创建的 Review、伪造 sourceReviewId 或替代关联。
```

测试应同时断言一条必填关系断裂仍被拒绝，或保留现有 S5 非法输入覆盖作为同一冻结边界的证据。

## 【禁止事项】

本补测不得导致：

```text
修改 BackupDocument v1 / v2 格式
新增 Backup v3
新增 Schema / Migration
放宽任何必填引用的解析校验
在 SQLite Repository 中猜测或重建 sourceReviewId
修改前端、Application 运行入口、IndexedDB 主路径
开始 Local API、真实 JSON 导入、双写或主库切换
```

如果补测失败，允许修改范围仅限根因所在的：

```text
packages/application/src/index.ts（parseAndValidate 的既有兼容逻辑）
packages/storage-sqlite/src/backup-repository.ts（undefined / NULL 映射）
tests/sqlite-s5.test.ts
```

在未发现失败前，优先只修改测试，不得为“补齐测试”重构备份实现。

## 【验收与流转】

完成后至少执行：

```sh
corepack pnpm -C Knowledge_Base test --run tests/sqlite-s5.test.ts
corepack pnpm -C Knowledge_Base typecheck
corepack pnpm -C Knowledge_Base test
corepack pnpm -C Knowledge_Base build:h5
git -C Knowledge_Base diff --check
```

按项目规则，工程验证完成后，追加当天实际修改至：

```text
docs/daily-contributions/YYYY-MM-DD.md
```

通过后流转：

```text
数据 / Application / Repository 工程师
→ QA S5 定向复验
→ 架构师 S5 稳定审阅
→ 再决定是否批准 S6
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**允许，仅限上述断裂可选 `sourceReviewId` 的 S5 SQLite 闭环补测；测试暴露实现缺陷时，允许最小根因修复。**
