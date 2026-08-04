# 代码地图

> `notes/` 是理解型笔记，不是流程文档。它可以随时修改，不需要产品授权，也不进入封板与归档流程。
>
> 本文回答"哪个文件负责什么、哪些代码是活的"。全部结论由实际代码得出，行数为 2026-07-30 实测值，会随开发变化。

## 一、运行时链路

只有这一条链路是活的：

```text
浏览器 H5 (127.0.0.1:10086)
  ↓  apps/client/src/pages/index/api-client.ts        统一 fetch 封装
  ↓  /api 开发代理
apps/api/src/main.ts                                  当前启动入口
  ↓
apps/api/src/index.ts                                 原生 Node HTTP 路由
  ↓  apps/api/src/api-errors.ts                       统一错误分类、映射与未预期错误上报
  ↓
packages/application/src/index.ts                     认证、归属与业务用例编排（11 个 Service）
  ↓  packages/contracts/src/index.ts 定义的 Repository 接口与 errors/* 错误契约
packages/storage-mysql/src/*                          账户、owner scope 与业务 MySQL 实现
  ↓
MySQL (127.0.0.1:3306)
```

具体端口、数据库名与当前 schemaVersion 见 `docs/product/当前运行事实.md`。

## 二、活代码

### 类型与契约层

```text
packages/contracts/src/index.ts            562 行
packages/contracts/src/errors/*             87 行
```

**最值得先读的一组文件。** 纯类型定义，零运行逻辑，包含四类内容：

- 认证与归属：`AuthUser`、`AuthSession`、`CurrentUserScope`、十个 owner 业务集合与初始归属结果
- 业务对象：`Item`、`Review`、`Method`、`MethodVersion`、`MethodEvidence`、`MethodApplication`、`ItemStatusEvent`、`ItemLink`、`MethodTombstone`、`ExplorationTrack`
- Repository 接口（端口）：`AuthRepository`、`InitialOwnerClaimRepository`、`ItemRepository`、`ReviewRepository`、`MethodRepository`、`BackupRepository` 等，由 storage-mysql 实现
- 错误契约：按事项、方法、复盘、探索主线与备份分区的 `BusinessErrorCode`，以及 API 错误响应和状态码类型

读完这组契约就掌握了系统的数据词汇与稳定错误码。备份的三个版本 `BackupDocumentV1/V2/V3` 也在这里，V3 比 V2 多 `explorationTracks` 集合；运行时业务读写再由 `CurrentUserScope` 限定当前账户。

### 领域层

```text
packages/domain/src/index.ts               102 行
```

领域层现在包含四类能力：

- 认证纯逻辑与密码学辅助：用户名规范化、凭据边界、scrypt 密码散列/校验、会话 secret 生成与散列
- `BusinessError`：使用 Contracts 定义的稳定 `code + category` 契约并携带领域消息；`category` 固定为 `validation / not-found / conflict / internal`
- `createId()`：生成 UUID
- 事项标题规则与状态机：标题按 Unicode 字素簇限制，`transitions` 是状态机的唯一定义，共 8 个状态

业务错误的 HTTP 映射不在领域层完成；领域层只表达业务事实，由 API 层统一映射。

### 应用层

```text
packages/application/src/index.ts          678 行
```

11 个 Service 类，每个对应一块业务能力：

```text
AuthenticationApplicationService    注册、登录、会话读取与退出
InitialOwnerClaimApplicationService 显式目标账户的初始个人数据归属
BackupApplicationService            备份导出、校验、恢复（含 V3 全量前置校验）
ItemApplicationService              事项捕获、状态迁移、软删除、回收站
ExplorationTrackApplicationService  探索主线生命周期与关联
ReviewApplicationService            复盘与方法查询
MethodLifecycleApplicationService   方法回收站
MethodApplicationService            方法发起行动、来源展示
TrashApplicationService             统一回收站（事项/方法/主线三类）
SearchApplicationService            全局搜索
DashboardApplicationService         仪表盘指标计算
```

三处逻辑重点：认证服务只保存密码散列和会话 secret 散列；`validateV3Data()` 在任何写入之前完成全量校验，这是"断裂引用整体拒绝"的落地点；`buildDashboardReport()` 是纯函数，全部指标在内存计算，不下推到 SQL。业务 Application 通过 `CurrentUserScope` 把当前账户作用域传给 Repository；可预期业务失败不携带 HTTP 状态码、`requestId` 或数据库驱动信息。

### HTTP 层

```text
apps/api/src/main.ts                         5 行   当前启动入口
apps/api/src/index.ts                      278 行   原生 Node HTTP、认证会话与依赖装配
apps/api/src/api-errors.ts                 148 行   统一错误分类、映射与上报
apps/api/src/hono/*                                尚未接入启动入口的并行骨架
```

当前 `package.json` 的 `start` 脚本运行 `src/main.ts`，它调用 `createApiServer()`，因此实际运行的仍是原生 Node `http` 实现。结构是三段：

- `createServices()`：手工装配 Repository 与 Service，是当前运行入口的依赖注入点
- `route()`：用 `if` 和正则匹配路由，静态路径在前、参数路径在后
- `api-errors.ts`：共享的 `ApiError`、`mapFailure()` 与 `reportUnexpectedFailure()`

需要知道的约束都在这里：CORS 白名单只允许当前冻结的 loopback H5 来源，普通请求体上限 64 KiB 而备份恢复为 16 MiB，监听地址被硬校验为 `127.0.0.1:32146`。具体运行入口与例外以 `docs/product/当前运行事实.md` 为准。

当前错误映射已经不依赖中文文案匹配。完整逻辑是：

```text
HTTP decode / method / body 边界失败
→ ApiError 自带 status、code、message

Domain / Application / Repository 的可预期业务失败
→ BusinessError.category
   validation → 400 VALIDATION_FAILED
   not-found  → 404 NOT_FOUND
   conflict   → 409 CONFLICT
   internal   → 500 INTERNAL_ERROR（对外固定脱敏文案）

认证、授权与 Backup 归属失败
→ 401 UNAUTHORIZED / 403 FORBIDDEN / 409 CONFLICT

MySqlSchemaNotReadyError
→ 503 MYSQL_SCHEMA_NOT_READY

已识别的 MySQL 连接错误
→ 503 MYSQL_UNAVAILABLE

其他未分类异常
→ 500 INTERNAL_ERROR
```

API 失败响应统一为 `{ error: { code, message, requestId } }`，同时返回 `X-Request-Id` 与 `Cache-Control: no-store`。注册、登录、退出与会话读取使用 HttpOnly Cookie；其余业务路由必须先解析当前会话并建立 `CurrentUserScope`。预期的认证/业务失败不记为未预期故障；内部业务错误和未分类异常会用同一 `requestId` 写入服务端错误日志。`/health` 是例外：数据库不可用时返回脱敏的 health 503 状态对象，不使用业务错误 DTO。

`apps/api/src/hono/*` 已复用同一 `mapFailure()`，但没有被 `src/main.ts` 或启动脚本调用，当前不能把它当成实际运行路由。它与原生 HTTP 路由并存，是后续理解和修改时需要防止漂移的边界。

### 存储层

```text
packages/storage-mysql/src/index.ts                    165 行   连接池、事务、迁移、health
packages/storage-mysql/src/account-repository.ts        13 行   账户与会话
packages/storage-mysql/src/initial-owner-claim-repository.ts 89 行 初始归属
packages/storage-mysql/src/item-repository.ts          222 行
packages/storage-mysql/src/exploration-track-repository.ts  341 行
packages/storage-mysql/src/method-repository.ts        267 行
packages/storage-mysql/src/review-workflow-repository.ts    226 行
packages/storage-mysql/src/backup-repository.ts        143 行
packages/storage-mysql/src/review-repository.ts        117 行
packages/storage-mysql/src/method-application-repository.ts 107 行
packages/storage-mysql/src/read-model-repositories.ts   88 行   仪表盘 + 搜索
```

`index.ts` 里的 `runInMySqlTransaction()` 是所有原子操作的基础；`getMySqlHealth()` 支撑 `/health` 返回的库名与 schemaVersion。业务 Repository 的查询和写入均以 owner scope 限定当前用户；跨用户资源对调用方统一不可见。初始归属是独立显式命令，不属于日常启动步骤。Repository 对可预期的数据状态抛结构化业务错误，其余驱动异常继续向 API 层传播，不伪装成业务成功、空数据或 fallback。

### 前端

```text
apps/client/src/pages/index/index.tsx              2640 行   登录门与主页面（见第四节风险）
apps/client/src/pages/index/exploration-prototype.tsx  317 行   探索主线模块
apps/client/src/pages/index/api-client.ts           164 行   认证上下文与 API 封装
apps/client/src/pages/index/*-state.ts        共 90 行   5 个局部状态模块（各 12-29 行）
apps/client/src/pages/index/index.scss                      全部样式
```

`api-client.ts` 是传输结果分类的实现位置：

- 已收到 HTTP 错误响应：保留服务端 `code`、`message`、`requestId` 和 HTTP `status`，属于“已确认失败”
- 读请求网络失败：提示无法连接本地数据服务；读请求 Abort 保持为 Abort
- 写请求在收到响应前发生网络异常或 Abort：抛 `ApiClientUnknownOutcomeError`，不自动重发
- 非认证路由返回当前认证上下文的 401：触发登录门；旧认证请求不能覆盖更新后的认证上下文

页面层负责决定是否保留草稿、锁住再次写入以及何时显式重读；因此只读 `api-client.ts` 只能理解传输与认证分类，不能代表所有页面都已经采用完全一致的 unknown-outcome 状态机。

### 数据库迁移

```text
migrations/001_initial_schema.sql
migrations/002_add_system_metadata.sql
migrations/003_method_lifecycle_constraints.sql
migrations/004_add_exploration_tracks.sql
migrations/005_add_accounts_sessions_and_owner_columns.sql
```

已全部应用，运行库当前 schemaVersion = 5。这些文件**不可修改**，包括格式调整。平台角色与最小权限管理的后续 Schema 仍属于独立授权切片，不得据文档提前视为当前运行事实。

## 三、死代码与历史资产

这部分**不参与运行**，读代码时可以直接跳过。它们仍在仓库里是因为清理需要走产品授权流程。

```text
archive/packages/storage-indexeddb/src/index.ts   931 行   浏览器时代的存储实现（已归档）
packages/storage-sqlite/src/*                     680 行   SQLite 路线的存储实现
apps/local-api/src/*                              152 行   SQLite 路线的 API 服务
```

合计 **1763 行**。三条判定依据：

- `storage-indexeddb` 已移至 `archive/packages/`，不参与生产装配；仍被历史测试通过路径别名引用
- `storage-sqlite` 只被 `apps/local-api` 和测试引用
- `apps/local-api` 没有任何启动脚本引用它（`package.json`、`docker-compose.yml`、`Dockerfile` 均无）

`archive/packages/storage-indexeddb/src/index.ts` 是全项目第二大文件之一，容易被误认为核心模块，实际已完全停用。

测试里也有大量历史遗留：70 个测试文件中 **28 个**依赖上述废弃存储，而 `pnpm test` 默认全量执行。

## 四、代码与文档的已知偏离

代码是准的，以下几处文档没跟上。

**"待复盘"状态实际已不可达。** `docs/product/功能清单-v4.md` 说"执行完成后进入待复盘"，但 `packages/domain` 的状态机里 `doing` 的合法去向是 `paused / archived_no_review / abandoned`，**不含 `waiting_review`**。完成复盘由 `completeReview` 从 `doing` 直接迁移到 `reviewed`。前端界面对这个状态的标签就是"待完成复盘（历史）"（`index.tsx` 第 33 行），变量名叫 `historicalWaitingReviewCount`。所以 `waiting_review` 只存在于历史数据中，代码已如实反映，产品文档还是旧描述。

**动作表存在两份且不一致。** `ItemApplicationService.actionsFor()`（application 第 674 行）在运行路径中**从未被调用**——API 没有暴露它。前端用的是 `api-client.ts` 第 98 行自己的一份，两者内容已经漂移：Application 版给 `idea_to_try` 和 `doing` 提供"放弃"按钮，前端版没有。更麻烦的是 `index.tsx` 第 2286 行又加了一层过滤，把 `abandoned` 从这两个状态里排除——过滤的是前端版本里本来就不存在的项，属于冗余防护。三处逻辑各自演化，改动时容易只改一处。

**`README.md` 的构建命令跑不通。** 第 84 行的 `corepack pnpm build:h5` 在根目录会失败，该 script 只定义在 `apps/client/package.json`。正确写法见第六节。

**`docs/architecture/` 混有废弃路线。** 三份"浏览器IndexedDB到本机SQLite主库迁移"文档共 2838 行，描述的是已被 MySQL 取代的路线，但没放在 `docs/archive/`。

## 五、推荐阅读顺序

按"词汇 → 能力 → 接口 → 存储 → 界面"读，每步都建立在上一步之上：

```text
1. packages/contracts/src/index.ts 与 errors/*  649 行   认证、归属、业务概念与错误契约
2. packages/domain/src/index.ts        102 行   认证纯逻辑、业务错误、标题与状态机
3. packages/application/src/index.ts   678 行   认证、初始归属与业务用例
4. apps/api/src/api-errors.ts          148 行   错误如何分类、映射与上报
5. apps/api/src/index.ts               278 行   当前运行的认证与业务接口
6. packages/storage-mysql/src/index.ts 165 行   事务与迁移基础设施
7. apps/client/src/pages/index/api-client.ts  164 行  认证上下文与传输结果分类
8. apps/client/src/pages/index/index.tsx    2640 行  登录门、页面状态与业务界面（按需查）
```

前六项覆盖当前后端主链路；再读第 7、8 项即可理解 H5 如何接住后端结果。

## 六、常用命令

```bash
corepack pnpm install                                    # 安装依赖
corepack pnpm typecheck                                  # 类型检查
corepack pnpm test                                       # 全部测试（含历史遗留）
corepack pnpm --filter @knowledge-base/client build:h5    # H5 构建
git diff --check                                         # 空白字符检查
```

启动、切库与备份恢复步骤见 `README.md` 与 `docs/product/当前运行事实.md`。涉及真实数据库的操作先读 `AGENTS.md` 的运行时安全铁律。

## 七、结构风险

**`index.tsx` 是巨石文件。** 当前 2640 行，包含 **69 处 `useState`** 和 **42 处 `useEffect`**。登录门、认证上下文、事项池、方法、观察、设置、回收站、搜索、快速捕获及多组页面级错误状态集中在同一个组件。这是目前代码层面最集中的复杂度，也是历史上反复出现渲染性能、状态覆盖和错误处理不一致问题的根源。

**HTTP 实现并存。** 当前运行的是 `main.ts → index.ts` 的原生 Node HTTP 实现；`hono/*` 是未接入启动入口的并行骨架。两者共享错误映射，但路由、decode 和 method/path 判定仍分别实现，继续演进时存在行为漂移风险。

**页面级 unknown-outcome 尚未完全统一。** 快速捕获、补充说明、开始执行和探索主线等路径有独立锁与显式重读；通用 `run()` 只负责识别 unknown-outcome 并显示提示，状态迁移、删除/恢复、方法行动和复盘等组合流程没有统一的专用锁。部分操作还把“写入已确认成功后的刷新失败”与“写入失败”放在同一个组合 `catch` 中。这里记录的是当前事实，不代表本轮要修改这些逻辑。

**认证与业务状态集中。** 登录、退出、会话过期与普通业务 unknown-outcome 都由同一页面组件承接；虽然 API Client 已用认证上下文版本阻止旧认证请求覆盖新上下文，但页面级状态继续增长时仍需防止认证状态与业务草稿相互覆盖。

**逻辑重复三处。** 见第四节动作表条目。
