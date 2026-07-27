# MySQL 主库迁移 — M5-A 最终架构复审与 QA 定向复验授权

> 状态：**架构复审通过，授权流转 QA 定向复验；M5-A 尚未封板。**
>
> 此授权仅确认候选 loopback 只读 API 已满足进入 QA 的架构门，不授权 M5-B、M5-C、前端接入、业务写 API或运行主库切换。

## 【架构结论：通过】

M5-A 冻结的五条只读路由已具备定向真实 MySQL API Contract 证据：

```text
GET /health
GET /api/v1/search?query=
GET /api/v1/dashboard?window=7d|30d|all
GET /api/v1/methods
GET /api/v1/reviews/:id
```

Search 一致性读模型的 P0 修复持续成立：`MySqlSearchRepository.search()` 在单一 connection 中以 `REPEATABLE READ`、read-only consistent snapshot 读取 Item、Review、Method 和 MethodVersion。受控并发测试证明读取中由另一 app connection 提交的匹配 Review 不会污染当前查询，而新查询可看见已提交事实。

`/methods` 已证明只返回活跃 Method，不将回收站 Method 伪装为活跃记录；`/reviews/:id` 已证明存在 Review 的成功 DTO、缺失 Review 的 `404 NOT_FOUND` 和 MySQL 不可用的 `503 MYSQL_UNAVAILABLE` 保持明确区分。Search、Method 和 Review 的数据层连接失败均返回含 `requestId` 的脱敏错误 DTO，不会伪装为 `200 []`、`200 null`、空对象或业务不存在。

冻结路由之外的 API 请求仍受到只读边界保护：非 GET `/api/v1/**` 返回 `405 METHOD_NOT_ALLOWED`，未知 API 路由返回 `404 NOT_FOUND_ROUTE`。本轮仅新增测试证据，未修改 production code、路由矩阵或业务语义。

## 【已确认的运行边界】

```text
API 进程：apps/api
监听边界：loopback 候选 API（测试使用随机 loopback 端口）
生产启动目标：127.0.0.1:32146
CORS：精确允许 http://127.0.0.1:10086
业务数据：只读 MySQL 候选路径
浏览器：不获得 MySQL 凭据或连接信息
```

持续事实：

```text
IndexedDB = 当前唯一运行主库
MySQL     = 候选 Repository 与候选 loopback API 路径
SQLite    = 保留的实验 / 测试资产
```

## 【QA 定向复验范围】

QA 必须基于当前提交重新确认：

1. 路由集合严格等于冻结矩阵；不存在业务写、metadata、migration、表浏览或测试 API。
2. `/health` 的 ready、schema not ready、MySQL unavailable、脱敏、`no-store` 和诊断分类保持 M1 Contract。
3. Search 使用单连接 repeatable-read consistent snapshot；中途提交不形成跨对象混合结果；新查询能看到新提交事实。
4. Search、Dashboard、Methods、Review detail 的成功 DTO 与既有 Application Contract 一致；异常不伪装为空态、零统计、`null`、无关联或不存在。
5. `/methods` 不返回回收站 Method；`/reviews/:id` 正确区分真实缺失 `404 NOT_FOUND` 与数据库故障 `503 MYSQL_UNAVAILABLE`。
6. 五条路由均有 `Cache-Control: no-store`、服务端 `X-Request-Id`；失败 DTO 均不暴露 SQL、密码、连接串、host、stack 或驱动原文。
7. 精确 CORS、非 GET `405`、未知路由 `404`、body 上限和无 `.env` skip 行为保持有效。
8. 复验 M5-A 定向真实 MySQL、M1～M5-A 串行真实 MySQL、typecheck、全量 test、build:h5 与 `git diff --check`。

## 【QA 后流转】

QA 通过后，流转**产品经理**作 M5-A 封板裁决。产品封板前：

```text
M5-B 不得开始
M5-C 不得开始
不得宣称 M5 或 MySQL 主库迁移已完成
不得将 MySQL 表述为当前运行主库
```

## 【持续禁止事项】

```text
业务写 API
apps/client/** 或前端 HTTP Adapter
Application 运行组合切换
MySQL 单写运行验证
IndexedDB / MySQL 双写、同步、回填或真实迁移
MySQL 主库切换
浏览器直连 MySQL
Schema / Migration
BackupData / JSON / v1/v2 语义修改
远程监听、CORS wildcard、credentials、认证或多用户能力
```

## 【下一责任岗】

**QA。**

## 【是否允许写代码】

**否。** 当前只授权 QA 定向复验；未经产品 M5-A 封板与新的架构授权，任何研发不得开始 M5-B 或 M5-C。
