# MySQL 主库迁移 — M5-B 架构冻结与分段实施任务书

> 状态：**架构冻结完成。当前不授权编码；产品确认后只能从 M5-B1 开始串行实施。**
>
> M5-B 是 H5 工作台通过本机 loopback API 对 MySQL 候选运行路径进行受控单写验证，不是 MySQL 正式主库切换、历史数据迁移或双写。

## 【技术结论】

**有条件可行。**

M1～M4 已证明 MySQL Repository、完整 `ReviewWorkflowRepository`、跨对象清理和 BackupData 的数据层语义；M5-A 已冻结候选只读 API 的运行组合、错误和一致性读模型。M5-B 可在此基础上增加既有业务的最小读写 API，并将 H5 的运行时组装从 IndexedDB Repository 替换为 HTTP Adapter。

M5-B 的核心边界是：

```text
API 进程拥有业务数据层与 MySQL app pool
H5 只拥有 UI 状态、草稿和 transport 状态
所有业务读取 / 写入经 API → Application → MySQL Repository
```

前端不得保留 Dexie 作为备用数据源、离线缓存写库、同步器或“API 失败时的本地回退”。在 M5-B 受控验证环境中，写入仅进入 MySQL；IndexedDB 不读、不写、不迁移、不删除。

M5-B 不需要 Schema / Migration。现有 Schema、Contracts、BackupData 和 M1～M4 Application / Repository 语义足以承接本阶段。任何运行阻断不得以新增 migration、字段、requestId 幂等键、session 表或同步状态表绕过评审。

实施必须串行：

```text
M5-B1：完整既有业务 API、写入错误 / 未知结果契约与 API 集成验证
→ QA + 架构审阅
→ M5-B2：H5 HTTP Adapter、移除运行时 Dexie 组装与单写 UI 验证
→ QA + 架构审阅
→ M5-C：空 MySQL 端到端闭环、重启、备份恢复与 H5 UAT
```

M5-B1、M5-B2、M5-C 不得并行混做。

## 【现有能力与 M5-B 缺口】

### 已有能力

```text
apps/api
→ Node http、MySQL app pool、loopback 启动、health、只读 API 组合

packages/application
→ Item、Review、Method、MethodApplication、Trash、Search、Dashboard、Backup Services

packages/storage-mysql
→ Item / Review / Method / MethodApplication / Backup / Search / Dashboard / ReviewWorkflow
→ M1～M4 已封板的数据写入事务、清理、墓碑和恢复语义

apps/client/src/pages/index/index.tsx
→ 现有 UI、草稿、确认层、刷新入口和异步状态
→ 当前直接 createIndexedDbRepository 并组装 Application Services
```

### M5-B 缺口

```text
冻结业务写 API 路由与 request / response DTO 解码
API composition root 中 Item / MethodApplication / Trash / Backup Service 组装
业务错误 → HTTP status / error DTO 的完整稳定映射
写请求 body 读取、content-type、大小限制、断连处理
H5 API Client / Adapter composition root
从 H5 运行时移除 storage-indexeddb / Dexie Repository 组装和 close
读取取消、最新请求胜出、提交中、失败、unknown-outcome 状态
单写证明：浏览器业务操作无 IndexedDB 新写入
API / H5 集成、端到端和人工验收
```

## 【运行时组合与依赖注入边界】

### API 是唯一业务运行组合点

`apps/api` 只能在进程启动时构造一次：

```text
MySQL app pool
→ MySqlItemRepository
→ MySqlReviewRepository
→ MySqlMethodRepository
→ MySqlMethodApplicationRepository
→ MySqlBackupRepository
→ MySqlSearchRepository
→ MySqlDashboardRepository
→ MySqlReviewWorkflowRepository
→ existing Application Services
```

API 路由只能调用既有 Application Service；不得在 handler 中直接 SQL 查询、直接操作表、拼装事务，或暴露 Repository / pool。完整复盘必须调用已封板的 `ReviewApplicationService.completeReview()`，不得从 HTTP handler 分拆 Review、Method、Item 或 Link 写入。

`TrashApplicationService` 的 list 会按既有 Contract 触发 retention purge；它仍属于已有 Application 语义。API 不得暴露独立永久清理或任意 cutoff 参数。

### H5 只能使用 API Adapter

新增 H5 adapter composition root，对页面提供现有调用所需的 service-shaped async port。可以将 HTTP DTO 映射为既有 Contract DTO，但不得把 HTTP status、headers、requestId、AbortController 或 error code 注入 `packages/contracts/**` 或 Application 业务对象。

M5-B2 后，H5 禁止：

```text
import @knowledge-base/storage-indexeddb
createIndexedDbRepository()
直接创建或关闭 Dexie database
直接读写 IndexedDB 业务表
持久化业务镜像、离线写队列、后台重试、同步或回填
```

允许 H5 本地状态仅包括：

```text
未提交表单草稿
抽屉 / 确认层 / 选中 / 展开状态
loading / refreshing / submitting / request-error / unknown-outcome
已成功读取的内存展示快照（非持久化业务库）
```

## 【最小读写 API 契约】

所有业务路由固定在 `/api/v1`；`GET /health` 保持 M1 Contract。所有 JSON 成功 / 失败响应：

```http
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Request-Id: <server generated UUID>
```

失败统一为：

```ts
{ error: { code: string; message: string; requestId: string } }
```

不得泄露 SQL、stack、driver error、host、port、database、用户名、密码、`system_metadata` 或迁移信息。

### 既有只读路由（M5-A 回归，不改变语义）

```text
GET /health
GET /api/v1/search?query=
GET /api/v1/dashboard?window=7d|30d|all
GET /api/v1/methods
GET /api/v1/reviews/:id
```

### M5-B1 新增最小路由矩阵

实施前必须新建 `docs/architecture/MySQL主库迁移-M5-B业务API路由矩阵.md`，逐路由固定 method / path / request DTO / 成功 status / Application 调用 / 失败 code / 是否写请求 / 前端 unknown-outcome 策略。矩阵只允许如下既有能力：

| 领域 | 路由 | Application 调用 | 写入 |
|---|---|---|---|
| Item | `GET /api/v1/items`、`GET /api/v1/items/:id`、`GET /api/v1/items/:id/status-events` | list / get / events | 否 |
| Item | `POST /api/v1/items` | `createIdea` | 是 |
| Item | `PATCH /api/v1/items/:id/content` | `updateItemContent` | 是 |
| Item | `POST /api/v1/items/:id/start` | `startExecution` | 是 |
| Item | `POST /api/v1/items/:id/status` | `changeStatus` | 是 |
| Item | `DELETE /api/v1/items/:id`、`POST /api/v1/items/:id/restore` | delete / restore | 是 |
| Review | `GET /api/v1/reviews/by-item/:itemId`、`POST /api/v1/reviews/complete` | get by Item / `completeReview` | 后者是 |
| Method | `GET /api/v1/methods/:id/versions`、`GET /api/v1/methods/:id/evidence`、`GET /api/v1/methods/by-review/:reviewId` | existing Review service methods | 否 |
| Method | `DELETE /api/v1/methods/:id`、`POST /api/v1/methods/:id/restore` | method lifecycle move / restore | 是 |
| Method application | `POST /api/v1/method-applications`、`GET /api/v1/method-applications/:itemId/context`、`GET /api/v1/method-source-displays?itemIds=` | existing MethodApplication service | 前者是 |
| Trash | `GET /api/v1/trash?filter=all|item|method`、`POST /api/v1/trash/:type/:id/restore` | existing Trash service / correct restore service | 后者是 |
| Backup | `GET /api/v1/backup`、`POST /api/v1/backup/restore` | existing Backup service | 后者是 |

约束：

1. `DELETE /methods/:id` 表示既有 **moveToTrash**，不是永久删除；`DELETE /items/:id` 表示既有软删除。不得改变 HTTP 名称含义以外的业务语义。
2. 业务 request body 字段与既有 Application 输入对齐；不得增加业务字段、requestId、幂等键、版本控制字段或前端推断字段。
3. `POST /reviews/complete` 请求体仅为既有 `CompleteReviewInput`；完整原子性仍由 MySQL `ReviewWorkflowRepository` 保证。
4. `GET /method-source-displays` 的 `itemIds` 必须有固定最大数量（建议 100）和 URL 长度保护；超限为 `400 VALIDATION_FAILED`，不得拆分为客户端猜关系或 N+1 请求。
5. `GET /backup` 返回现有 `BackupDocument`。`POST /backup/restore` 只接受现有 `BackupDocument` JSON，必须经 `parseAndValidate()` 后才可调用 restore。不得额外暴露 metadata。
6. `/backup/restore` 不承担“安全备份文件已成功下载”的假承诺。H5 必须先请求并成功下载当前 MySQL 的 `GET /backup` 安全备份，随后用户明确确认才允许提交 restore。
7. 未列入矩阵的所有 `/api/v1/**` 业务路由均禁止。不得暴露 listDeleted 原始表、purge、migration、schema、pool、diagnostics 或 test hook。

### HTTP 错误映射

| code | status | 语义 |
|---|---:|---|
| `VALIDATION_FAILED` | 400 | 既有输入或 URL 参数校验失败。 |
| `NOT_FOUND` | 404 | 已确认对象不存在或不可用。 |
| `CONFLICT` | 409 | 状态迁移、重复 Review、唯一约束或稳定业务冲突。 |
| `REQUEST_TOO_LARGE` | 413 | 业务 JSON 超 64 KiB；备份 restore 超 16 MiB。 |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | 非 `application/json` 的有 body 请求。 |
| `METHOD_NOT_ALLOWED` | 405 | 不允许方法。 |
| `NOT_FOUND_ROUTE` | 404 | 不存在 API 路由。 |
| `MYSQL_SCHEMA_NOT_READY` | 503 | schema 不能满足冻结 API 要求。 |
| `MYSQL_UNAVAILABLE` | 503 | MySQL、pool 或连接不可用。 |
| `INTERNAL_ERROR` | 500 | 未分类脱敏异常。 |

业务错误的 message 必须沿用既有稳定文案；数据库异常不得被误映射为 `NOT_FOUND` / `CONFLICT`。所有失败均带 requestId，但 requestId 仅供关联诊断，**不是幂等键**。

## 【前端 Adapter 与异步状态保护】

### 读取

1. Adapter 的每个 read 接口接受可选 `AbortSignal`，通过 `fetch` 传输；不得把 abort 转换为业务空结果。
2. 页面按读取域维护递增 sequence：列表 / 搜索 / 仪表盘 / 方法详情 / 证据 / 回收站各自隔离。只有最新 sequence 的成功或失败可更新该域；旧响应必须丢弃。
3. 搜索关键词变化、切换模块、关闭详情、启动下一次刷新或组件卸载时取消相应旧读请求。
4. 成功写入后调用 API 重新读取真实结构化事实；不得通过乐观拼接构造 Method、Evidence、Application、ItemLink、状态事件或仪表盘关系。
5. 读取失败保留尚未提交草稿；可保留内存中的旧展示数据，但必须标记非最新，禁止显示为“暂无数据”。

### 写入

1. 每个独立写交互维护 `submitting`，提交期间禁用同一操作入口；不同业务上下文不共享 loading / abort controller。
2. 400 / 404 / 409：显示稳定业务文案，保留草稿，不自动重试。
3. 503 / 500：显示本地 API 或 MySQL 不可用，保留草稿，允许用户手动重新读取；不得把失败清空为成功态。
4. 写 request 一旦发送，浏览器取消、前端 timeout、页面关闭、连接中断或响应无法确认均进入 `unknown-outcome`：

```text
本次提交结果未确认，未自动重试。
请重新获取真实数据后确认是否已生效。
```

5. `unknown-outcome` 只允许触发对应读模型刷新；禁止重发原写请求、后台重试、离线队列或依据本地 UI 推断是否成功。
6. 不对已发送的写请求用 `AbortController` 承诺“服务端未执行”；用户离开页面只能停止等待并进入未知结果状态。

## 【单写与未知提交结果策略】

M5-B 受控验证环境启动模式：

```text
H5 业务读取 → API → MySQL
H5 业务写入 → API → MySQL
IndexedDB → 不读、不写、不迁移、不删除、不回填
```

必须在 H5 自动化和人工验收中验证：

- client bundle / runtime 不含 `@knowledge-base/storage-indexeddb` 或 Dexie 业务调用；
- 每个页面业务操作网络请求仅指向 loopback API；
- 已存在 IndexedDB 数据不展示、不合并、不影响 MySQL 空库结果；
- MySQL / API 不可用时页面进入明确错误态，而不是自动回落 IndexedDB；
- 所有新业务写入仅在 MySQL 业务集合出现，IndexedDB 无对应新增记录。

未知提交结果不可用现有 Contract 消除。M5-B 的诚实策略是“禁自动重试 + 重新读取事实”，不是伪造 idempotency。若未来需要安全重试、结果查询或离线恢复，必须独立产品 / Contract / Schema 评审。

## 【本地安全与配置边界】

持续冻结：

```text
API host = 127.0.0.1
API port = 32146
MySQL host exposure = 127.0.0.1:3307
H5 dev CORS origin = http://127.0.0.1:10086
```

- API 启动必须 fail-fast 拒绝 `0.0.0.0`、wildcard、远程 host、未授权 port；
- CORS 仅允许冻结 origin、`GET, POST, PATCH, DELETE, OPTIONS` 和 `content-type, x-request-id`；禁止 wildcard、credentials、Cookie、Authorization header；
- API 只读取 `MYSQL_APP_*`；绝不读取 / 暴露 `MYSQL_MIGRATOR_*`；
- H5 仅使用 `TARO_APP_API_BASE_URL` 等无 secret base URL 配置；MySQL 配置、连接串和密码不得进入前端源、bundle、日志、错误 DTO 或备份；
- API pool 必须复用、受控关闭；不得每个请求建 pool。

本地单人受信任边界不新增认证体系；它不能作为后续远程访问的安全结论。

## 【Schema / Migration 判断】

**M5-B 不需要且不授权 Schema / Migration。**

现有 MySQL Schema 可提供已封板业务读写及 M5-B 传输。不得新增：

```text
API user / session 表
JWT / token 表
requestId / idempotency 表
outbox / sync 表
迁移进度、前端状态或双写标记字段
```

发现任何运行阻断只能停止，单独进入产品和架构评审；不得修改已执行 migration 或直接新增 004+。

## 【M5-B 分段实施任务书】

### M5-B1：完整既有业务 API 与写入错误边界

允许：

```text
apps/api/**
packages/storage-mysql/src/index.ts
  （仅 API composition root 导出必要调整）
tests/api-m5b*.test.ts 或 tests/mysql-m5b*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

必须：

- 新建并冻结 M5-B 业务 API 路由矩阵；
- 在 API 进程完整组装既有 Application Services 与 MySQL Repositories；
- 实现上表路由，严格经过 Application 层；
- 执行 JSON decode、content type、64 KiB / 16 MiB 上限、URL parameter 上限、错误 DTO、requestId、精确 CORS；
- 完整 Review 调用既有 MySQL Workflow，Backup restore 先 parseAndValidate；
- 覆盖每条写路由的成功、业务失败、MySQL unavailable、错误脱敏及无新增路由；
- 不修改 H5、不会触发单写运行环境。

**退出门：** 真实 MySQL API 集成验证当前路由矩阵全部通过，M1～M5-A 回归保持通过；QA + 架构审阅后才可 M5-B2。

### M5-B2：H5 Adapter 与候选单写运行验证

允许：

```text
apps/client/**
apps/api/**（仅为 Adapter 已冻结调用所需的 bug fix，不扩张路由）
tests/client-m5b*.test.ts、tests/api-m5b*.test.ts 或等价测试
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
apps/client/package.json / config/**
  （仅 H5 API base URL、测试或构建必需的最小配置）
```

必须：

- 新建 API Adapter 并从页面移除 IndexedDB Repository 运行时组装；
- 保持既有页面业务 Contract、纯 UI 交互和草稿语义；
- 全部前端读写使用 API；没有 IndexedDB fallback、双写、同步、回填或持久业务缓存；
- 实现 per-domain 读请求取消 / sequence 保护，per-action submitting 与 unknown-outcome；
- API / MySQL 故障、业务校验失败、解析失败、旧响应和未知提交结果均可见、可恢复且不假成功；
- 空 MySQL H5 路径完成最小读写闭环，证明新写仅入 MySQL。

**退出门：** H5 自动化与人工验收确认运行时无 Dexie 业务读写、API 单写、关键交互状态可靠；QA + 架构审阅后才可 M5-C。

## 【测试矩阵与验收门】

| 维度 | M5-B 必测证据 |
|---|---|
| API matrix | 每条冻结路由的 method / path / request / success DTO / error DTO / 无额外路由。 |
| Application boundary | handler 不直连 SQL；completeReview、trash、backup 都走既有 Application 语义。 |
| Write atomicity | API 调用 M1～M4 已封板事务；API 错误时没有假成功；M1～M4 定向事务回归持续通过。 |
| HTTP safety | JSON decode、415、413、400、404、405、409、503、500、no-store、requestId、脱敏、CORS。 |
| Backup | export、先下载安全备份再确认 restore、parseAndValidate 零写入、replace rollback、metadata 隔离、v1/v2 回归。 |
| Read protection | Adapter abort、sequence、latest-wins、模块切换和卸载不覆盖新 UI。 |
| Write protection | submitting 防重复；业务失败保留草稿；unknown-outcome 禁自动重发，仅刷新确认。 |
| Single write | API 路径只写 MySQL；H5 无 IndexedDB import / business write / fallback / sync。 |
| H5 | 空 MySQL 下事项、流转、复盘、方法、应用、搜索、回收站、备份恢复的实际交互。 |
| Regression | M1～M5-B 串行 MySQL、API tests、client tests、typecheck、full test、build:h5、diff check。 |

H5 人工验收必须检查 Network 与 Storage：业务请求仅指向 `127.0.0.1:32146`；浏览器无 MySQL secret；IndexedDB 无新增业务表写入；503 / unknown-outcome 不显示空态或成功。

## 【允许修改的文件或层】

当前仅在产品确认后，M5-B1 允许：

```text
apps/api/**
packages/storage-mysql/src/index.ts（仅 composition export）
tests/api-m5b*.test.ts 或 tests/mysql-m5b*.test.ts
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

M5-B2 必须等待 M5-B1 QA + 架构书面授权后，才可增加：

```text
apps/client/**
apps/client/config/**
apps/client/package.json
测试文件
```

持续禁止修改：

```text
packages/application/**
packages/contracts/**
migrations/**
packages/storage-indexeddb/**
packages/storage-sqlite/**
BackupData parser / format / v1/v2 语义
```

## 【明确禁止事项】

```text
真实 IndexedDB 历史数据迁移
IndexedDB / MySQL 双写、同步、回填、合并展示或 fallback
MySQL 正式主库切换
浏览器直连 MySQL
0.0.0.0、远程 / 公网 API、反向代理、隧道
多用户、登录、JWT、Cookie Session、RBAC
Schema / Migration
新增业务对象、字段、状态机、方法关系、ItemLink 类型或 ReviewWorkflow
修改 BackupData format、version、v1/v2 语义或 system_metadata 隔离
离线写队列、后台重试、requestId 幂等语义或未知提交结果查询
Docker Compose 全系统化、Kubernetes、云端同步或协作
删除或改造 SQLite 实验资产
```

## 【风险与保护策略】

1. **单写不是默认主库切换。** M5-B 只在受控候选验证环境证明 H5 → API → MySQL；当前产品运行主库结论仍是 IndexedDB，正式切换由 M6 独立授权。
2. **HTTP 不能稀释事务。** API 不拆分完整复盘、方法生命周期、Application、清理或恢复的既有事务；只传递已封板 Application 语义。
3. **未知提交必须诚实。** 无幂等键时，任何自动写重试都会产生重复复盘、状态事件、方法事实或派生事项风险；唯一可允许动作是重新读取。
4. **前端只显示事实。** Adapter 不可用标题、日期、文案或计数补关系；API 故障不回退 IndexedDB，也不伪造空态。
5. **备份恢复是高风险写入。** 安全备份必须先于 restore，业务 backup 与 `system_metadata` 必须持续隔离；恢复结果未知同样不能自动重发。
6. **loopback 不是通用服务化。** 当前无认证只在本机单人可信边界成立；任何暴露网络的意图都必须新立项。

## 【M5-C 前置条件】

M5-C 不自动授权。只有在 M5-B1、M5-B2 均经 QA 与架构审阅通过后，才能书面授权 M5-C。

进入 M5-C 前必须满足：

```text
冻结 API 矩阵完整实现且无额外路由
H5 已无运行时 IndexedDB 业务依赖
所有业务读写经 API → MySQL
无双写、fallback、同步或回填
未知提交结果 UI 已验证为“刷新确认、不自动重试”
空 MySQL 基础闭环已通过
API / client 自动化与 M1～M5-B 回归通过
loopback、CORS、凭据隔离与错误脱敏通过
```

M5-C 才可验证空库全闭环、API / MySQL 重启、备份恢复和完整 H5 UAT；仍不授权 M6 或正式主库切换。

## 【交付给研发的实施任务书】

产品确认后，仅实施 M5-B1：

```text
1. 在 docs/architecture 新建 M5-B 业务 API 路由矩阵，逐项冻结上表路由与错误映射；
2. 在 apps/api 的现有 MySQL composition root 补齐既有 Application Service 组装；
3. 仅实现矩阵规定的既有业务读写 API，所有 handler 通过 Application Service；
4. 完整 Review、方法应用、回收站与 Backup restore 复用既有 Contract / transaction / parseAndValidate 语义；
5. 建立 JSON body / content type / URL 参数限制、requestId、错误 DTO、精确 CORS 与脱敏测试；
6. 不修改 apps/client，不引入任何 IndexedDB / MySQL 双写或候选运行切换；
7. 用真实随机临时 MySQL 数据库完成每路由成功、业务失败、数据层失败和无额外路由集成测试；
8. 运行 M1～M5-A 串行回归、typecheck、full test、build:h5、diff check；
9. 完成后流转 QA，再回流架构师决定是否授权 M5-B2。
```

## 【下一责任岗】

**产品经理。**

## 【是否允许写代码】

**否。** 本任务书须先由产品确认；确认后才能按 M5-B1 受限范围编码，且不得提前进入 M5-B2 或 M5-C。
