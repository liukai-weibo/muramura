# MySQL 主库迁移 — M3-B 前置测试基线同步裁决

> 状态：**授权最小测试基线同步；M3-B 暂不得封板、不得进入 M3-C。**
>
> IndexedDB 仍是唯一运行主库；MySQL 仍仅是开发与合成测试中的候选 Repository；SQLite 保留为实验 / 测试资产。

## 【架构结论：有条件可行】

M3-B 已授权将 M2-A 中“存在方法关联即安全拒绝”的临时保护，替换为经过单一 MySQL DML transaction 编排的跨对象永久清理。`tests/mysql-m2a.integration.test.ts` 中三条“关联即拒绝”的断言因此已不再表达当前冻结 Contract。

这三条失败不证明 M3-B 实现失效；它们是阶段升级后的历史测试基线漂移。M3-B 工程师未越权修改不在原授权范围内的 M2-A 测试文件，处理正确。

现授权数据 / Application / Repository 工程师仅同步该三条测试的预期与合成夹具，随后交 QA 执行 M1～M3-B 串行真实 MySQL 回归。组合回归未通过前，M3-B 不得封板，也不得开始 M3-C。

## 【允许修改的精确范围】

```text
tests/mysql-m2a.integration.test.ts
docs/daily-contributions/2026-07-23.md
```

只允许替换以下参数化测试的三种历史断言：

```text
application
evidence
version-source
```

原测试名称：

```text
safely rejects permanent cleanup with %s relation and leaves complete affected snapshots unchanged
```

原错误预期：

```text
MySQL 方法关联清理尚未实施
```

## 【新的冻结测试 Contract】

三条测试必须改为证明：对过期且已软删除的 Item，`MySqlItemRepository.purgeDeletedBefore()` 依据真实结构化关联完成跨对象永久清理，而非拒绝。

### Application 场景

测试夹具必须建立真实、可证明的：

```text
Method
→ MethodVersion
→ MethodApplication.itemId
```

并断言：

```text
Item、状态事件、ItemLink、Item 的 Review、MethodApplication 被删除；
若该 Method 已无剩余 Evidence 和 Application，则其 Version 与 Method 被删除；
相关 Tombstone 仅在该 Method 已无 Evidence 与 Application 时删除。
```

### Evidence 场景

测试夹具必须建立真实、可证明的：

```text
Item
→ Review
→ MethodEvidence.reviewId
→ Method
```

并断言：

```text
Item、状态事件、ItemLink、Review、MethodEvidence 被删除；
若关联 Method 无任何剩余 Evidence 与 Application，则 MethodVersion 与 Method 被删除；
不得遗留孤儿 Evidence、Version 或错误 Tombstone。
```

### Version-source 场景

测试夹具必须建立真实、可证明的：

```text
Item
→ Review
→ MethodVersion.sourceReviewId
→ Method
```

并至少覆盖方法仍有其他真实历史 Evidence 或 Application 的分支，断言：

```text
受删除 Review 的 sourceReviewId 被设为 NULL；
仍有历史事实的 Method 与 Version 保留；
Item、其 Review、状态事件和确定的 ItemLink 被删除；
不得删除不属于该 Item 清理范围的历史关系。
```

若需要补一条“无剩余历史事实”的正向分支，也只能作为上述三条替换测试的必要覆盖，不得扩张为 M3-B 新能力或修改其他测试文件。

## 【不可弱化的保护】

1. 断言必须检查清理后的真实数据库状态，不得只改 `rejects` 为 `resolves`。
2. 所有 Method、Version、Evidence、Application、Tombstone 与 Item / Review 的关联只能以现有结构化 ID / version 字段建立；不得通过标题、时间、文本、版本计数或相似性猜测。
3. 不得修改仍有效的 M2-A 原子性、状态事件、回收站、并发或无方法关联清理测试。
4. 不得修改 M3-B 实现以迎合旧测试；本任务仅同步测试基线。
5. 不得修改 migrations、Contracts、Application、前端、BackupData、JSON 语义、IndexedDB 或 SQLite 资产。
6. 不得修改 M2-B 中独立 Review 删除对 Evidence / `sourceReviewId` 方法关联的拒绝 Contract。

## 【验证与封板门】

完成同步后，必须显式加载 `.env`，以串行文件模式执行：

```sh
set -a && . Knowledge_Base/.env && set +a
corepack pnpm -C Knowledge_Base test --run --no-file-parallelism \
  tests/mysql-m1.integration.test.ts \
  tests/mysql-m2a.integration.test.ts \
  tests/mysql-m2b.integration.test.ts \
  tests/mysql-m3a.integration.test.ts \
  tests/mysql-m3b.integration.test.ts
```

串行模式仅用于避免多个随机临时 MySQL 预检库争用本地资源；不得增加测试超时、删除场景或降低断言强度。

同时执行：

```sh
corepack pnpm -C Knowledge_Base typecheck
corepack pnpm -C Knowledge_Base test
corepack pnpm -C Knowledge_Base build:h5
git -C Knowledge_Base diff --check
```

全部完成后流转 QA。QA 需验证：

- 三条旧 M2-A 拒绝断言已准确升级为 M3-B 跨对象清理 Contract；
- M1～M3-B 串行真实 MySQL 组合回归通过；
- M3-B 定向测试与全量工程回归通过；
- 未发生范围外改动。

QA 通过后回流架构师进行 M3-B 稳定审阅。未获该审阅前，M3-B 不得封板，M3-C 不得开始。

## 【下一责任岗】

**数据 / Application / Repository 工程师（仅执行测试基线同步）。**

## 【是否允许写代码】

**有条件允许。** 仅限本文所列测试文件与每日贡献记录；禁止继续扩展 M3-B 实现或预先实施 M3-C。
