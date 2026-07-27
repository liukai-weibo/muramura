# MySQL 主库迁移 — M3 总体稳定审阅与最终封板结论

> 状态：**M3 已正式封板。后续工作必须以新的独立产品范围与架构冻结重新立项。**
>
> 本封板只确认 MySQL 候选 Repository 在 M1～M3 所冻结数据层范围内的等价验证与可信恢复边界，不代表 MySQL 已成为运行主库。

## 【架构结论：通过】

M3-A、M3-B、M3-C 的串行退出门均已关闭。

- M3-A 已验证 Method、MethodVersion、MethodEvidence 的基础生命周期、Schema 003 DDL 前预检、结构化关系与多表事务回滚；
- M3-B 已验证 MethodApplication、MethodTombstone、Method 永久清理、Item 跨对象永久清理及独立 Review 删除安全拒绝；
- M3-C 未增加生产 Repository 能力，只证明已有 `MySqlBackupRepository` 在完整方法生命周期数据下维持 BackupData 规范化等价、严格引用校验、单一 DML transaction 原子恢复和 `system_metadata` 隔离。

QA 已提供真实 MySQL 串行组合回归 6 文件、36 项通过，以及 typecheck、全量 test、build:h5 与 `git diff --check` 的通过结果。H5 的既有 bundle 体积与 Webpack cache 告警不涉及本阶段的数据语义、事务可信性或封板范围，不构成阻断。

## 【M3 是否封板】

**是，正式封板。**

M3 封板范围为：

```text
M1：MySQL 候选基础设施、权限隔离、migration、健康检查
M2-A：Item 与状态历史候选 Repository
M2-B：Review、BackupData、system_metadata 隔离
M3-A：Method / Version / Evidence 基础生命周期
M3-B：Application、Tombstone 与跨对象永久清理
M3-C：完整方法生命周期 BackupData 等价、引用校验与原子恢复
```

封板确认的关键语义：

```text
完整 v2 生命周期备份
→ parseAndValidate
→ replaceData
→ exportData
→ 按既有规范化语义等价
```

同时保持：v1/v2 兼容；非法备份在 SQL transaction 前零写入；末端写入失败回滚所有九个业务集合；`system_metadata` 不导出、不删除、不恢复、不覆盖。

## 【当前主库结论】

以下边界是本封板的组成部分，不是后续可默认放开的事项：

```text
IndexedDB = 当前唯一运行主库
MySQL     = 候选 Repository，仅用于开发与合成测试
SQLite    = 保留的实验 / 测试资产
```

因此，本结论不表示：

```text
MySQL 已承担业务读写
IndexedDB 已退出运行路径
备份已用于真实数据迁移
浏览器能够或应当连接 MySQL
真实切换、回退、双写或数据一致性已验证
```

## 【后续阶段的立项规则】

**必须创建新的、独立的产品范围与架构冻结，才可讨论任何运行时接入或主库迁移。**

不得将 M3 候选测试通过直接解释为下一阶段自动授权。后续至少应依次明确：

```text
真实用户问题与运行目标
→ 新阶段产品范围、非目标、验收标准与回退边界
→ 架构评审：Application 组合、API 信任边界、身份认证、数据迁移、
  一致性策略、读写切换、回退、可观测性与安全模型
→ 数据 / Application 层契约与迁移演练
→ 前端或 API 接入
→ QA 与产品验收
```

特别是 `completeReview()`、完整 ReviewWorkflow、Application 运行组合和真实迁移均具有跨对象写入与运行时语义，必须独立定义；不得以 M3 的 Method 生命周期候选实现为基础直接拼装。

## 【新范围获批前持续禁止】

```text
Application 运行组合切换
前端或 HTTP Client 接入
apps/client/** 修改以接入 MySQL
MySQL 业务 HTTP API
真实 IndexedDB → MySQL 迁移
IndexedDB / MySQL 双写
MySQL 主库切换
浏览器直连 MySQL
completeReview() 或完整 ReviewWorkflow 扩张
未经独立评审的 Schema migration
删除或改造 SQLite 实验资产
Kubernetes、云端同步、远程访问或协作
```

## 【风险与保护策略】

1. **候选验证不等于运行可靠性。** M3 证明的是 Repository 的结构化数据语义、事务与恢复边界，不包含真实用户数据迁移、网络失败、身份认证、运行组合或切换回退。
2. **先定义切换语义，再写接入代码。** 若未来引入 MySQL 运行路径，必须明确单写时点、迁移校验、失败回退、IndexedDB 历史资产定位及不可逆步骤；不允许先双写再补一致性设计。
3. **保持数据主权。** 任何真实迁移前必须有可验证的完整 JSON 导出、恢复演练、数据计数与引用一致性核验；不得用候选库合成测试代替真实数据验收。
4. **跨对象写入须单独审计。** `completeReview()` 与 ReviewWorkflow 不得通过拼接已有单 Repository 方法实现，必须定义跨对象事务边界与失败语义。

## 【下一责任岗】

**产品经理。**

## 【是否允许写代码】

**否。** 当前阶段已封板。仅允许产品经理发起新的独立评审；在新产品范围和架构冻结完成前，不允许继续 MySQL 运行时接入、迁移或切换实现。
