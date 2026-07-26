# 探索主线 V1 S1：Schema 004 总体稳定审阅与 UAT 部署授权

> 日期：2026-07-24
>
> 结论：**S1 Schema 004 的 migration 机制、正式 DDL、权限和集成测试隔离满足稳定性与数据可信性要求。书面授权仅对 `knowledge_base_uat` 执行一次受控 004 部署与 QA 验收。基础 Contracts 必须等待该 UAT 部署及 QA 通过后另行授权。**
>
> 当前运行事实以 `docs/product/当前运行事实.md` 为准。

## 【总体稳定审阅结论：通过，有条件部署】

以下证据已形成闭环：

```text
004 预检：表、列、三个冻结索引、外键任一存在时，均在任一 004 DDL 前失败。
预检失败：schema_migrations 只保留 001 / 002 / 003，未写入 004，app 仍 DML-only。
004 正式 DDL：随机临时库成功执行，schema_migrations 为 001–004。
DDL 事实：表、列、三个索引、外键均经 information_schema 验证。
迁移可信性：重跑幂等、004 checksum 漂移拒绝、app DDL 拒绝均通过。
MySQL 集成：test:mysql:integration 使用 --no-file-parallelism，12 files / 110 tests 通过。
P1 隔离：停写窗口内，knowledge_base 与 knowledge_base_uat 的 schema_migrations、十个业务集合、完整记录、稳定排序 SHA-256 与 system_metadata 前后快照均为 SNAPSHOTS_IDENTICAL。
```

因此，004 在临时库中已证明具备：DDL 前完整对象集合预检、正确 DDL、migration 记录可信性、最小权限以及不污染运行库的测试隔离。

但这仍不是探索主线业务能力验收：目前没有基础 Contracts、Repository、Application、API、H5 或 Backup V3 业务实现。UAT 部署只验证 Schema 004 在隔离运行环境中的受控落地。

## 【运行库裁决】

```text
knowledge_base：schemaVersion 4，是历史 M1 测试造成的既成现场状态。
knowledge_base_uat：schemaVersion 3，现获一次受控 004 部署授权。
```

`knowledge_base` 必须保留现状：

```text
禁止 DDL 回退。
禁止以自动化测试、migration、清库、恢复或合成业务写入继续触及。
不把 schemaVersion 4 解释为 S1、Contracts 或探索主线功能已验收。
```

此前 `knowledge_base.items 459 → 534` 的历史增量不可可靠归因，继续保留为事实；不得清理、回填或恢复。

## 【本次唯一部署授权】

仅授权对下列目标执行一次 migration：

```text
显式加载 .env.uat
→ MYSQL_DATABASE = knowledge_base_uat
→ 运行既有 db:migrate / migration runner
→ 执行 migrations/004_add_exploration_tracks.sql
```

不得使用 `.env`，不得运行或触及 `knowledge_base`。每个 API 进程仍只能连接一个业务 database。

### 部署前硬门

部署负责人必须按顺序完成：

```text
1. 停止 H5 与 API，确认 127.0.0.1:10086、127.0.0.1:32146 无监听。
2. 确认无 UAT 人工验收、backup restore、清库、破坏性测试或其他 MySQL 写入并行进行。
3. 显式加载 .env.uat；输出并人工确认 MYSQL_HOST、MYSQL_PORT、MYSQL_DATABASE，目标必须为 127.0.0.1:3306 / knowledge_base_uat。
4. 使用只读连接确认：knowledge_base_uat 的 schema_migrations 精确为 001 / 002 / 003；
   exploration_tracks、items.exploration_track_id、三个冻结索引、指定外键均不存在。
5. 获取 knowledge_base 的只读保护快照：schema_migrations、十个业务集合、system_metadata；不得对日常库写入。
6. 获取 knowledge_base_uat 部署前快照：schema_migrations、十个业务集合、system_metadata。
```

如第 3、4 任一项不符合，停止部署并报告；不得通过手工 DDL、删除 migration records、`IF NOT EXISTS` 或关闭外键检查修复。

### 部署执行与验收

```text
7. 仅以 migrator 身份对 knowledge_base_uat 执行 migration runner。
8. 读取 schema_migrations：必须精确为 001 / 002 / 003 / 004，且 004 文件名与 SHA-256 checksum 匹配当前正式文件。
9. 以 information_schema 验证 exploration_tracks、items.exploration_track_id、三个冻结索引、items_exploration_track_fk 的存在与定义。
10. app 用户验证 DML-only：尝试 DDL 必须被 ER_TABLEACCESS_DENIED_ERROR 拒绝。
11. 使用 .env.uat 启动或临时创建 API health 探针，确认 database = knowledge_base_uat、schemaVersion = 4；不得连接 knowledge_base。
12. 再次运行 migration runner，确认幂等成功、无重复 DDL、schema_migrations 不重复。
13. 复取 knowledge_base 保护快照，必须与部署前完全相同。
14. 对 knowledge_base_uat 比较部署前后快照：除 schema_migrations 新增 004、exploration_tracks 空表、items 新增空 exploration_track_id 列及索引 / 外键所对应的 Schema 差异外，十个既有业务集合与 system_metadata 内容必须完全相同。
```

UAT 内不存在 Contracts 或业务写入，因此不应出现新的 Track 记录、Item 关联或业务数据改变。

### 失败处置

```text
004 预检失败：不执行 DDL、不写 004；保留快照与错误，停止。
DDL 失败：停止，不执行补偿 DDL、回退、重试或手工修表；保留 information_schema、schema_migrations 与日志，重新进入架构裁决。
迁移后定义 / 权限 / health 验证失败：停止，不启动 H5/API，不做业务写入；保留证据，重新裁决。
knowledge_base 快照有任何差异：按 P1 环境污染处理，停止并保留证据。
```

## 【允许修改范围】

本授权优先允许**执行**既有 migration，不授权新业务编码。必要的验证脚本、QA 报告与记录仅可修改：

```text
scripts/**（仅 UAT 004 部署前检查、只读快照或验证脚本；不修改业务运行脚本）
tests/**（仅部署验证辅助；不得修改业务测试语义）
docs/architecture/**
docs/product/当前运行事实.md（仅在部署实际完成后更新状态）
docs/daily-contributions/YYYY-MM-DD.md
```

不得修改：

```text
migrations/**
packages/contracts/**
packages/domain/**
packages/application/**
packages/storage-mysql/src/**
apps/api/**
apps/client/**
BackupData / BackupDocumentV3
MySQL Compose、用户、权限、端口和运行组合
```

若现有命令已能完成上述核验，优先不新增脚本。

## 【QA 验收门】

QA 必须独立确认：

```text
实际目标是 knowledge_base_uat，而非 knowledge_base。
执行前目标 UAT 为 schemaVersion 3，执行后为 schemaVersion 4。
004 的 records、checksum、表 / 列 / 索引 / 外键与冻结 DDL 一致。
004 幂等、app DML-only、API health database/schemaVersion 均正确。
UAT 既有十个业务集合和 system_metadata 未被迁移改写。
knowledge_base 前后保护快照完全一致。
无 H5 / API 业务写入、无清库、无 restore、无 DDL 回退。
```

只有 QA 通过且架构复审确认后，才可讨论 S1 基础 Contracts 的独立实施授权。

## 【持续冻结】

在 UAT 部署 QA 通过与下一份书面授权前，持续禁止：

```text
基础 Contracts。
S2、S3、Repository、Application、API、H5、Backup V3。
对 knowledge_base 运行 migration、DDL 回退、清库、恢复或测试业务写入。
对 knowledge_base_uat 执行除本授权外的 migration、清库、restore 或业务写入。
双写、同步、回填、fallback、浏览器直连 MySQL。
多主线关联、自动推断、进度、计划、日期、提醒、子任务。
```
