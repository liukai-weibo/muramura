# MySQL 主库迁移 — M4 总体稳定审阅与最终封板结论

> 状态：**M4 已正式封板。后续工作必须由产品经理以新的真实问题重新立项，并经独立架构冻结。**
>
> 本封板确认 MySQL 候选 `ReviewWorkflowRepository` 在 M4 冻结范围内与现有完整复盘 Contract 的等价验证，不代表 MySQL 已成为运行主库。

## 【架构结论：通过】

M4-A、M4-B、M4-C 的串行退出门均已关闭。

- **M4-A**：无方法、无派生事项路径已证明 Review、原 Item `waiting_review → reviewed` 与最终状态事件在单一 MySQL DML transaction 中全有或全无；
- **M4-B**：形成、验证、修订路径已证明 Review、Method、MethodVersion、MethodEvidence、原 Item 状态与最终状态事件保持单一 transaction 原子性；
- **M4-C**：既有 `newIdeas` 派生 Item、初始状态事件及 `derived_from_review` ItemLink 已被纳入同一 transaction，并证明完整 M4 数据可通过既有 BackupData 导出、恢复、再导出保持规范化等价。

QA 已覆盖无方法、formation、validation、revision 的有 / 无 `newIdeas` 路径，所有关键写入阶段失败、COMMIT 前中断和同一 Item 并发竞争。每个失败路径均以九集合完整快照证明回滚，不存在半完成 Review、方法事实、派生 Item、ItemLink、错误状态或孤儿事件。

真实 MySQL 串行组合回归覆盖 M1～M4-C，共 9 个文件、92 项通过；M4-C 定向 21 项通过。无 `.env` 时集成测试按设计明确 skip 且不连接 MySQL；typecheck、全量 test、build:h5 与 `git diff --check` 均通过。既有 H5 bundle 体积和 Webpack cache 告警不影响 M4 数据可信性、事务边界或封板判断。

## 【M4 是否封板】

**是，正式封板。**

M4 封板范围：

```text
MySqlReviewWorkflowRepository implements ReviewWorkflowRepository
无方法关联的 Review 原子闭环
方法形成、验证、修订的跨对象原子闭环
newIdeas 派生 idea_to_try Item、初始事件与 derived_from_review ItemLink
同一 Item 重复与并发请求的至多一次完整提交保护
全路径失败注入、九集合完整回滚与可信异常暴露
完整 M4 数据通过既有 BackupData 的 export → replace → export 等价验证
system_metadata 与业务备份的持续隔离
```

M4 封板确认的是候选 MySQL 数据层对既有完整复盘业务语义的等价实现与合成测试证据。

## 【当前主库结论】

以下边界是 M4 封板的组成部分，不是可默认放开的事项：

```text
IndexedDB = 当前唯一运行主库
MySQL     = 候选 Repository，仅用于开发与合成测试
SQLite    = 保留的实验 / 测试资产
```

因此，本结论不表示：

```text
MySQL 已承担实际业务读写
IndexedDB 已退出运行路径
ReviewWorkflow 已接入 Application 或前端
真实 IndexedDB → MySQL 数据迁移已验证
双写、切换、回退或网络运行故障已验证
浏览器能够或应当连接 MySQL
```

## 【M4 封板不自动授权 M5】

**M4 封板不自动授权 M5，也不授权任何运行时接入或主库迁移工作。**

特别禁止将“候选 Repository + 合成测试通过”表述为“主库迁移完成”，或把 M4 的候选 Workflow 直接组装到运行 Application。

若未来讨论运行时接入、真实迁移、双写或主库切换，必须由产品经理以新的真实用户问题发起独立范围，并依次完成：

```text
产品目标、范围、非目标与验收标准冻结
→ Application 运行组合与依赖注入边界评审
→ API 信任边界、认证、授权与访问控制评审
→ 真实数据迁移、完整 JSON 备份与恢复演练设计
→ 单写 / 双写策略、读写切换、回退与一致性验证设计
→ 网络、连接、事务未知结果、可观测性与安全模型设计
→ 前端降级、用户可见失败语义与人工验收
→ QA、产品验收与独立封板
```

`completeReview()` 的候选事务语义不等于运行时的请求幂等语义。当前 Contract 不存在 requestId / idempotency key；未来如需要安全重试、未知提交结果查询或跨网络去重，必须在新范围中明确产品语义和 Contract，不得在候选实现阶段补造。

## 【新范围获批前持续禁止】

```text
Application 运行组合切换
packages/application/** 为 MySQL 运行接入而修改
apps/client/**
前端或 HTTP Client 接入
MySQL 业务 HTTP API
真实 IndexedDB → MySQL 迁移
IndexedDB / MySQL 双写
MySQL 主库切换
浏览器直连 MySQL
修改 Contracts、Schema、Migration
修改 BackupData format、version 或 v1/v2 语义
未独立立项的 ReviewWorkflow 扩张
删除或改造 SQLite 实验资产
Kubernetes、云端同步、远程访问或协作
```

## 【风险与保护策略】

1. **候选事务证明不等于生产切换证明。** 当前证据覆盖本地合成数据、MySQL transaction 与恢复语义；不覆盖真实用户数据体量、网络重试、认证、进程重启、API 超时或运行时降级。
2. **真实迁移必须可回退。** 任何未来迁移前，必须进行可审计的 JSON 导出、导入前后计数与结构化引用核验、恢复演练及失败回退演练；不得以候选库测试代替真实数据验证。
3. **禁止先接入再补边界。** API、Application 组合、前端切换、双写和主库切换必须先定义单一事实来源、故障语义、可观测性和回退，再实施。
4. **保持数据主权与证据优先。** Method、Version、Evidence、Application、Tombstone、Review 和 ItemLink 关系继续只能以结构化引用解释；任何运行阶段都不得按标题、时间、文案、版本号或计数猜测关系。

## 【下一责任岗】

**产品经理。**

## 【是否允许写代码】

**否。** M4 已封板；仅允许产品经理发起后续独立评审。在新的产品与架构范围冻结前，禁止继续 MySQL 运行接入、真实迁移、双写或主库切换实现。
