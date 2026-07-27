# 探索主线 V1：数据 / Application / Repository 实施任务书（封板后生效）

> 状态：**已冻结，暂不生效；当前禁止业务编码。**
>
> 生效门：仅在 MySQL 快速接入 Sprint 完成正式封板、当前运行事实同步且产品书面解除探索主线编码禁令后生效。
>
> 冻结依据：`docs/product/当前运行事实.md`、`docs/product/探索主线-V1-设计冻结正式验收结论.md`、`docs/product/探索主线-V1-API契约产品确认结论.md`、`docs/architecture/探索主线-V1最小架构评审与技术任务书.md`、`docs/architecture/探索主线-V1-API路由矩阵与DTO补充冻结.md`、`docs/design/探索主线-V1-交互与视觉设计冻结.md`。

## 【技术结论】

**有条件可行。**探索主线是新的长期业务对象，且 Item 与它存在唯一可信的 `0..1` 结构化关系。必须以 MySQL Schema、Contracts、Repository、Application 事务编排、API 读模型与 Backup V3 共同表达；不得由前端状态、标题、时间、文案、相似性或缓存推断关系。

当前运行事实在生效前保持：

```text
H5 → loopback Node API（127.0.0.1:32146）→ Application → MySQL
MySQL = 当前 H5 运行数据源
日常库 = 127.0.0.1:3306 / knowledge_base
UAT 库 = 127.0.0.1:3306 / knowledge_base_uat
IndexedDB 不参与当前 H5 运行时业务读写
SQLite = 实验 / 测试资产
```

本任务书不改变上述运行边界，也不授权在当前 MySQL 快速接入 Sprint 封板前开始任何探索主线业务代码。

## 【冻结业务不变量】

```text
一条探索主线仅包含名称，可以为空主线。
一条 Item 只可关联 0 或 1 条探索主线；一条主线可关联 0 至多条 Item。
关联只能由用户明确创建、调整或移除。
主线只软删除和恢复；V1 不支持物理永久清理、墓碑或级联清理。
删除或恢复主线不得改写 Item、Review、Method、ItemLink、状态事件或备份中的既有事实。
删除 Item 仅进入既有回收站；恢复 Item 保留原 explorationTrackId。
状态机、复盘、方法、回收站和 BackupData 的既有语义不变。
```

名称规则固定在 Application：显示名执行 Unicode NFKC 后 trim；规范名为显示名 lower-case；按 Unicode code point 计长度为 1 至 80；规范名在全部未物理删除记录中全局唯一，包含软删除主线。删除不释放名称。

## 【实施切片与授权顺序】

### S1：Schema 004 与基础 Contracts

**目标**：仅建立可信存储边界和类型契约，不接入前端。

1. 新增 `migrations/004_add_exploration_tracks.sql`，在两个 database 独立执行：

```sql
CREATE TABLE exploration_tracks (
  id VARCHAR(128) NOT NULL,
  name VARCHAR(80) NOT NULL,
  normalized_name VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY exploration_tracks_normalized_name_unique (normalized_name),
  KEY exploration_tracks_active_updated_idx (deleted_at, updated_at DESC)
) ENGINE=InnoDB;

ALTER TABLE items
  ADD COLUMN exploration_track_id VARCHAR(128) NULL,
  ADD KEY items_exploration_track_created_idx (exploration_track_id, created_at DESC),
  ADD CONSTRAINT items_exploration_track_fk
    FOREIGN KEY (exploration_track_id) REFERENCES exploration_tracks(id);
```

2. DDL 必须沿用现有 migration runner 的 checksum、advisory lock、版本记录与 migrator 权限边界；app 用户仍为 DML-only。
3. migration 前预检 `exploration_tracks`、新增列、索引、外键均不存在。预检失败或 DDL 失败时，不得写入 004 成功记录。
4. 不得修改已执行 migration；MySQL DDL 不保证可事务回滚，因此仅允许在临时测试库通过反向 DDL 重建验证。不得为日常库或 UAT 库提供撤销脚本。
5. 新增 Contracts：`ExplorationTrack`、`ExplorationTrackSelection`、`ItemExplorationTrackContext`、主线列表 / 历史 / 当前关联事项读模型、BackupDocumentV3 与 BackupDataV3。
6. `items.exploration_track_id = NULL` 是唯一无关联事实；不做历史回填、数据迁移或标题匹配。

**S1 验收门**：日常与 UAT 的临时独立库可各自执行 001–004；004 幂等、checksum 漂移拒绝、advisory lock 与 app DML-only 回归通过；现存 Item 的关联均为 NULL；无业务运行组合或前端改动。

### S2：Repository、Application 与原子工作流

**目标**：实现所有主线写入和结构化读模型；所有跨对象写入只在 Application / Workflow 指定的单一 MySQL transaction 中完成。

#### Repository 边界

新增：

```text
ExplorationTrackRepository
ExplorationTrackWorkflowRepository
MySQL Backup Repository 的 V3 映射和恢复实现
```

Repository 只以如下结构化键读取关系：

```text
exploration_tracks.id
items.exploration_track_id
reviews.item_id
```

不得使用标题、时间、版本、状态文案、计数、文本或相似度补关系。

#### Application 能力

实现并冻结以下语义：

```text
createExplorationTrack(name)
renameExplorationTrack(id, name)
deleteExplorationTrack(id)
restoreExplorationTrack(id)
listActiveExplorationTracks()
listSelectableExplorationTracks()
listDeletedExplorationTracks()
getExplorationTrackHistory(id)
getItemExplorationTrackContext(itemId)
assignItemToExplorationTrack(itemId, trackId)
removeItemFromExplorationTrack(itemId)
createItemWithExplorationTrack(captureInput, selection)
listItemsByExplorationTrackAndStatus(trackId, status)
```

扩展既有 `captureIdea()`：无 `explorationTrack` 时完全保持现有 `createIdea` 行为；存在 `existing` 或 `new` selection 时，只能委派至 `createItemWithExplorationTrack()`，不得由 API 或前端以多次写入拼接。

#### 锁、事务与生命周期

| 场景 | 事务与锁 | 冻结结果 |
|---|---|---|
| 创建空主线 / 改名 | 规范化后检查同规范名；依靠唯一键处理并发竞争 | 冲突映射为稳定同名错误，零半成品 |
| 删除主线 | `SELECT track FOR UPDATE` | 仅更新 `deleted_at`、`updated_at` |
| 恢复主线 | `SELECT track FOR UPDATE` 后检查名称唯一性 | 仅清空 `deleted_at`；冲突拒绝 |
| 创建 Item + existing Track | 锁 active Track → 插入 Item（关联 ID）→ 插入初始 Event | 一次提交；任何失败全回滚 |
| 创建 Track + Item | 规范化、唯一竞争保护 → 插入 Track → Item → 初始 Event | 一次提交；仅本次新 Track 随失败回滚 |
| 调整关联 | 锁 active、未删除 Item → 锁 active Track → 更新外键 | 每 Item 唯一关联；最后一个基于最新锁定状态提交的明确操作生效 |
| 移除关联 | 锁 active、未删除 Item → 将外键置 NULL | 不删 Track，不改写其他历史事实 |

`createItemWithExplorationTrack()` 的精确顺序：

```text
BEGIN
→ existing：SELECT active exploration track FOR UPDATE
  或 new：规范化、名称冲突保护、INSERT exploration track
→ INSERT Item（exploration_track_id = 实际 Track ID）
→ INSERT 初始 ItemStatusEvent
→ COMMIT
```

初始 Event、Item 插入、Track 插入或 commit 前连接中断均必须 rollback。失败不得留下 Track（仅限本次 new）、Item、关联字段或 Event；existing Track 不能被改写。

主线已删除、Item 已删除 / 不存在、Track 不存在时，关联写入拒绝且零副作用。`unavailable` 表示已存在非 NULL 外键但目标 Track 无法读取的异常结构化事实；它不是无关联，前端和 API 均不得自动清空、覆盖、重连或创建替代 Track。该状态只允许重试读取与受控诊断，关联调整 / 移除必须拒绝。

#### 读模型

Application 负责返回完整结构化投影：

```text
活跃列表：deletedAt 缺失；updatedAt DESC, id ASC；每条最多一个真实最新关联 Item。
可选列表：仅 active；normalizedName ASC, id ASC。
已删除列表：仅 deleted；deletedAt DESC, id ASC；只读，无数量、无永久删除。
主线 history：历史、abandonedHistory、currentAssociatedItems。
```

详情内嵌 `currentAssociatedItems` 固定：

```text
状态顺序：doing → idea_to_try → idea_later → paused
每组最多 3 条：createdAt DESC, id ASC
超限仅返回 hasMore 与 { status, explorationTrackId } moreLocator
所有组为空时返回 []
```

历史固定：未删除且非 `abandoned` 的 Item 进入 `history`；未删除且 `abandoned` 的 Item 进入 `abandonedHistory`；回收站 Item 不返回。复盘摘要只来自真实 `reviews.item_id` 和 `actualAction` / `result`；无法提供可靠摘要时返回 `reviewSummaryStatus: unavailable`，不得伪造文本。

受限定位查询只接受 `status` 与 `explorationTrackId` 同时存在，状态限于四个 current 状态；按 `updatedAt DESC, id ASC` 返回真实未删除且精确关联的 Items。已删除 Track 仍可读取以解释历史。

**S2 验收门**：所有 Application / Repository 单元与真实 MySQL 集成测试通过；主线、Item、Review、Method、ItemLink、Event 的删除 / 恢复快照符合零改写规则；所有故障注入均证明事务全回滚；尚不允许 H5 UI 接入。

### S3：Backup V3、API 实现与契约测试

**目标**：实现 V3 备份可靠恢复和已冻结 API 矩阵，不改变 HTTP 以外的业务语义。

#### Backup V3

V3 增加第十个业务集合：

```ts
interface BackupDataV3 extends BackupDataV2 {
  explorationTracks: ExplorationTrack[]
}
```

冻结兼容性：

```text
V1 / V2 导入 → explorationTracks 归一为 []，所有 Item 的 explorationTrackId 视为缺失。
V3 导入 → 必须含 explorationTracks；保留 Track、deletedAt 与 Item 关联。
```

不得修改 V1 / V2 format、version 或原业务含义；不得把 V3 字段偷偷加入 V2。

`parseAndValidate()` 必须在事务前完成。V3 校验至少覆盖：

```text
Track ID、名称、规范名、时间和 deletedAt 格式合法。
名称规范化重算后与 normalizedName 相等。
Track ID 唯一；normalizedName 全局唯一，含 deleted Track。
每个 Item.explorationTrackId 若存在，必须指向同一备份中的 Track，允许该 Track 已软删除。
既有九集合的引用、重复与格式校验完全保持。
```

任何断裂 Track / Item 引用或其他非法关系必须整体拒绝，十个业务集合零写入。

`replaceData()` 必须为单一 MySQL DML transaction：

```text
parseAndValidate()
→ 清理现有业务集合（先依赖表与 Items，再 exploration_tracks）
→ 导入 exploration_tracks
→ 导入 Items（含 exploration_track_id）
→ 按现有顺序导入 Reviews / Methods / Versions / Evidence /
  Applications / Tombstones / Links / Events
→ COMMIT
```

末端失败必须回滚全部十个业务集合；`system_metadata` 不导出、不清理、不恢复、不覆盖。

#### API 实现

只实现已冻结矩阵：

```text
GET    /api/v1/exploration-tracks
GET    /api/v1/exploration-tracks/selectable
GET    /api/v1/exploration-tracks/deleted
GET    /api/v1/exploration-tracks/:id/history
POST   /api/v1/exploration-tracks
PATCH  /api/v1/exploration-tracks/:id
DELETE /api/v1/exploration-tracks/:id
POST   /api/v1/exploration-tracks/:id/restore

POST   /api/v1/items（仅扩展 explorationTrack 可选 DTO）
GET    /api/v1/items/:id/exploration-track
PUT    /api/v1/items/:id/exploration-track
DELETE /api/v1/items/:id/exploration-track
GET    /api/v1/items?status=<冻结状态>&explorationTrackId=<id>
```

API route 仅负责 decode、Content-Type / body / URL 限制、DTO 映射、调用 Application、统一错误 DTO 和 requestId；不得直连 SQL、pool、Repository，不得自行加锁或编排事务。

所有响应保持：

```text
Content-Type: application/json; charset=utf-8
Cache-Control: no-store
X-Request-Id
```

普通 JSON 最大 64 KiB；既有 Backup restore 16 MiB 限制继续适用于 V3。

错误映射固定：

| HTTP | code | 语义 |
|---:|---|---|
| 400 | `VALIDATION_FAILED` | 非法 JSON / 参数 / selection / 状态，名称空白或超 80 字符 |
| 404 | `NOT_FOUND` | 已确认不存在的对象或不允许的生命周期操作 |
| 409 | `CONFLICT` | 包含 deleted Track 的同规范名冲突、唯一键竞争或稳定关系冲突 |
| 503 | `MYSQL_SCHEMA_NOT_READY` / `MYSQL_UNAVAILABLE` | Schema 未就绪或可证明的 MySQL / pool / connection 不可用 |
| 500 | `INTERNAL_ERROR` | 未分类且脱敏的异常 |

不得泄露 SQL、driver 原文、stack、host、port、database、账号、凭据、migration、pool 或 `system_metadata`。

所有写请求无 idempotency key。浏览器超时、断线、页面关闭或响应丢失时：禁止自动重试、禁止按草稿判断成功 / 失败、必须保留草稿并重新读取真实 API 事实确认。不得新增客户端或 API 侧“补偿写入”。

**S3 验收门**：V1 / V2 / V3 备份兼容与 V3 十集合恢复测试通过；所有 API 路由和错误契约由真实 MySQL 集成测试覆盖；H5 只在 S3 后接入，且必须按设计冻结实现。

## 【自动化测试矩阵与高风险回归】

| 类别 | 必测场景 |
|---|---|
| Migration 004 | 日常与 UAT 临时独立库执行；幂等；checksum 漂移拒绝；advisory lock；预检失败无 004 成功记录；app 无 DDL 权限 |
| 名称 | 空白、81 code point、NFKC 等价、大小写等价、并发同名创建、改名冲突、软删除后同名创建冲突、恢复冲突 |
| 主线生命周期 | 创建空主线、改名、软删除、恢复；删除 / 恢复前后 Item / Review / Method / Link / Event 快照零变化 |
| 原子捕获 | 无 selection 的旧 Contract；existing；new；Item 失败、Event 失败、Track 插入失败、commit 前中断；全量回滚对比 |
| 关联写入 | 归入、改归入、移除；已删除 / 不存在 Track 与已删除 / 不存在 Item 拒绝；同 Item 并发调整；一 Item 仅一关联 |
| 读模型 | 活跃 / selectable / deleted 隔离与排序；空主线；最新 Item；四组 current 投影、3 条上限和 moreLocator；abandoned 收纳；回收站隐藏；真实 Review 摘要 / unavailable；track-deleted 与 unavailable 区分 |
| 交叉生命周期 | 主线删除 / 恢复、Item 删除 / 恢复的任意交错；关联不丢失、不重建、不伪造；deleted Track 不进入可选列表 |
| Backup | V1 / V2 安全降级；V3 导出—清空—恢复—导出规范化等价；Track ID / 名称 / 规范名 / Item 引用非法时事务前拒绝零写入；末端写入失败回滚十集合；metadata 隔离 |
| API | 全路由矩阵、DTO、64 KiB / 16 MiB 边界、400 / 404 / 409 / 503 / 500、requestId、no-store、脱敏、无额外管理 / purge / metadata 路由、unknown-outcome 不自动重试 |
| UAT 隔离 | `.env.uat` 下 migration、reset、恢复和破坏性失败注入仅触及 `knowledge_base_uat`；`knowledge_base` 数据与 schema_migrations 快照不变；API 单进程 `/health` 只报告其启动时选定 database |
| H5 回归（后续） | 仅 loopback API；加载 / 空态 / 错误态；草稿和新名称暂存；取消零写入；最新请求胜出；unknown-outcome 后重新读取；Network / Storage 不出现 IndexedDB fallback |

高风险回归优先级：跨对象创建原子性、软删除后关系保留、`unavailable` 不被降级为无关联、V1/V2 旧备份安全降级、V3 断裂引用零写入、UAT 清库不污染日常库。

## 【日常库与 UAT 隔离】

```text
日常：显式加载 .env → 127.0.0.1:3306 / knowledge_base
UAT：显式加载 .env.uat → 127.0.0.1:3306 / knowledge_base_uat
```

- 每次 migration、API、恢复或破坏性测试启动前，读取目标连接配置并验证实际目标 database；一个 API 进程不得同时连接两个业务库。
- 004 必须分别迁移两个库，且各自拥有独立 `schema_migrations` 记录与 checksum 验证。
- 仅 UAT 可执行清库、恢复、故障注入和破坏性测试；脚本必须显式拒绝非 `knowledge_base_uat` 的 reset 目标。
- 日常库验证只能使用非破坏性合成数据或经用户明确批准的操作；不得由 UAT 脚本、测试清理或 restore 触及。
- API 仅监听 `127.0.0.1:32146`，MySQL 仅 `127.0.0.1:3306`；CORS 仅 `http://127.0.0.1:10086`；浏览器不取得 MySQL 凭据。

## 【允许修改的层与文件范围】

封板后、按 S1 → S3 顺序允许修改：

```text
migrations/004_add_exploration_tracks.sql
packages/contracts/src/**
packages/domain/**（仅名称规范化与无状态校验）
packages/application/src/**
packages/storage-mysql/src/**
apps/api/src/**
apps/client/src/**（仅在 S3 API 完成、设计冻结仍有效后）
tests/**
docs/architecture/**
docs/product/**（仅当前事实或验收真实变化时）
docs/daily-contributions/YYYY-MM-DD.md
```

每次完成工程验证或 H5 人工验收，按项目规则在当天贡献记录追加实际增加项、修复项、未完成项；不得用该记录替代验收。

## 【明确禁止事项】

```text
在 MySQL 快速接入 Sprint 正式封板前编码。
修改既有 Item 状态机、ReviewWorkflow、Method、ItemLink 或回收站业务语义。
修改 IndexedDB 或 SQLite Repository、MySQL 容器 / 端口 / 权限与远程访问配置。
双写、同步、回填、fallback、数据合并展示、浏览器直连 MySQL。
真实 IndexedDB 历史数据迁移。
物理 purge 主线、主线 tombstone、级联删除或自动解除关联。
多主线关联、子任务、进度、完成率、计划、日期、提醒、AI 推荐、自动归类或自动推断。
新增未冻结 API 路由、全局任意筛选平台、计数或分页总数。
将未知写入结果自动重试，或以本地草稿伪造成功 / 失败。
```

## 【实施前置检查清单】

开始任何代码修改前，研发负责人必须逐项确认：

```text
[ ] 当前 MySQL 快速接入 Sprint 已由产品正式封板；当前运行事实已同步。
[ ] 产品正式验收结论、API 契约确认、设计冻结稿仍为有效版本，且未出现冲突更新。
[ ] 本任务书已作为 S1–S3 实施唯一技术边界，产品书面解除“探索主线禁止编码”。
[ ] 004 仅为新增 migration，未触碰既有 migration、Schema 业务结构或运行环境配置。
[ ] 日常和 UAT 的目标 database、migrator / app 权限及 UAT reset 防护已实测确认。
[ ] Backup V3 是明确版本演进，V1 / V2 兼容和 system_metadata 隔离测试计划已具备。
[ ] API 路由矩阵没有新增范围；前端尚未在 S1 / S2 提前接入。
[ ] 当前 H5 / API 健康检查确认所连接 database 与本次操作目标一致。
```

## 【交付给数据 / Application / Repository 工程师的实施任务书】

在上述前置全满足后，按 S1、S2、S3 严格顺序实施；每个切片先完成真实 MySQL 定向测试、再运行相关回归。不得跳过 S1 直接做 API 或前端，也不得将 Schema、Backup、Application、API 与 H5 无边界混合提交。

每个切片交付需报告：

```text
修改文件
新增 / 修改的 Contracts
事务、锁、失败回滚与缺失关联处理
日常 / UAT 实际目标 database 与隔离证据
自动化测试场景及命令结果
typecheck / test / build:h5 / git diff --check 结果
确认未修改的冻结边界
待架构或产品裁决的问题
```

任何发现需要改变 0..1 关系、软删除语义、名称全生命周期唯一、状态机、复盘、方法、回收站、Backup 可信性、API 矩阵或运行环境的情况，必须停止实施并重新走产品与架构评审；不得以实现便利自行扩张。
