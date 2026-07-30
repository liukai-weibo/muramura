# 在线账户与单用户数据隔离 V0：切片 3 初始归属与 Backup 产品编码授权

日期：2026-07-30  
状态：产品验收通过并归档；切片 4 可开始，切片 5 不得开始

## 范围

- 实现独立受控的初始个人数据 claim 命令：显式目标账户、单事务、前后摘要、重复幂等、混合归属拒绝。
- 让 Backup V1/V2/V3 按当前用户导出、预览和恢复；格式不新增 `userId`，恢复只替换当前用户数据；发现备份 ID 属于其他用户时返回 409 且零写入。

## 允许修改

- `packages/contracts/src/index.ts`、`packages/application/src/index.ts`、`packages/storage-mysql/src/backup-repository.ts` 及必要既有 MySQL Repository、`apps/api/src/index.ts`。
- 仅直接测试、架构/QA/产品记录及当天贡献记录。

## 硬边界与验收

- 不自动猜测、批量归属或改写跨用户数据；claim 不得成为普通 H5 用户操作入口。
- 不改 Backup V1/V2/V3 文档格式、业务对象、状态机或恢复语义。
- 覆盖 claim 成功/重复/混合拒绝/失败零污染、跨用户导入导出拒绝、恢复仅影响当前用户、unknown-outcome 与随机临时库清理。

## 产品验收与归档（2026-07-30）

验收通过。初始 owner claim 已验证显式单一 `userId`、十集合单事务锁定/检查/归属、首次 claimed 与前后计数、重复 already-claimed、混合归属写入前拒绝、beforeCommit 末端失败整体回滚，以及 afterCommit unknown-outcome 不自动重试、显式重跑确认 already-claimed。

Backup V1/V2/V3 文档未加入 `userId` 或 `owner_user_id`；导出仅包含当前用户，预览不写库，恢复仅替换当前用户十集合。备份 ID 属于其他用户时，在删除前返回含 `requestId` 的 `409 CONFLICT`，十集合零写入；`system_metadata`、`schema_migrations`、`users`、`user_sessions`、`initial_owner_claims` 均不参与 Backup 导出、清理或恢复。

定向 claim/Backup 为 1 文件 6 测试，组合回归归档口径修正为实际复跑的 5 文件 26 测试，完整 MySQL 回归为 13 文件 135 测试；typecheck 与 `git diff --check` 通过。前后深度快照摘要均为 `8b6a445e504daa63b28fc6acbffec794847da9ecca78bd5e5bb89f5d70e38be7`，无 `kb_claim_*` 临时数据库或账号残留。不得继续引用未被对应命令复现的“5 文件 / 34 测试”。

本结论不包含真实运行库 claim/恢复、H5、浏览器 UAT 或部署。切片 4 条件授权现生效；切片 5 继续不得开始。
