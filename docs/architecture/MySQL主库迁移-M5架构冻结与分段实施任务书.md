# MySQL 主库迁移 — M5 架构冻结与分段实施任务书

> 状态：**架构冻结完成。当前不授权编码；产品确认后只能从 M5-A 开始串行实施。**
>
> M5 是“本地运行时 API 接入与前端单写切换准备”，不是 MySQL 正式主库切换、真实历史迁移、双写或多用户服务化。

## 【技术结论：有条件可行】

M5 可在不修改既有业务 Contracts、Schema 或 BackupData 语义的前提下实施。本地运行时目标为：

```text
Browser H5
→ loopback Node API (127.0.0.1:32146)
→ Application Services
→ MySQL Repositories
→ local Docker MySQL
```

现有 `apps/api` 已具备 Node `http`、MySQL pool、脱敏 `/health` 与 loopback 启动骨架，可作为唯一 M5 API 进程归属。现有前端 IndexedDB 依赖集中在 `apps/client/src/pages/index/index.tsx` 的 Repository / Application Service 组装点，具备替换为 API adapter 的最小改造入口。

但 M5 不是“给已有 MySQL Repository 套 HTTP”。当前 MySQL 已覆盖 Item、Review、Method、MethodApplication、Backup 与 ReviewWorkflow；**尚未存在 MySQL `SearchRepository` 与 `DashboardRepository`**，而工作台当前依赖搜索、仪表盘、回收站聚合读模型。因此必须先补齐这些只读候选 Repository / Application 组合，才能声明“当前工作台实际需要的最小业务 API”完整。不得以返回空数组、隐藏模块或由前端猜关系取代缺失读模型。

M5 严格串行：

```text
M5-A：Node API 运行组合、只读读模型与健康 / 错误契约
→ QA + 架构审阅
→ M5-B：业务写 API、前端 API Adapter、MySQL 单写切换准备
→ QA + 架构审阅
→ M5-C：空 MySQL 端到端闭环、重启与 BackupData 恢复 UAT
→ QA + 产品验收 + 架构封板
```

M5 完成不等于 MySQL 成为正式唯一运行主库；M6 才可在新的独立授权下讨论正式切换、启动恢复和完整 UAT。

持续事实：

```text
IndexedDB = 当前唯一运行主库
MySQL     = M5 开发与受控单写验证环境中的候选运行源
SQLite    = 保留的实验 / 测试资产
```

在 M5-C 的受控验证环境中，**新业务写入只进入 MySQL**；不得与 IndexedDB 双写、同步或回填。当前运行默认路径在 M5 最终封板前仍不得被表述为已切换。

## 【现有能力与 M5 缺口】

### 可复用能力

```text
apps/api
→ Node http server
→ 127.0.0.1:32146 loopback 启动
→ MySQL pool
→ GET /health、no-store、MYSQL_SCHEMA_NOT_READY / MYSQL_UNAVAILABLE 脱敏分类

packages/application
→ Item、Review、Method、MethodApplication、Trash、Backup、Search、Dashboard Services

packages/storage-mysql
→ Item / Review / Method / MethodApplication / Backup Repositories
→ ReviewWorkflowRepository 完整候选实现
→ M1～M4 已验证事务、清理、备份恢复语义

apps/client
→ 现有服务组装集中于 IndexPage
→ 请求状态、草稿、确认层和刷新入口已有局部状态边界
```

### M5 缺口

```text
MySQL SearchRepository
MySQL DashboardRepository
MySQL 运行时 Repository composition root
Application Services 的 MySQL 依赖注入（仅 API 进程）
业务 API 路由、请求解码、响应 DTO、错误映射与 body 限制
前端 HTTP transport / API Adapter
前端加载、刷新、取消、旧读响应防覆盖与未知提交结果状态
API 与 H5 的本地开发启动 / origin 配置
端到端空库、进程重启、MySQL 重启和备份恢复验收
```

## 【运行时架构与依赖注入边界】

### 进程边界

```text
apps/api
  ├─ HTTP transport：解析、校验、状态码、requestId、错误 DTO
  ├─ M5 composition root：从 env 建 MySQL app pool
  ├─ MySQL Repository 实例
  └─ 既有 Application Services

apps/client
  ├─ HTTP API Adapter（实现前端所需 service-shaped port）
  ├─ 页面局部 UI state、草稿、抽屉、确认与请求状态
  └─ 不再 import Dexie / storage-indexeddb / MySQL / Node
```

`apps/api` 是 M5 唯一 API 目录；不得新建第二个业务服务，也不得复用 `apps/local-api` 的 SQLite 候选路径。`apps/local-api` 与 SQLite 实验资产保持不变。

### Application 与 HTTP 的隔离

- 既有 `packages/application/**` 与 `packages/contracts/**` 保持业务语义与对象定义；
- HTTP 路由只能调用 Application Service，或对缺失只读 MySQL Repository 的最小 Application 组合调用；路由不得直接读写 SQL 表；
- API request / response DTO 可由 Contract 对象承载，但 HTTP 状态码、诊断 ID、requestId、timeout / transport 信息不得泄漏进业务 Contract；
- 前端 Adapter 只能处理 transport、DTO 解码、错误转换和取消；不得在浏览器侧重建业务状态机、事务、关系推断或 BackupData 校验；
- 所有 Repository 均在 API 进程构造，并使用 app 用户 pool；浏览器永不获得 MySQL 配置或凭据。

### MySQL 只读缺口的最小实现

M5-A 可新增 `MySqlSearchRepository` 与 `MySqlDashboardRepository`，只实现既有 `SearchRepository` / `DashboardRepository` Contract 所需查询：

```text
SearchRepository.search(query)
DashboardRepository.getSnapshot()
```

要求：

- Search / Dashboard 返回当前 Contract 的结构化读模型，不新增指标、筛选或搜索语义；
- 只读查询使用一致性 snapshot；Dashboard 多表读取必须为单一 read-only consistent snapshot；
- Method、Version、Evidence、Application、Tombstone、Item、Review 关系只由结构化 ID / version 解释；
- 任何 MySQL 失败必须抛出，不得返回空搜索结果、零指标或“暂无数据”；
- 若现有 Contract 无法仅凭既有 Schema 可信实现，停止并回流架构评审，不得让前端拼 SQL 关系。

## 【API 契约与错误语义】

### API 前缀与通用响应

所有业务路由位于 `/api/v1`；`GET /health` 保持现有独立健康检查路径。所有 JSON 响应：

```http
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Request-Id: <server-generated-id>
```

每次请求生成不含用户数据的 `requestId`。业务成功响应直接返回稳定 Contract DTO；业务失败统一为：

```ts
{
  error: {
    code: string
    message: string
    requestId: string
  }
}
```

不得在响应中包含 SQL、host、port、database、用户名、堆栈、原始驱动错误、备份内容或 `system_metadata`。

### 健康检查

```text
GET /health
200 { status: 'ready', database, schemaVersion }
503 { status: 'database-unavailable', diagnosticId, message }
```

保持 M1 已冻结的脱敏和 `MYSQL_SCHEMA_NOT_READY` / `MYSQL_UNAVAILABLE` 分类；健康检查不显示业务数据，不接受写入，也不替代业务 API 可用性验收。

### 最小业务资源路由

按现有工作台真实调用映射，M5 API 只允许以下资源与操作：

| 领域 | 最小路由族 | Application / Contract 来源 |
|---|---|---|
| Item | list、get、create、updateContent、changeStatus、startExecution、delete、restore、list events | `ItemApplicationService` / `ItemRepository` |
| Review / workflow | get review、get review by Item、completeReview | `ReviewApplicationService` / `ReviewWorkflowRepository` |
| Method | list、list deleted、moveToTrash、restore、versions、evidence details、by review | `ReviewApplicationService` / `MethodLifecycleApplicationService` |
| Method application | create action Item、context / source display batch | `MethodApplicationService` |
| Trash | list entries、restore entry | `TrashApplicationService` |
| Search | query | `SearchApplicationService` |
| Dashboard | report window | `DashboardApplicationService` |
| Backup | export、parse + restore confirmation payload、restore | `BackupApplicationService` |

路由设计必须在 M5-A 形成 `docs/architecture` 中可审阅的 route matrix，逐项记录：

```text
HTTP method / path
request DTO 与最大 body size
success status / response DTO
调用的 Application method
业务校验失败 code
not-found / conflict code
MySQL unavailable code
是否写请求
前端未知提交策略
```

不得为内部 Repository 每个方法机械暴露路由；不得暴露 SQL、pool、migration、metadata、purge、test hook 或任意表浏览接口。

### 最小错误分类

| 类型 | HTTP | 语义 |
|---|---:|---|
| `VALIDATION_FAILED` | 400 | 已有输入校验错误，保留稳定用户文案。 |
| `NOT_FOUND` | 404 | Item / Method / Review 等已确认不存在或不可用。 |
| `CONFLICT` | 409 | 已完成 Review、非法状态迁移、唯一约束竞争等可确定业务冲突。 |
| `REQUEST_TOO_LARGE` | 413 | 超出冻结 JSON / 备份 body 限制。 |
| `METHOD_NOT_ALLOWED` | 405 | 不允许的 HTTP 方法。 |
| `NOT_FOUND_ROUTE` | 404 | 不存在的 API 路由。 |
| `MYSQL_SCHEMA_NOT_READY` | 503 | Schema 未达到已冻结运行门槛。 |
| `MYSQL_UNAVAILABLE` | 503 | pool、连接、MySQL 不可用或不可恢复驱动错误。 |
| `REQUEST_CANCELLED` | 无服务端成功 DTO | 客户端中止只停止等待；服务端不得承诺未执行。 |
| `INTERNAL_ERROR` | 500 | 未分类错误，脱敏并携带 requestId。 |

**未知提交结果**不是业务成功或失败码。对写请求发生浏览器 abort、连接中断或 client timeout 时，前端必须标记为 `unknown-outcome`，禁止自动重试；只允许用户主动“重新读取真实状态”。API 不提供伪造的“操作已取消”成功响应。

### 请求输入与 body 保护

- 只接受 `application/json`，拒绝未知 content type；
- 在读取 body 前施加固定、文档化上限：普通业务 JSON `64 KiB`，备份 restore JSON `16 MiB`；超过立即 413 并断开读取；
- JSON 解析失败为 400，不进入 Application；
- 备份 restore 必须先走既有 `BackupApplicationService.parseAndValidate()`，失败时绝不执行 `replaceData()`；
- CORS 预检只能允许冻结的 H5 开发 origin 与方法 / headers，不能使用 `*` 与 credential；生产本地静态同源时不依赖 CORS。

## 【前端 Adapter 与状态隔离策略】

### 组装替换

前端不得继续：

```text
import createIndexedDbRepository
import @knowledge-base/storage-indexeddb
直接创建 Dexie database
直接关闭 Dexie database
```

替换为一个局部 `api-client` / adapter composition root，为页面提供与现有调用所需形状一致的异步 port。Adapter 可以调用 HTTP，不得持有业务数据真相或在 localStorage / IndexedDB 缓存中充当第二写库。

允许保留：

```text
页面草稿
展开 / 选中状态
确认层
loading / submitting / error / unknown-outcome UI state
纯 UI 搜索展开状态
```

禁止保留：

```text
业务 Item / Review / Method 的本地持久化镜像
离线写队列
后台重试
IndexedDB 回填
从旧 IndexedDB 与 API 合并数据
```

### 读取、刷新与旧响应保护

1. 每个可取消读取请求使用 `AbortController`；页面卸载、搜索关键词变化、模块切换或新一次刷新时取消旧读取。
2. 每类异步读取维护递增 request sequence；只有最新 request 可以更新对应 UI state，旧响应必须被丢弃。
3. `refresh()` 必须在成功写请求后重新读取服务器事实；不得以客户端乐观拼装替代结构化读模型。
4. 读取失败必须展示“本地服务或数据暂不可用，可重新获取”，保留用户草稿与当前可见旧数据，但不得把旧数据标成最新。
5. API 返回 503 时应进入明确不可用状态，不展示空列表 / 零统计 / “没有关联”作为替代。

### 写入、取消与未知结果

1. 写请求提交后进入 `submitting`，同一交互入口禁用重复提交。
2. 业务 400 / 404 / 409 显示 API 的稳定业务文案，并保持输入草稿；不自动重试。
3. 客户端 timeout、Abort、页面关闭、网络失败或响应无法确认时，标记 `unknown-outcome`：

```text
本次提交结果未确认，未自动重试。
请重新获取真实数据后确认是否已生效。
```

4. “重新获取”只能执行读请求并根据事实恢复 UI；不得二次提交原请求。
5. 既有 `completeReview()` 无 requestId / idempotency key；M5 不引入请求去重、写入重试或未知结果查询 API。

## 【本地访问、安全与配置边界】

### Loopback 与 CORS

API 进程必须只监听：

```text
host = 127.0.0.1
port = 32146
```

拒绝 `0.0.0.0`、`localhost` 以外别名配置、IPv6 wildcard、可配置公网 host 和反向代理暴露。启动时对 host / port 进行 fail-fast 校验。M5 不提供 TLS、登录、Cookie、JWT、RBAC 或远程访问，因为其冻结使用模型为本机单人受信任。

H5 开发 CORS 仅允许：

```text
http://127.0.0.1:10086
```

若开发环境确需 `localhost:10086`，必须作为明确、精确允许项加入配置与测试，不得使用 origin wildcard。只允许 `GET, POST, PATCH, DELETE, OPTIONS` 和 `content-type, x-request-id`；不得使用 credentials。

### 配置与凭据

- MySQL host / port / database / app 用户密码仅由 `apps/api` 进程环境读取；
- `MYSQL_MIGRATOR_*` 不得被 API 进程读取、导出或用于业务请求；
- 前端只允许得到编译期 API base URL，如 `TARO_APP_API_BASE_URL`，不得含任意 MySQL 或 secret；
- `.env`、日志、错误 DTO、构建产物、备份下载、浏览器 DevTools 响应均不得泄漏密码或连接串；
- API 关闭必须 drain / close app pool；不得在每个 request 创建 pool。

## 【数据单写、未知提交与恢复策略】

M5-B / M5-C 的受控运行验证环境内：

```text
业务读取 = API → MySQL
业务写入 = API → MySQL
IndexedDB = 不读、不写、不迁移、不删除
```

这不是双写。IndexedDB 仅作为原运行资产和测试资产保留，不能与 MySQL 数据做合并展示、自动同步或回填。

前端启动前应先读取 `/health`。未 ready 时不得初始化业务读写 adapter；显示可重试的本地服务不可用状态。健康 ready 后业务 API 仍可能失败，必须独立处理，不得把 health 视为事务成功担保。

备份恢复在 API 内复用：

```text
BackupApplicationService.createBackup
parseAndValidate
restoreBackupSafely
MySqlBackupRepository.replaceData
```

`system_metadata` 永不通过业务端点导出、读取、修改或恢复。恢复确认 UI 必须先下载当前 MySQL 的安全 JSON 备份，再提交 restore；安全备份下载失败时，不得调用 restore。

## 【Schema / Migration 判断】

**M5 当前不授权任何 Schema / Migration。**

M5 所需 API、组合、只读查询、HTTP DTO、错误分类、前端 adapter 与运行验证均可建立在 M1～M4 已封板 Schema 上。不得添加 API session 表、request dedup 表、outbox、同步状态、用户表、token 表或运行标记字段。

若实施中发现 MySQL 无法可信提供既有 Search / Dashboard Contract，或运行单写验证需要 Schema 改变，必须停止并提交独立架构评审：明确产品必要性、最小 DDL、数据兼容、回滚 / 前向修复、权限与测试策略。未获新裁决不得创建 migration。

## 【M5 分段实施任务书】

### M5-A：API 运行组合、健康 / 错误契约与只读读模型

允许：

```text
apps/api 的 MySQL application composition root
MySqlSearchRepository / MySqlDashboardRepository（仅既有 Contract）
GET /health 保持与回归
只读业务 API 路由
路由矩阵、错误 DTO、body parser、loopback / CORS 配置
API 单元与真实 MySQL 集成测试
```

必须：

- API 只绑定 `127.0.0.1:32146`；
- app pool + MySQL Repositories + 既有 Application Services 只在 API 内组装；
- 不改变客户端，不写业务数据，不启用运行单写；
- 补齐 Search / Dashboard 的结构化可信读模型，不能返回假空态；
- 覆盖 API / MySQL unavailable、schema not ready、非法 JSON、body 超限、origin 拒绝、未知路由 / 方法、错误脱敏；
- 真实 MySQL 只读路由与 M1～M4 回归通过。

**退出门：** QA 验证所有只读 API 与既有 IndexedDB / Contract 结果等价、错误分类与 loopback 边界可靠，架构审阅通过后才可 M5-B。

### M5-B：写 API 与前端 HTTP Adapter 的单写切换准备

允许：

```text
既有业务写 API 路由
apps/client 的 HTTP client / API adapter
从页面移除 storage-indexeddb / Dexie 业务组装
加载、失败、刷新、submitting、unknown-outcome UI 状态
API / 前端自动化和 H5 人工验收
```

必须：

- 客户端全部业务读取与写入走 API；禁止 IndexedDB fallback、双写、缓存写队列与回填；
- 前端 adapter 不改变 Application / Contract 业务语义；
- 写 API 只调用已封板 Application / Repository 能力，尤其完整 ReviewWorkflow 必须通过 MySQL Application 组合；
- API 业务错误、503、超时 / abort、旧读响应与未知提交结果按本文冻结语义呈现；
- 保持草稿；未知提交结果禁止自动重试，必须重新读取；
- 不实施真实历史数据迁移。

**退出门：** 空 MySQL 下前端通过 API 完成当前业务闭环，且自动化 API / Adapter 测试和 H5 人工验收均通过；QA + 架构审阅后才可 M5-C。

### M5-C：受控单写端到端验证、重启与备份恢复

允许：

```text
端到端测试、H5 验收脚本 / 文档
API 进程重启与 MySQL Docker 重启验证
MySQL 单写验证环境的 JSON 备份 / 安全恢复验证
运行日志脱敏与最小诊断改进
```

必须：

- 从空 MySQL 通过 API / H5 完成事项、状态流转、完整复盘、方法、派生事项、方法应用、搜索、删除 / 恢复、JSON 备份恢复；
- API 重启及 MySQL 容器重启后，所有已提交数据、结构化关系与 API 读取正确；
- MySQL 不可用、API 不可达、恢复失败和未知提交结果均有用户可见、非假成功的降级；
- IndexedDB 不读、不写、不迁移、不删除；
- 受控验证环境的所有写入只进入 MySQL；
- 恢复前安全备份、恢复后事实核验和 `system_metadata` 隔离均通过。

**退出门：** 自动化、H5 UAT、重启、恢复、单写检查和安全边界全部通过；QA、产品和架构共同验收后 M5 才可封板。M5 封板仍不授权 M6。

## 【自动化测试矩阵与验收门】

| 维度 | 必测证据 |
|---|---|
| API startup | 仅 `127.0.0.1:32146` 可监听；错误 host / port fail-fast；pool 生命周期正确关闭。 |
| Health | ready、schema not ready、MySQL unavailable、no-store、脱敏，无业务数据泄漏。 |
| HTTP transport | JSON 解析、body 上限、content type、404、405、OPTIONS、精确 CORS origin、requestId、错误 DTO。 |
| Read model | Item / Review / Method / Version / Evidence / Application / Trash / Search / Dashboard 与既有 Contract 等价；MySQL 故障不伪装空态。 |
| Write API | Item、状态、内容、回收站、方法应用、completeReview、backup restore 调用 Application / 既有事务边界；业务冲突与 503 分类。 |
| Adapter | 不 import IndexedDB；最新读响应胜出；abort 不覆盖新状态；loading / error / retry / draft 保留。 |
| Unknown outcome | 写请求连接中断 / abort 后禁用自动重试；只允许刷新读取事实；不能伪造成功或失败。 |
| Single write | H5 API 路径所有写入仅 MySQL；IndexedDB 无新业务写、无回填、无同步。 |
| E2E | 空库完成封板闭环；API / MySQL 重启后关系与读取正确。 |
| Backup | export、安全备份、restore、恢复失败、v1/v2、metadata 隔离与 M4 完整关系等价。 |
| Regression | M1～M4 MySQL 集成、M5 API / Adapter、typecheck、full test、build:h5、diff check。 |

H5 人工验收必须在浏览器开发工具中确认：业务请求只发向 `127.0.0.1:32146`，不含 MySQL secret；API / MySQL 不可用时不展示空态；未知结果后需刷新而非自动重发；本地 IndexedDB 无新增业务对象写入。

## 【允许修改的文件或层】

### M5-A 初始授权范围（产品确认后）

```text
apps/api/**
packages/storage-mysql/src/search-repository.ts（可新增）
packages/storage-mysql/src/dashboard-repository.ts（可新增）
packages/storage-mysql/src/index.ts（仅导出 / API 组合必要修改）
tests/api-m5a*.test.ts 或 tests/mysql-m5a*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
package.json / apps/api/package.json
  （仅 API 启动、测试或已有 workspace 依赖所必需的最小脚本 / 依赖）
```

### M5-B / M5-C

仅在前一切片 QA + 架构审阅通过后，另行书面授权必要范围。M5-B 才可能允许：

```text
apps/client/**
apps/api/**
tests/api-m5b*.test.ts、tests/client-m5b*.test.ts 或等价新增测试
```

不允许改动 `packages/contracts/**`、`migrations/**`、`packages/application/**`，除非新的独立评审明确授权。

## 【明确禁止事项】

```text
真实 IndexedDB 历史数据迁移
IndexedDB / MySQL 双写、同步、回填或合并展示
MySQL 主库正式切换
浏览器直连 MySQL
公网 / 局域网 / 远程 API 访问
0.0.0.0、反向代理、隧道或端口转发暴露
多用户、注册、登录、JWT、Cookie Session、RBAC
Kubernetes、云端同步、远程访问或协作
新增业务对象、字段或业务语义
修改 Contracts
新增 / 修改 Schema migration
修改 BackupData format、version、v1/v2 语义
暴露 system_metadata、SQL、MySQL 凭据、migration 或 test hook
离线写队列、后台自动重试、requestId / 幂等键偷渡
删除或改造 SQLite 实验资产
```

## 【风险与保护策略】

1. **M5 的风险从数据层转向运行边界。** 候选 Repository 已证明事务可信，不代表 HTTP、浏览器取消、未知提交、CORS 和进程重启天然可信；必须独立测试。
2. **单写优先于兼容幻觉。** 受控 M5 环境一旦使用 API，业务真相只在 MySQL；不允许拿 IndexedDB fallback 掩盖 API 故障。
3. **未知提交必须诚实。** 无幂等 Contract 下，任何网络不确定性都只能刷新确认，自动重试会把“至多一次复盘”破坏为重复事实。
4. **路由不得绕过 Application。** HTTP 只是传输层，SQL 直连路由会绕过业务校验、事务与错误语义。
5. **Search / Dashboard 是可信读模型，不是装饰。** 缺失时必须先补结构化 MySQL 实现，不能用空态、前端猜测或多次不一致查询填补。
6. **M5 不是主库切换。** 即使端到端验证通过，也需 M6 重新定义启动授权、真实数据处理、恢复、回退与完整用户验收。

## 【M6 前置条件】

M5 封板后不自动开始 M6。若产品决定讨论正式运行授权，至少必须重新冻结：

```text
正式启动模式与 MySQL 单一事实来源
真实 IndexedDB 历史资产的处置（保留 / 导出 / 一次性迁移）
迁移前后计数、引用、版本、备份与恢复核验
切换失败与回退策略
未知提交、网络超时与用户支持策略
本地 API 进程生命周期、日志、诊断与可观测性
完整 H5 UAT、重启恢复和灾难恢复演练
```

M6 才可讨论正式授权、重启、备份恢复和完整 UAT；不应默认引入双写。

## 【交付给研发的实施任务书】

产品确认后，数据 / Application / Repository 工程师与 API 工程师只实施 M5-A：

```text
1. 在 apps/api 建立 MySQL app pool、Repository 与既有 Application Services 的 composition root；
2. 保持 GET /health 的既有脱敏、no-store 与 loopback 语义；
3. 新增 MySqlSearchRepository 与 MySqlDashboardRepository，仅实现既有 Contract 的可信只读读模型；
4. 为当前工作台所需只读操作建立 /api/v1 路由矩阵、JSON 解码、body 限制、错误 DTO、requestId、精确 CORS；
5. 所有路由经 Application / Repository 分层，禁止 SQL 直连路由；
6. 不修改 apps/client，不开放业务写 API，不进入 MySQL 单写验证；
7. 新增 API 单测与真实 MySQL 集成测试，覆盖健康、错误、读模型、loopback、CORS、脱敏和无 .env skip；
8. 更新每日贡献记录；
9. 完成后流转 QA，再回流架构师决定是否授权 M5-B。
```

## 【下一责任岗】

**产品经理。**

## 【是否允许写代码】

**否。** 本任务书须先由产品确认；确认后方可按 M5-A 的受限范围编码。
