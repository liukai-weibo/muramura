# MySQL 主库迁移 — M5-A 一致性读模型修复复审与路由证据补齐裁决

> 状态：**Search 一致性修复复审通过；M5-A 暂不进入 QA 最终复验，须补齐冻结只读路由的定向 Contract 证据。**
>
> 本裁决不开放 M5-B / M5-C，不改变运行主库。IndexedDB 仍是唯一运行主库；MySQL 仍仅为候选 Repository 与候选 loopback API 路径；SQLite 保留为实验 / 测试资产。

## 【架构结论：有条件通过】

此前 Search 的跨连接混合快照风险已被正确修复。

`MySqlSearchRepository.search()` 现在：

```text
取得单一 connection
→ SET TRANSACTION ISOLATION LEVEL REPEATABLE READ
→ SET TRANSACTION READ ONLY
→ START TRANSACTION WITH CONSISTENT SNAPSHOT
→ 同一 connection 依次读取 items / reviews / methods / method_versions
→ COMMIT
```

事务开始后的异常会 rollback 并继续抛出。新增真实 MySQL 受控并发测试证明：在 Search 已读 `items` 后，由另一 app connection 提交的匹配 Review 不会出现在当前 Search 结果中；后续新发起的 Search 会看到该 Review。此证据覆盖了此前“混合快照”P0 缺口。

Search 连接失败经 API 返回 `503 MYSQL_UNAVAILABLE`、脱敏用户文案与 `requestId`，未退化为 `200 []`。这符合 M5-A 异常如实暴露规则。

但是，`docs/architecture/MySQL主库迁移-M5-A候选只读API路由矩阵.md` 已冻结五条只读路由，而当前 `tests/mysql-m5a.integration.test.ts` 的路由级成功路径只直接验证了：

```text
GET /health
GET /api/v1/search
GET /api/v1/dashboard
```

尚未对下列已冻结端点补齐成功、缺失与错误边界的定向 API Contract 证据：

```text
GET /api/v1/methods
GET /api/v1/reviews/:id
```

路由实现表面存在不等于验收证据成立。M5-A 是候选 API 运行路径验证，必须覆盖矩阵中每一条允许路由，才可进入 QA 最终复验和产品封板裁决。

## 【已确认通过的修复范围】

```text
MySqlSearchRepository 使用单一 connection
Search 使用 REPEATABLE READ + read-only consistent snapshot
中途关联 Review 提交不污染进行中的 Search
新 Search 可见已提交 Review
Search MySQL 不可用返回 503 MYSQL_UNAVAILABLE
既有 SearchResult Contract、搜索匹配、排序与历史版本语义未改变
Dashboard 未修改
apps/api 路由矩阵与业务语义未扩张
```

## 【冻结的最小证据补齐】

允许仅在 `tests/mysql-m5a.integration.test.ts` 补齐以下 API 级测试。

### 1. `GET /api/v1/methods`

必须使用真实 MySQL 合成数据验证：

```text
200
JSON Method[]
Cache-Control: no-store
X-Request-Id 存在
返回与 ReviewApplicationService.listMethods / MethodRepository.list 相同的活跃 Method Contract
回收站 Method 不伪装为活跃 Method
```

并验证 MySQL / pool 不可用时：

```text
503
MYSQL_UNAVAILABLE
脱敏 message
requestId
```

不得退化为：

```text
200 []
```

### 2. `GET /api/v1/reviews/:id`

必须验证：

```text
存在的真实 Review
→ 200 Review DTO
→ no-store 与 X-Request-Id

不存在的 Review ID
→ 404 NOT_FOUND
→ 稳定文案：复盘不存在
→ requestId
```

并验证 MySQL / pool 不可用时：

```text
503
MYSQL_UNAVAILABLE
脱敏 message
requestId
```

不得把数据层异常映射为 `404`、`200 null`、空对象或成功 DTO。

### 3. 路由矩阵完整性

定向测试必须显式断言 M5-A 仅允许：

```text
GET /health
GET /api/v1/search?query=
GET /api/v1/dashboard?window=7d|30d|all
GET /api/v1/methods
GET /api/v1/reviews/:id
```

并至少覆盖：

```text
非 GET 的 /api/v1/** → 405 METHOD_NOT_ALLOWED
未知 /api/v1/** → 404 NOT_FOUND_ROUTE
```

不得新增业务路由、测试路由、表浏览路由、metadata 路由、migration 路由或写 API。

## 【允许修改的文件】

```text
tests/mysql-m5a.integration.test.ts
docs/architecture/**
docs/daily-contributions/2026-07-23.md
```

不得修改 production code。当前一致性实现已经满足本轮 P0 修复目标；本裁决只补齐冻结路由的验收证据。

## 【明确禁止事项】

```text
apps/api/**
packages/storage-mysql/**
packages/application/**
packages/contracts/**
apps/client/**
migrations/**
业务写 API
前端 Adapter
MySQL 单写运行验证
IndexedDB / MySQL 双写、同步、回填或真实迁移
MySQL 主库切换
BackupData / JSON / v1/v2 语义修改
远程监听、CORS wildcard、credentials、认证或多用户能力
```

## 【重新审阅与 QA 门】

完成测试补齐后必须按顺序：

```text
测试基线补齐
→ M5-A 定向真实 MySQL 测试通过
→ M1～M4 + M5-A 串行真实 MySQL 回归通过
→ typecheck / 全量 test / build:h5 / diff check
→ 架构最终复审
→ QA 定向复验
→ 产品经理 M5-A 封板裁决
```

在产品封板前：

```text
M5-B / M5-C 不得开始
不得宣称 M5-A 已验收
不得将 MySQL 表述为运行主库
```

## 【下一责任岗】

**数据 / Application / Repository 工程师（仅补齐测试证据）。**

## 【是否允许写代码】

**有条件允许。** 仅允许修改 `tests/mysql-m5a.integration.test.ts` 与必要文档记录；不授权任何生产代码、路由或范围变更。
