# 代码地图

> `notes/` 是理解型笔记，不是流程文档。它可以随时修改，不需要产品授权，也不进入封板与归档流程。
>
> 本文回答"哪个文件负责什么、哪些代码是活的"。全部结论由实际代码得出，行数为 2026-07-28 实测值，会随开发变化。

## 一、运行时链路

只有这一条链路是活的：

```text
浏览器 H5 (127.0.0.1:10086)
  ↓  apps/client/src/pages/index/api-client.ts        统一 fetch 封装
  ↓  /api 开发代理
apps/api/src/index.ts                                 HTTP 路由 + 错误映射
  ↓
packages/application/src/index.ts                     用例编排（9 个 Service）
  ↓  packages/contracts/src/index.ts 定义的 Repository 接口
packages/storage-mysql/src/*                          MySQL 实现
  ↓
MySQL (127.0.0.1:3306)
```

具体端口、数据库名与当前 schemaVersion 见 `docs/product/当前运行事实.md`。

## 二、活代码

### 类型与契约层

```text
packages/contracts/src/index.ts            510 行
```

**最值得先读的文件。** 纯类型定义，零运行逻辑，包含两类内容：

- 业务对象：`Item`、`Review`、`Method`、`MethodVersion`、`MethodEvidence`、`MethodApplication`、`ItemStatusEvent`、`ItemLink`、`MethodTombstone`、`ExplorationTrack`
- Repository 接口（端口）：`ItemRepository`、`ReviewRepository`、`MethodRepository`、`BackupRepository` 等，由 storage-mysql 实现

读完这 510 行就掌握了系统的全部数据词汇。备份的三个版本 `BackupDocumentV1/V2/V3` 也在这里，V3 比 V2 多 `explorationTracks` 集合。

### 领域层

```text
packages/domain/src/index.ts                41 行
```

全项目最小的文件，只有两件事：`createId()` 生成 UUID，以及事项状态机 `transitions` 表加三个校验函数。**状态机的唯一定义在这里**，共 8 个状态。

### 应用层

```text
packages/application/src/index.ts          599 行
```

9 个 Service 类，每个对应一块业务能力：

```text
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

两处逻辑重点：`validateV3Data()`（第 108 行）在任何写入之前完成全量校验，这是"断裂引用整体拒绝"的落地点；`buildDashboardReport()`（第 324 行）是纯函数，全部指标在内存计算，不下推到 SQL。

### HTTP 层

```text
apps/api/src/index.ts                      280 行
```

零框架，直接用 Node `http`。结构是三段：

- `createServices()`（第 136 行）：手工装配 Repository 与 Service，全项目唯一的依赖注入点
- `route()`（第 184 行）：一长串 `if` 匹配路由，静态路径在前、正则路径在后
- `mapFailure()`（第 71 行）：把异常映射成 HTTP 状态码与错误码

需要知道的约束都在这里：CORS 白名单只允许一个来源（第 33 行）、普通请求体上限 64 KiB 而备份恢复 16 MiB（第 36 行）、监听地址被硬校验为 `127.0.0.1:32146`（第 276 行）。

`mapFailure()` 有个特点值得留意：它靠**中文错误消息的字符串匹配**来决定状态码（第 79–81 行），比如消息含"已经"就映射 409。改动 Application 层的错误文案会连带改变 HTTP 状态码。

### 存储层

```text
packages/storage-mysql/src/index.ts                    164 行   连接池、事务、迁移、health
packages/storage-mysql/src/item-repository.ts          201 行
packages/storage-mysql/src/exploration-track-repository.ts  234 行
packages/storage-mysql/src/method-repository.ts        224 行
packages/storage-mysql/src/review-workflow-repository.ts    189 行
packages/storage-mysql/src/backup-repository.ts        112 行
packages/storage-mysql/src/review-repository.ts         99 行
packages/storage-mysql/src/method-application-repository.ts  93 行
packages/storage-mysql/src/read-model-repositories.ts   88 行   仪表盘 + 搜索
```

`index.ts` 里的 `runInMySqlTransaction()` 是所有原子操作的基础；`getMySqlHealth()` 支撑 `/health` 返回的库名与 schemaVersion。

### 前端

```text
apps/client/src/pages/index/index.tsx              2357 行   主页面（见第四节风险）
apps/client/src/pages/index/exploration-prototype.tsx  236 行   探索主线模块
apps/client/src/pages/index/api-client.ts           138 行   API 封装
apps/client/src/pages/index/*-state.ts        共 90 行   5 个局部状态模块（各 12-29 行）
apps/client/src/pages/index/index.scss                      全部样式
```

`api-client.ts` 是 **unknown-outcome 机制的实现位置**：写请求（非 GET）在网络异常或 Abort 时抛 `ApiClientUnknownOutcomeError`（第 30 行），绝不自动重试，只提示重新读取确认。读请求失败则正常抛错。理解这个文件就理解了整个"结果未知不伪造成功"的设计。

### 数据库迁移

```text
migrations/001_initial_schema.sql
migrations/002_add_system_metadata.sql
migrations/003_method_lifecycle_constraints.sql
migrations/004_add_exploration_tracks.sql
```

已全部应用，运行库当前 schemaVersion = 4。这些文件**不可修改**，包括格式调整。

## 三、死代码与历史资产

这部分**不参与运行**，读代码时可以直接跳过。它们仍在仓库里是因为清理需要走产品授权流程。

```text
packages/storage-indexeddb/src/index.ts     931 行   浏览器时代的存储实现
packages/storage-sqlite/src/*               680 行   SQLite 路线的存储实现
apps/local-api/src/*                        152 行   SQLite 路线的 API 服务
```

合计 **1763 行，占全部代码的 23.3%**。三条判定依据：

- `storage-indexeddb` 仍在 `apps/client/package.json` 声明为依赖，但客户端源码**零引用**（幽灵依赖）
- `storage-sqlite` 只被 `apps/local-api` 和测试引用
- `apps/local-api` 没有任何启动脚本引用它（`package.json`、`docker-compose.yml`、`Dockerfile` 均无）

`storage-indexeddb/src/index.ts` 是全项目第二大文件，容易被误认为核心模块，实际已完全停用。

测试里也有大量历史遗留：57 个测试文件中 **28 个**依赖上述废弃存储，而 `pnpm test` 默认全量执行。

## 四、代码与文档的已知偏离

代码是准的，以下几处文档没跟上。

**"待复盘"状态实际已不可达。** `docs/product/功能清单-v4.md` 说"执行完成后进入待复盘"，但 `packages/domain` 的状态机里 `doing` 的合法去向是 `paused / archived_no_review / abandoned`，**不含 `waiting_review`**。完成复盘由 `completeReview` 从 `doing` 直接迁移到 `reviewed`。前端界面对这个状态的标签就是"待完成复盘（历史）"（`index.tsx` 第 33 行），变量名叫 `historicalWaitingReviewCount`。所以 `waiting_review` 只存在于历史数据中，代码已如实反映，产品文档还是旧描述。

**动作表存在两份且不一致。** `ItemApplicationService.actionsFor()`（application 第 595 行）在运行路径中**从未被调用**——API 没有暴露它。前端用的是 `api-client.ts` 第 76 行自己的一份，两者内容已经漂移：Application 版给 `idea_to_try` 和 `doing` 提供"放弃"按钮，前端版没有。更麻烦的是 `index.tsx` 第 2211 行又加了一层过滤，把 `abandoned` 从这两个状态里排除——过滤的是前端版本里本来就不存在的项，属于冗余防护。三处逻辑各自演化，改动时容易只改一处。

**`README.md` 的构建命令跑不通。** 第 84 行的 `corepack pnpm build:h5` 在根目录会失败，该 script 只定义在 `apps/client/package.json`。正确写法见第六节。

**`docs/architecture/` 混有废弃路线。** 三份"浏览器IndexedDB到本机SQLite主库迁移"文档共 2838 行，描述的是已被 MySQL 取代的路线，但没放在 `docs/archive/`。

## 五、推荐阅读顺序

按"词汇 → 能力 → 接口 → 存储 → 界面"读，每步都建立在上一步之上：

```text
1. packages/contracts/src/index.ts     510 行   系统里有哪些业务概念
2. packages/domain/src/index.ts         41 行   状态机与合法迁移
3. packages/application/src/index.ts   599 行   系统能做哪些操作
4. apps/api/src/index.ts               280 行   对外接口全貌
5. packages/storage-mysql/src/index.ts 164 行   事务与迁移基础设施
6. apps/client/src/pages/index/api-client.ts  138 行  前端如何调用、unknown-outcome
7. apps/client/src/pages/index/index.tsx    2357 行  界面（按需查，勿通读）
```

前六项合计约 1730 行，读完即掌握后端全貌。

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

**`index.tsx` 是巨石文件。** 2357 行占全部代码的 31%，其中 `IndexPage` 单个组件包含 **98 个 `useState`** 和 **42 个 `useEffect`**，从第 125 行一直延伸到文件末尾。事项池、方法、观察、设置、回收站、搜索、快速捕获全部塞在这一个组件里。这是目前代码层面最集中的复杂度，也是历史上反复出现渲染性能与状态覆盖问题的根源（相关热修复记录见 `docs/product/当前运行事实.md` 的 V1.1.1、V1.1.2 段落）。

**HTTP 状态码依赖中文文案匹配。** 见第二节 `mapFailure()` 的说明，改错误文案会静默改变状态码。

**逻辑重复三处。** 见第四节动作表条目。
