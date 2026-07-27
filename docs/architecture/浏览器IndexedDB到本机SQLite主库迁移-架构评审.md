# 浏览器 IndexedDB → 本机 SQLite 主库迁移 — 架构评审

> 状态：**产品技术方向可行；当前禁止开始实现。须先冻结运行形态、一次性迁移交互、SQLite Schema、API 错误契约与恢复演练。**
>
> 前置事实：当前 H5 页面直接装配 `createIndexedDbRepository()`；业务 Contracts / Application / Repository 已稳定，JSON 备份当前为 v2。

## 【技术结论：有条件可行】

将 SQLite 文件替代浏览器 IndexedDB 作为唯一主库，是解决个人长期数据主权与机器级持久化问题的正确方向。它不需要账号、云端、常驻数据库服务、ORM、远程部署或同步系统。

但这不是把 Dexie Repository 换成另一个文件的局部改动，而是一次运行拓扑变更：

```text
当前
浏览器 React 页面
→ Application / IndexedDB Repository
→ 浏览器站点数据

目标
浏览器 React 页面
→ 127.0.0.1 Local API
→ 服务端 Application / SQLite Repository
→ %LOCALAPPDATA%\Knowledge_Base\knowledge-base.db
```

当前前端直接构造 `createIndexedDbRepository()`，并在浏览器内实例化 Application Service。迁移后这条路径必须移除；否则会形成 IndexedDB 与 SQLite 两个事实来源。

实施前必须先冻结以下四项：

1. 本机 Local API 的启动、监听与静态页面托管方式；
2. 旧 IndexedDB 到 SQLite 的人工确认式、一次性 JSON 迁移流程；
3. SQLite Schema、事务边界和恢复前自动保护策略；
4. 前端的“本机数据库不可用”阻断页与 API 错误 Contract。

## 【推荐架构与运行拓扑】

### 1. 推荐最小形态

```text
apps/client（Taro H5 静态工作台）
        │ HTTP，仅回环地址
        ▼
apps/local-api（Node 22 + Fastify + better-sqlite3）
        │
        ├─ packages/application（既有业务编排）
        ├─ packages/domain（既有状态机与业务断言）
        └─ packages/storage-sqlite（SQLite Repository）
                 │
                 ▼
%LOCALAPPDATA%\Knowledge_Base\knowledge-base.db
```

推荐新增：

```text
apps/local-api/
packages/storage-sqlite/
packages/local-api-client/
```

- **`apps/local-api`**：唯一 Node 进程。创建数据目录、打开 SQLite、执行启动检查、装配 SQLite Repository 与现有 Application Service、提供 HTTP API，并在日常使用时托管 H5 构建产物。
- **`packages/storage-sqlite`**：实现现有 Repository Contracts。仅包含 SQL、事务与数据库基础设施；不放 HTTP、页面状态或业务推断。
- **`packages/local-api-client`**：浏览器 HTTP client / facade。页面通过它调用 API；它返回既有 Contract DTO，不接触 SQLite、文件系统或 IndexedDB。

推荐 `Fastify` + `better-sqlite3`：

- Fastify 负责最小 HTTP 路由、统一错误响应、静态文件托管与开发期精确 CORS；
- `better-sqlite3` 提供同步、可预测、单进程友好的 SQLite 事务；
- 不引入 ORM。当前表数量有限、关系和事务语义明确，直接 SQL 的维护成本更低；
- 不引入 Express、Nest、Drizzle、账号、JWT、数据库守护进程、消息队列或服务端部署。

### 2. 网络与安全边界

Local API 必须固定为：

```text
host: 127.0.0.1
port: 产品冻结的固定本机端口（建议 32145）
```

明确禁止：

```text
0.0.0.0
::
局域网 IP
公网域名
反向代理暴露
Docker 对外端口映射
```

日常模式应由 Local API 托管 `apps/client/dist`，用户访问：

```text
http://127.0.0.1:32145
```

这样页面与 API 同源，不需要生产 CORS，也避免 `localhost`、端口变化或 Docker origin 造成的浏览器存储歧义。

开发模式可保留 Taro H5 热更新：

```text
http://127.0.0.1:10086
→ 仅允许向 http://127.0.0.1:32145 发 API 请求
```

开发期 CORS 只能精确允许已冻结开发 origin；不得使用 `Access-Control-Allow-Origin: *`。API 同时校验请求 `Origin`：无 Origin 的同机 CLI / health 请求按白名单路径处理，其余浏览器写请求只接受生产或开发的精确 origin。

> 注：回环监听不是多用户安全边界；本期没有账号或鉴权。但监听在 `127.0.0.1` 并限制浏览器 Origin，足以满足单用户本机工具的冻结范围。不得将此形态宣传为可承载不受信任本机程序的安全服务。

### 3. 启动命令

建议冻结为：

```bash
# 安装依赖
corepack pnpm install

# 日常使用：先构建 H5，再由 API 托管
corepack pnpm build:h5
corepack pnpm start:local

# 开发：并行启动 Local API 与 Taro H5 热更新
corepack pnpm dev:local

# 仅启动 API，供故障排查 / API 测试
corepack pnpm start:api
```

`dev:local` 可使用 `concurrently` 或 Node 脚本管理两个子进程；它只是开发便利，不构成运行时新架构。日常使用始终只需一个 Local API 进程。

API 启动成功后必须输出：

```text
本机数据库已就绪：%LOCALAPPDATA%\Knowledge_Base\knowledge-base.db
工作台地址：http://127.0.0.1:32145
```

启动失败必须非零退出；不得改用空 IndexedDB 或临时内存库。

## 【可复用现有能力】

### 1. 业务 Contracts 与 Application

当前以下业务 Contracts 可原样保留为 SQLite Repository 的目标接口：

```text
ItemRepository
ReviewRepository
MethodRepository
MethodApplicationRepository
ReviewWorkflowRepository
BackupRepository
SearchRepository
DashboardRepository
```

现有 Application 层继续承担：

```text
创建事项与状态操作编排
复盘完成、形成 / 验证 / 修订方法
备份文档创建、解析和结构化校验
搜索与仪表盘读模型计算
回收站到期清理调用
```

Domain 中的 `assertTransition()` 与 `createId()` 继续复用。SQLite Repository 不得复制或放宽状态机。

### 2. 现有 JSON 备份 v2

`BackupData` 已包含：

```text
items
reviews
methods
methodEvidence
methodVersions
methodApplications
itemStatusEvents
itemLinks
methodTombstones
```

并通过 Item 本体带有：

```text
content
startAction
deletedAt
```

当前 `BackupApplicationService.parseAndValidate()` 已承载 v1 / v2 兼容、可选字段降级、必填引用严格拒绝和墓碑关系校验。这是 SQLite 导入、首次迁移和日后恢复的唯一业务校验入口，应复用而非复制第二套校验。

### 3. 已冻结的数据可信规则

必须无改动迁移：

```text
Item 状态与 ItemStatusEvent 同事务
startAction + 首次 idea_to_try → doing + 事件原子写入
content 只更新 content / updatedAt
删除、恢复与 purge 的事务内最新读取
复盘完整工作流原子性
方法回收站、墓碑、证据、冻结版本与断裂关联降级
完整备份可恢复
```

## 【最小新增能力】

### 1. SQLite Repository 与 Schema

新增 `packages/storage-sqlite`，以 SQL 表对应既有实体，不新增业务对象：

```text
items
item_status_events
reviews
methods
method_versions
method_evidence
method_applications
method_tombstones
item_links
system_metadata
```

`system_metadata` 仅保存基础设施状态，例如：

```text
schema_version
indexeddb_migration_state
indexeddb_migration_source_hash
indexeddb_migrated_at
```

它不是业务数据，不进入 `BackupData`、搜索、仪表盘或页面展示。

建议 Schema 原则：

- 每张业务表保留现有稳定 ID；不重编号，不依赖自增 ID；
- 时间统一为现有 ISO 8601 文本；
- `items.status` 加 SQLite `CHECK`，但状态转移合法性仍由 Domain / Application 判定；
- `reviews.item_id` 与 `method_applications.item_id` 设唯一约束，匹配现有一事项一复盘、一事项一方法应用；
- 对 SQL 查询路径建立最小索引：状态 / 删除时间、事件 `(item_id, created_at)`、方法版本 `(method_id, version)`、证据 `method_id` / `review_id`、应用 `item_id` / `(method_id, method_version)`、ItemLink 来源 / 目标；
- `method_tombstones.versions` 可首版存为 JSON 文本，保持其“最小历史版本映射”整体语义，不为未验证查询新增额外业务表；
- 启用 `PRAGMA foreign_keys = ON`，但对允许方法永久清理后继续存在的 MethodEvidence / MethodApplication 不建立会阻止墓碑语义的硬外键；这些关系继续由既有备份校验与 Repository 原子事务维护；
- 读写使用参数化 SQL，禁止字符串拼接查询。

### 2. 事务封装

`better-sqlite3` 的同步 transaction 需被封装成 `Promise` 契约，以保持现有接口不变。每个既有可信事务必须在同一个 SQLite transaction 内完成，例如：

```text
startExecution
→ 重新读取 Item
→ 校验状态
→ 更新 Item（可选 startAction）
→ 写 ItemStatusEvent
→ commit / rollback

completeReview
→ 读取 / 校验 Item
→ 写 Review、方法 / 证据 / 版本（按当前分支）
→ 写 Item / 状态事件 / 新想法与 ItemLink（按当前语义）
→ commit / rollback

replaceData
→ 已在 Application 校验完整 BackupData
→ SQLite 单 transaction 清空所有业务表
→ 写入全部业务表
→ 完整性检查
→ commit / rollback
```

SQLite Repository 的写入前仍须在 transaction 内重新读取最新 Item / Method，不能因为 SQLite 单进程而回退已关闭的并发一致性 P0。

### 3. Local API Contract

Local API 不是把 SQLite SQL 暴露给浏览器，而是暴露 Application 用例。例如：

```text
GET  /api/health
GET  /api/items
POST /api/items
POST /api/items/:id/start-execution
POST /api/items/:id/status
PUT  /api/items/:id/content
POST /api/items/:id/trash
POST /api/items/:id/restore

GET  /api/reviews/by-item/:itemId
POST /api/reviews/complete

GET  /api/methods
POST /api/methods/:id/apply
POST /api/methods/:id/validate-from-review
POST /api/methods/:id/trash
POST /api/methods/:id/restore

GET  /api/method-applications/:itemId/context
POST /api/method-applications/source-displays

GET  /api/search?q=
GET  /api/dashboard?window=
GET  /api/trash?filter=

GET  /api/backup/export
POST /api/backup/restore
POST /api/migration/indexeddb/import
```

路由命名可在实施任务书中进一步收敛，但必须遵守：

```text
HTTP handler
→ Application Service
→ SQLite Repository
→ SQLite
```

禁止：

```text
HTTP handler 直接写 SQL
浏览器发送任意 SQL
浏览器接触数据库文件
前端直接构造 SQLite Repository
```

### 4. 浏览器 API Client

新增 `packages/local-api-client`。它负责：

```text
fetch
请求 / 响应 DTO 序列化
统一 LocalApiError 映射
超时 / 网络失败分类
```

前端通过 API client 调用用例，取代对 IndexedDB Repository 和浏览器内 Application 实例的直接依赖。业务语义、输入输出 DTO 尽量复用 `contracts`。

Application 的业务编排运行在 Local API 进程，不应复制到 React 页面。为避免一次性把每个界面调用改为大量 HTTP repository adapter，允许 API client 先提供与页面现有需求相近的 typed facade；但它只能转发 API，不能实现状态机、备份校验或数据关系拼接。

## 【SQLite 文件与本机 API 边界】

### 1. 文件目录与首次创建

固定 Windows 默认目录：

```text
%LOCALAPPDATA%\Knowledge_Base\knowledge-base.db
```

API 启动步骤：

```text
读取 LOCALAPPDATA
→ 缺失：启动失败，提示用户设置 Windows LocalAppData；不得回退到项目目录或浏览器存储
→ fs.mkdir(dataDir, { recursive: true })
→ 若目录创建失败：启动失败，显示路径与原始系统错误
→ 打开 knowledge-base.db
→ 执行 PRAGMA foreign_keys = ON
→ 执行 PRAGMA journal_mode = WAL
→ 执行 PRAGMA synchronous = FULL
→ 执行 PRAGMA busy_timeout = 5000
→ 执行 Schema migration / PRAGMA quick_check
→ 仅全部成功后监听 HTTP
```

目录使用当前 Windows 用户 ACL 继承权限；不通过 `chmod 777` 或降低 ACL 来“解决”权限问题。

WAL 会生成：

```text
knowledge-base.db
knowledge-base.db-wal
knowledge-base.db-shm
```

它们都是主库工作集的一部分：不提交 Git、不手动单独复制作为备份。用户级可信备份仍是完整 JSON 导出。

### 2. 文件损坏、被锁定、不可写

| 场景 | API 行为 | 前端行为 |
|---|---|---|
| 数据目录无法创建 / 无权限 | 进程非零退出 | 显示“本机数据库目录不可用”，提供固定路径与修复提示 |
| 数据库无法打开 / 被占用超时 | 进程非零退出 | 显示“本机数据库未启动或被占用”，不得显示空事项 |
| `quick_check` 失败 | 不启动、不创建替代空库、不覆盖原文件 | 显示“数据库可能损坏”，提示停止使用、复制现有文件、用 JSON 备份恢复或人工支持 |
| 运行时磁盘满 / 写入失败 | API 返回明确 `storage-write-failed` | 保留前端草稿 / 表单，显示“本机数据库未写入，请释放空间后重试” |
| API 未运行 / 连接拒绝 | client 返回 `local-api-unreachable` | 阻断数据页面，显示启动命令与重试；不得使用 IndexedDB 或显示“暂无事项” |
| 迁移未完成 | health 返回 `migration-required` 或 `migration-in-progress` | 显示迁移向导 / 状态，不进入工作台 |

`GET /api/health` 的最小结构化状态建议：

```ts
type LocalStorageHealth =
  | { status: 'ready'; databasePath: string; schemaVersion: number }
  | { status: 'migration-required' }
  | { status: 'migration-in-progress' }
  | { status: 'storage-unavailable'; code: string; message: string }
```

生产页面首次加载必须先检查 health。只有 `ready` 才加载事项、方法、搜索与仪表盘。

## 【IndexedDB 一次性安全迁移方案】

### 关键事实：Node 无法直接读取浏览器 IndexedDB

旧数据位于特定浏览器 profile + protocol + host + port 的 origin 中。Node Local API 无法可靠读取它；新 origin 也无法跨 origin 读取它。

因此，迁移不能设计成“SQLite 启动时自动扫描 IndexedDB”。唯一可信、跨 origin 的通道是：

```text
旧 IndexedDB
→ 在原浏览器 / 原 origin 中导出完整 JSON
→ 用户确认并上传 JSON 给 Local API
→ Local API 校验并在 SQLite 单 transaction 导入
```

这是产品流程，不是技术缺陷。它避免因 origin、无痕 profile、浏览器清理或开发端口变化而偷偷导入错误库。

### 一次性迁移 SOP

```text
0. 安装并启动 Local API；其 SQLite 为新库，处于 migration-required。

1. 使用仍可访问旧数据的浏览器 profile 与原 origin 打开旧工作台。

2. 在旧工作台执行“导出完整 JSON 备份”。
   - 用户将该 JSON 保存到本机明确位置；
   - 该文件是迁移前不可跳过的安全锚点；
   - 若旧工作台已无法打开或数据已不存在，进入“从已有 JSON 备份恢复”，不得伪造迁移成功。

3. 在新 Local API 工作台打开“从 IndexedDB 迁移”向导，选择该 JSON。

4. Local API 使用既有 BackupApplicationService.parseAndValidate() 校验。
   - 不通过：拒绝写入 SQLite，显示具体校验错误；
   - 通过：计算规范化 BackupData 的 SHA-256（用于迁移审计 / 重复保护）。

5. SQLite 单 transaction：
   - 确认 system_metadata.migration_state = not_started���
   - 确认所有业务表为空；
   - 写入全部 BackupData；
   - 执行 SQL 层最小完整性检查与 exportData 记录数比对；
   - 写入 migration_state = complete、source_hash、migrated_at；
   - commit。

6. API 在提交后再次以 SQLite exportData 生成同逻辑 BackupDocument，
   与已校验导入数据做集合 / ID / 关联一致性核对；成功才进入 ready。

7. 用户执行一次新的 SQLite JSON 导出并在空测试库恢复，完成迁移验收。

8. 原 IndexedDB 不删除、不清空；它仅作为旧来源保留至用户确认迁移备份有效。
   新工作台从此不读取、不写入、不自动同步 IndexedDB。
```

### 重复、部分迁移与失败处理

```text
导入前失败
→ SQLite 不写入；旧 IndexedDB 不受影响。

SQLite transaction 内失败
→ SQLite 回滚到迁移前空库；旧 IndexedDB 不受影响；migration_state 保持 not_started。

提交成功前 API 崩溃
→ SQLite transaction 平台回滚；下次仍可安全重试。

提交成功后 API 崩溃
→ metadata 与全部业务数据已同事务提交；下次 health 为 ready，禁止重复迁移。

已完成迁移再请求导入
→ 拒绝，不能覆盖现有主库。
```

后续用户要从任意 JSON 覆盖恢复，走独立的“恢复备份”流程，而不是重复走 IndexedDB 迁移。恢复前必须生成 SQLite 当前数据的自动恢复点。

### 禁止双主

迁移完成后：

```text
SQLite = 唯一主库
IndexedDB = 只读、一次性历史来源
```

前端构建必须移除 `@knowledge-base/storage-indexeddb` 的生产依赖和任何 `createIndexedDbRepository()` 调用。可将 IndexedDB 代码保留在迁移工具 / 测试专用包中，但不得随日常工作台装配或自动访问。

## 【JSON 备份 / 恢复兼容策略】

### 1. 格式与版本

**本次不升级 BackupDocument 版本。**

SQLite 是存储介质变化，不是业务备份数据模型变化。继续导出当前：

```text
format: knowledge-base-backup
version: 2
```

保留：

```text
v1 导入兼容
v2 完整导出与恢复
startAction 缺失 = 合法无快照
methodTombstones 缺失（v1）= 空数组
非法必填引用 = 严格拒绝
非 string startAction = 严格拒绝
```

不允许把路径、SQLite 元数据、WAL、schema version、migration marker 或个人机器信息写进 JSON BackupData。

### 2. 导出

由 Local API 进程中的 Application Service 调用 SQLite `BackupRepository.exportData()`，再复用既有 BackupApplicationService 生成 BackupDocument。

导出读取必须具备一致性快照：推荐在一个 SQLite read transaction 中读取全部业务表，保证导出的跨表关系来自同一数据库视图，而不是多个互相穿插的读取。

### 3. 恢复

恢复顺序：

```text
上传 JSON
→ parseAndValidate 完整通过
→ 从 SQLite 当前数据创建自动恢复点 JSON 文件
→ 若恢复点不能安全写入：拒绝恢复，不触碰主库
→ SQLite 单 transaction replaceData
→ SQL 完整性检查
→ commit
→ 导出后校验 / 重载 health
```

自动恢复点目录建议：

```text
%LOCALAPPDATA%\Knowledge_Base\backups\before-restore-YYYYMMDD-HHmmss.json
```

它不纳入 Git，也不自动上传。若未来需设置保留策略，应由产品单独定义；本期至少不自动静默删除用户恢复点。

SQLite `replaceData()` 不得采用事务外先删除再逐表插入；必须全量替换事务化，失败则保留恢复前完整主库。

### 4. 迁移与恢复的关系

首次 IndexedDB JSON 导入复用 `parseAndValidate()`，但只在 SQLite 空库且 migration state 未完成时可执行。普通 JSON 恢复不改变“IndexedDB 已迁移”标记，也不重新读取 IndexedDB。

## 【数据可信边界与异常降级】

### 不变量

```text
浏览器 UI
→ 只经 Local API Client
→ Local API Application
→ SQLite Repository
→ SQLite
```

前端不可信地缺少 API 返回时：

```text
不得显示空事项
不得创建临时 IndexedDB
不得把网络错误映射为 no-association / 无搜索结果 / 无回收站
不得以 local state 的假成功替代持久化成功
```

每个 API 错误响应应使用统一结构：

```ts
interface LocalApiErrorResponse {
  error: {
    code:
      | 'local-api-unreachable'
      | 'storage-unavailable'
      | 'storage-write-failed'
      | 'migration-required'
      | 'migration-in-progress'
      | 'validation-failed'
      | 'conflict'
      | 'not-found'
      | 'internal-error'
    message: string
    retryable: boolean
  }
}
```

业务错误与基础设施错误必须区分：

```text
事项不存在 / 状态机拒绝 / 备份校验失败
→ 业务或输入事实，按既有页面规则处理

API 未启动 / SQLite 无法打开 / 文件损坏 / 磁盘写入失败
→ 基础设施阻断，保留可编辑草稿，明确引导用户修复本机环境
```

### 数据库不可用时的前端页面

最小阻断屏而非空态：

```text
标题：本机数据库未就绪
说明：无法连接或打开本机 SQLite 数据库。你的事项没有被读取；这不是“暂无事项”。
操作：重试连接
辅助信息：工作台需启动 Local API；显示 start:local 命令 / 固定地址
```

迁移未完成：

```text
标题：需要迁移现有本地数据
说明：先在旧工作台导出完整 JSON，再导入到本机 SQLite。
操作：开始导入 / 查看迁移步骤
```

数据库损坏：

```text
标题：本机数据库可能损坏
说明：系统不会创建空数据库覆盖现有数据。
操作：查看文件路径、从完整 JSON 备份恢复
```

## 【允许修改的层与文件范围】

本次是新范围 / 新 Sprint，允许在正式实施任务书冻结后修改：

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
.gitignore
README.md
apps/local-api/**
apps/client/**
packages/contracts/**（仅 API DTO / 共享错误类型确有必要时）
packages/application/**（服务端装配或可测试性适配，不改业务语义）
packages/storage-sqlite/**
packages/local-api-client/**
packages/storage-indexeddb/**（仅迁移来源工具、清理生产依赖或测试适配）
tests/**
docs/architecture/**
docs/development/**
docs/product/**（产品确认迁移流程与验收后）
```

明确禁止：

```text
业务状态机语义改动
Item / Review / Method / Version / Evidence / Application / Tombstone / Link 历史数据删减
IndexedDB 与 SQLite 长期双写
浏览器直接操作 SQLite / 文件系统
.db、-wal、-shm、JSON 备份和真实数据进入 Git
公网监听、账号、云端、同步、协作、部署
为 SQLite 迁移顺带引入 ORM、全局状态库、路由重构或 UI 大改
```

`.gitignore` 必须显式覆盖：

```gitignore
*.db
*.db-wal
*.db-shm
*.sqlite
*.sqlite3
knowledge-base-backup*.json
/backups/
```

同时不得仅依赖 `.gitignore`：启动诊断、README 和 API 错误提示必须告知实际数据目录不在仓库。

## 【测试与迁移验收建议】

### 1. SQLite Repository 自动化

用临时 SQLite 文件（每个测试独立目录，测试结束删除）覆盖既有 Repository 测试矩阵：

```text
Item 创建、状态机、事件、startExecution 原子性
content 更新与状态 / 删除 / 恢复并发一致性
purge 与 restore 交错
Review complete 全有或全无
方法形成、验证、修订、版本、证据、应用
方法回收站、恢复、永久清理、墓碑引用回收
断裂关联 getContextResult 与批量来源展示
搜索、仪表盘、回收站
```

必须保留并迁移所有已关闭 P0 的受控交错测试，不接受“SQLite 天然单文件所以不用测”的假设。

### 2. 备份与恢复

至少覆盖：

1. SQLite 中 v2 全量数据导出、解析、恢复到空 SQLite，逐表数据与关系一致；
2. v1 备份恢复，`methodTombstones` / `startAction` 等旧可选字段稳定降级；
3. 非字符串 `startAction`、必填引用断裂、实体与同 ID 墓碑共存等非法数据严格拒绝；
4. 恢复前恢复点写入失败时，主库完全不变；
5. `replaceData()` 任一插入失败时，主库保留恢复前完整数据；
6. 导出快照不混合不同写入时刻的跨表记录。

### 3. IndexedDB 一次性迁移

至少覆盖：

1. 从已验证 v2 JSON 导入空 SQLite，全部 9 个数据集合及 `content`、`startAction`、`deletedAt`、墓碑关系逐条一致；
2. 导入成功后 migration metadata 与 source hash 同事务写入；
3. 第二次迁移请求被拒绝，不覆盖 SQLite；
4. 迁移过程中任意插入失败，所有业务表与 metadata 回滚为空 / 未完成；
5. 迁移前 JSON 校验失败，不触碰 SQLite；
6. 迁移后 SQLite 再导出并恢复到新库，结果一致；
7. 原 IndexedDB 测试库在迁移失败 / 成功后均未被写入或清空。

### 4. API 与前端异常路径

至少覆盖：

```text
API 未启动 / connection refused
数据库目录不可写
SQLite 文件锁冲突超时
quick_check 失败
migration-required
migration-in-progress
磁盘写入失败（可注入 storage adapter 错误）
业务 not-found / 状态冲突与基础设施错误区分
```

前端 H5 人工 UAT 必须证明：

1. API 不可用时显示阻断页而非“暂无事项”；
2. 一次性迁移前明确要求旧库 JSON 导出；
3. 成功迁移后刷新、关闭浏览器、重启机器 / 重启 API，数据仍从 SQLite 读取；
4. 旧 IndexedDB 不再被正常工作台读写；
5. JSON 导出、恢复、回收站、复盘、方法、启动动作完整可用；
6. API 仅可由 `127.0.0.1` 访问，未监听 `0.0.0.0`。

### 5. 迁移验收门槛

不得用“页面显示了事项”替代迁移验收。至少满足：

```text
旧 IndexedDB 完整 JSON
→ server-side validate
→ 空 SQLite 单事务导入
→ SQLite 导出 JSON
→ 新 SQLite 恢复
→ 所有实体、可选字段、关联、状态事件和墓碑关系一致
```

并完成一次真实 Windows 用户目录下的重启 API / 浏览器验证。

## 【待产品裁决的问题】

以下问题阻断正式实施任务书：

1. **迁移入口与用户确认**
   - 是否接受“旧工作台先手工导出 JSON、新工作台上传迁移”的明确两步流程？
   - 架构建议：接受。Node 不能可靠跨浏览器 origin 自动读取 IndexedDB；手工导出是可恢复、可审计的安全边界。

2. **固定端口**
   - 是否冻结 `127.0.0.1:32145`？
   - 架构建议：冻结固定端口，降低日常启动、同源静态托管与故障排查成本。若端口被占用，明确报错，不静默换端口导致 origin 混乱。

3. **日常运行载体**
   - 是否确认日常使用不再通过当前 Docker / Nginx 静态容器，而由 Node Local API 托管 H5 静态文件？
   - 架构建议：确认。当前 Docker / Nginx 形态无法安全承载用户 Windows 本机 `%LOCALAPPDATA%` SQLite 主库，除非额外设计卷挂载和本机 API；这超出本期必要复杂度。

4. **自动恢复点保留策略**
   - 恢复前自动生成的 JSON 恢复点是否永久保留，还是产品希望定义数量 / 天数上限？
   - 架构建议：首版永久保留且在设置页告知路径；没有真实空间摩擦证据前不自动删除。

5. **数据库损坏后的产品支持路径**
   - 是否确认：`quick_check` 失败时系统拒绝启动，不创建空库覆盖原文件，用户只能先保留文件并通过 JSON 备份恢复？
   - 架构建议：确认。这是数据主权优先的保守策略。

6. **旧 IndexedDB 清理时点**
   - 是否确认：系统不自动删除旧浏览器数据；仅在用户完成“SQLite 导出并成功恢复”验证后，由用户自行决定是否清理浏览器站点数据？
   - 架构建议：确认。自动清理旧源会把迁移错误变成不可逆数据损失。

## 【交付给研发的技术约束】

```text
当前不允许写代码。

待产品确认上述六项后，架构师必须先输出正式实施任务书，至少冻结：
- SQLite DDL 与 schema migration strategy；
- Local API endpoint / error DTO；
- SQLite Repository 的事务映射；
- IndexedDB JSON 一次性迁移向导与 metadata 状态机；
- 前端启动健康检查与阻断页；
- v1 / v2 JSON 备份恢复验证矩阵；
- 分阶段切换与回滚计划。

实施顺序必须为：
SQLite Repository 与自动化
→ Local API 与备份 / 迁移能力
→ QA 数据迁移复验
→ 前端 API client 与阻断页
→ 前端用例切换
→ H5 / Windows 重启 UAT
→ 产品验收

不得先把页面改成空 SQLite，或让 IndexedDB / SQLite 长期双写。
```
