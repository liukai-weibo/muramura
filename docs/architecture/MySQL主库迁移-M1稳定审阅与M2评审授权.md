# MySQL 主库迁移 — M1 稳定审阅与 M2 评审授权

> 状态：**M1 已封板。允许产品经理发起 M2 评审；未授权 M2 实施。**
>
> 本结论基于 M1 实现与测试审阅。它不改变当前运行主库：IndexedDB 仍是唯一运行主库，MySQL 仍是候选主库，仅用于开发与合成测试。

## 【架构结论：通过】

M1 已证明 MySQL 候选基础设施具备进入 Repository 候选实现评审的最低条件：持久化容器运行、最小权限、可审计 migration、独立 app 连接池和脱敏健康检查均已建立。

本结论不表示 MySQL 已通过业务语义、备份恢复、真实迁移或前端运行时切换验证。

## 【M1 封板边界】

已冻结并通过审阅的事实：

```text
MySQL 8.4
→ 仅 127.0.0.1:3307:3306 暴露
→ named volume /var/lib/mysql
→ root、migrator、app 三类身份隔离
→ checksum + advisory lock 的 SQL migration runner
→ app pool 专用 GET /health
```

具体确认：

- `knowledge_base_app` 仅有目标库 DML 权限；没有 DDL 或读取 `mysql.user` 的权限。
- API 连接池使用 app 身份；migration runner 使用 migrator 身份；root 不进入常驻应用路径。
- `001_initial_schema.sql` 覆盖九集合和 `schema_migrations`，未对需要墓碑解释的 MethodEvidence / MethodApplication 建立会阻断方法永久清理的硬外键。
- `/health` 能区分 MySQL 不可用与 Schema 未就绪，且失败响应不泄露连接、密码、SQL、堆栈或业务数据。
- 已执行 migration 的 checksum 漂移会失败；API 不自动迁移。
- named volume 经容器重启后的合成记录保留验证。

## 【迁移语义勘误】

M1 任务书中“每一个 SQL migration 与其 `schema_migrations` 插入处于单一 transaction、失败则 rollback”的表述，不可作为 MySQL DDL 的一致性承诺。

MySQL DDL 存在隐式提交；当前 runner 采用 advisory lock、逐语句执行与成功后写入 migration record，这符合 M1 的初始建表范围，但不提供可回滚 DDL 的保证。

后续冻结规则：

```text
已执行 migration 不可修改
→ checksum 漂移 fail-fast
→ 破坏性或数据重写 migration 必须单独评审
→ 具备备份、预检、演练与前向修复方案
→ 不得以业务 DML transaction 的全回滚语义描述 MySQL DDL
```

M2 不得新增或修改 Schema migration，除非重新完成架构评审。

## 【是否允许产品经理发起 M2 评审：允许】

允许发起 M2 的产品和架构评审，**不等于允许直接编写 M2 代码**。M2 任务书必须先冻结 Repository 契约映射、事务边界、失败语义、备份等价性和自动化验收。

## 【M2 允许范围】

M2 仅可评审和实施候选 MySQL Repository，建议分两段：

```text
M2-A
Item Repository：读写、状态迁移、启动动作、删除/恢复、状态事件原子性

M2-B
Review Repository + Backup Repository：Review 基础读写、九集合导入导出、替换回滚、元数据隔离
```

允许修改的层：

```text
packages/storage-mysql/**
tests/mysql-m2*.test.ts
必要时：migrations/**（仅经新架构评审）
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

现有 Contracts 仅允许为 MySQL Repository 复用；不得借 M2 改变业务语义、状态机、证据关系、备份格式或 Application 运行组合。

## 【M2 禁止边界】

```text
apps/client/**
前端 HTTP Client
MySQL 业务 HTTP API
IndexedDB → MySQL 真实迁移
IndexedDB / MySQL 双写
主库切换
浏览器直连 MySQL
Kubernetes、云端、账号、远程访问或同步能力
SQLite 既有资产的改造或删除
```

当前持续成立：

```text
IndexedDB = 唯一运行主库
MySQL = 候选 Repository / 合成测试存储
```

## 【M2 必须验证】

- 每项业务写入使用单一 MySQL DML transaction；失败后无 Item、Review、状态事件或关联记录半写入。
- `completeReview()`、`startExecution()`、删除/恢复与永久清理等 P0 交错语义，必须按既有 Contract 实证，不得从时间、文案或版本号推断关系。
- `BackupData` 九集合的导出与导入必须逐集合规范化等价；非法备份在写入前拒绝，替换失败整体回滚，基础设施元数据不得混入业务备份。
- 方法墓碑、历史版本、证据和应用关系不得被错误硬外键或 cascade 误删。
- 所有集成测试必须使用 app / migrator 的正确身份；不得用 root 绕过 Repository 权限边界。

## 【风险与保护策略】

1. MySQL M1 的集成测试依赖本地 `.env`；未加载时会明确跳过。合并或发布门槛必须在受控环境中真实运行该套集成测试，不能将跳过结果视为通过。
2. `mysql:8.4` 当前使用 LTS 标签。进入共享环境、CI 或 Kubernetes 前必须固定到经验证的 patch 或 digest，并建立升级演练策略。
3. Docker named volume 保护容器重启，不等于备份策略。真实数据进入 MySQL 前，必须另行评审逻辑备份、恢复演练、保留策略与灾难恢复责任边界。
4. 当前 app 用户授权 `DELETE` 是业务回收站与后续清理的必要 DML 能力；M2 必须将永久清理保持为明确、可测试的 Repository 编排，不能由数据库 cascade 替代。

## 【下一责任岗】

**产品经理 → 架构师。**

产品经理先定义 M2 的最小业务切片、非目标与验收；随后架构师冻结 M2-A / M2-B 的契约、事务与测试任务书。

## 【是否允许写代码】

**否。** 目前仅授权发起 M2 评审，不授权 M2 实施。
