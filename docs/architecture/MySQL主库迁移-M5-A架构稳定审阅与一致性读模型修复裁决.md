# MySQL 主库迁移 — M5-A 架构稳定审阅与一致性读模型修复裁决

> 状态：**有条件通过，暂不进入 QA 最终复验，M5-A 不得封板。**
>
> 本裁决确认产品已补齐 M5 立项和 M5-A 书面范围授权；此前实现的测试通过不得追溯为先前已获产品编码授权。当前仅允许完成本文冻结的最小一致性读模型修复，随后重新进行架构审阅与 QA 定向复验。

## 【架构结论：有条件通过】

M5-A 的产品范围、冻结路由矩阵、API 进程归属及基础运行边界成立：

```text
GET /health
GET /api/v1/search?query=
GET /api/v1/dashboard?window=7d|30d|all
GET /api/v1/methods
GET /api/v1/reviews/:id
```

现有 `apps/api` 已在 API 进程内组装 MySQL app pool、MySQL Repository 和既有 Application Service；路由未直接访问 SQL；无业务写路由；CORS 为精确 loopback H5 origin；错误 DTO、`requestId`、no-store 与健康检查脱敏方向符合 M5-A 冻结边界。

但 `MySqlSearchRepository.search()` 当前以 `pool.query()` 并发查询 `items`、`reviews`、`methods`、`method_versions`。这些查询可能被 pool 分配到不同连接，并在并发事务提交之间观察到不同快照。因此，它可能构造一个同一业务时点从未存在过的跨对象搜索读模型。

Search 是 M5-A 的可信只读读模型，不允许以跨连接混合快照满足 Contract。该问题是运行时数据可信性缺口，不是测试文案或性能优化项；在修复前不得将 M5-A 测试通过表述为满足最终稳定审阅。

`MySqlDashboardRepository.getSnapshot()` 已以单一 connection 的 read-only consistent snapshot 读取多表，方向正确。M5-A 路由矩阵中其他三个只读端点也在既有 Application / Repository 边界内，未发现范围扩张。

## 【已确认的边界】

继续有效：

```text
IndexedDB = 当前唯一运行主库
MySQL     = 候选 Repository 与候选 API 运行路径
SQLite    = 保留的实验 / 测试资产
```

并确认 M5-A 不包含：

```text
业务写 API
前端 HTTP Client / Adapter
apps/client/** 改动
Application 运行组合切换
MySQL 单写运行验证
真实历史迁移、双写、同步或回填
Schema / Migration
BackupData 语义改动
远程 / 公网 API、认证或多用户体系
```

## 【冻结的最小修复】

允许将 `MySqlSearchRepository.search()` 改为使用**单一 MySQL connection 的 read-only consistent snapshot**：

```text
getConnection
→ SET TRANSACTION READ ONLY
→ START TRANSACTION WITH CONSISTENT SNAPSHOT
→ 在同一 connection 内读取 items / reviews / methods / versions
→ COMMIT
→ 映射既有 SearchResult Contract
```

异常时：

```text
ROLLBACK（若事务已开始）
→ 明确抛出
→ API 映射为既有受控 MYSQL_UNAVAILABLE 错误 DTO
```

不得改变：

```text
SearchRepository Contract
搜索匹配、过滤、排序或历史版本排除语义
SearchResult DTO
API 路由矩阵
HTTP 错误语义
Dashboard 实现
Schema / Migration
前端或任何写能力
```

## 【必须新增的验证】

新增或补强 `tests/mysql-m5a.integration.test.ts` 中的真实 MySQL 证据：

1. `search()` 的多表读取明确使用同一 connection / 一致性快照；测试可通过测试专用 pool / connection spy，或在受控同步点插入并发写入，证明结果不会混合旧 / 新关系。
2. Search 的结果继续与 IndexedDB `SearchRepository` 的既有 Contract 等价：活跃 Item、Review、活跃 Method、历史 Version、当前 Version 去重、排序和空 query 语义均不变。
3. Search SQL / pool / connection 异常经 API 返回：

   ```text
   503
   MYSQL_UNAVAILABLE
   requestId
   脱敏 message
   ```

   绝不返回 `200 []`。
4. 既有 Dashboard consistent snapshot、冻结的五条 GET 路由、精确 CORS、no-store、错误 DTO、无业务写路由与 loopback 边界持续回归。

## 【允许修改的文件或层】

仅允许：

```text
packages/storage-mysql/src/read-model-repositories.ts
tests/mysql-m5a.integration.test.ts
docs/architecture/**
docs/daily-contributions/2026-07-23.md
```

若为了测试确实需要最小导出或测试类型调整，可额外修改：

```text
packages/storage-mysql/src/index.ts
```

但只限导出当前既有 read-model Repository；不得改变运行组合或业务能力。

## 【明确禁止事项】

```text
apps/api/** 路由扩张或业务语义改变
apps/client/**
packages/application/**
packages/contracts/**
migrations/**
业务写 API
前端 Adapter
MySQL / IndexedDB 双写、同步、回填或迁移
MySQL 主库切换
BackupData / JSON / v1/v2 语义修改
CORS wildcard、credentials、远程监听或公网暴露
新用户、认证、requestId 幂等或自动重试能力
```

## 【重新审阅与 QA 门】

完成最小修复后，研发不得自行宣称 M5-A 通过。必须按顺序：

```text
研发完成最小修复
→ 真实 MySQL M5-A 定向测试通过
→ M1～M4 回归 + M5-A 组合回归通过
→ typecheck / 全量 test / build:h5 / diff check
→ 架构复审
→ QA 定向复验
→ 产品经理 M5-A 封板裁决
```

在产品封板前：

```text
M5-B / M5-C 不得开始
MySQL 不得被表述为运行主库
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**有条件允许。** 仅限本文的 Search 一致性快照修复和对应真实 MySQL 测试；它是对已书面确认 M5-A 范围的可信性补正，不授权任何新范围。
