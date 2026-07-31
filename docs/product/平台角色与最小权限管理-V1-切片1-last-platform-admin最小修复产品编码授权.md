# 平台角色与最小权限管理 V1—切片 1 last-platform-admin 最小修复产品编码授权

日期：2026-07-30

状态：已授权编码；仅允许完成切片 1 QA 阻断的最小契约修复，未经复测与产品验收不得开始切片 2

## 结论

产品依据 `平台角色与最小权限管理-V1-切片1-Schema与Repository冻结记录.md` 的修订契约，独立授权切片 1 的 `last-platform-admin` 最小修复。该授权不扩张平台角色 V1 的业务范围，也不授权真实 Migration、API、H5 或运行库接入。

## 精确允许范围

- `packages/contracts/src/index.ts`
- `packages/storage-mysql/src/platform-administration-repository.ts`
- `tests/mysql-platform-administration-repository.integration.test.ts`
- 必要实现、QA、产品记录及实际验证当日贡献记录

## 仅允许的修复

- 从 `PlatformAdministrationRepositoryErrorCode` 移除 `last-platform-admin`。
- 删除 Repository 公开抛出该错误的不可达分支，不用其他公开错误码包装或替代。
- 单管理员自撤精确断言 `self-role-change`。
- 双管理员并发互撤精确断言一次成功、一次 `actor-not-platform-admin`，并断言最终至少保留一名管理员。
- 保持管理员集合锁、固定用户锁序、事务审计、`operationId`、回滚及 unknown-outcome 行为和测试不变。

## 禁止范围

- 禁止修改 Schema 006、`AuthUser`、认证刷新、CLI、Application、API、H5、Backup、Docker、配置或运行库。
- 禁止执行真实 Migration、运行库 DDL/DML、注册、claim、Backup 恢复或任何 API/H5 写入。
- 禁止开始切片 2–5，禁止顺带重构或扩大错误契约。

## 验收门

- 修订后的定向 Repository 集成测试必须覆盖两项精确错误码与最终管理员安全不变量。
- 切片 1 原有 Schema、Repository、事务、审计、回滚和 unknown-outcome 场景必须保持通过。
- 测试仅使用随机 `kb_platform_*` 临时数据库和独立临时账号，最终不得残留。
- `knowledge_base` 与 `knowledge_base_uat` 前后只读摘要必须一致；两库继续保持 15 表、`schemaVersion=5`、平台表 0。
- `typecheck` 与 `git diff --check` 必须通过。
- 修复完成后仅回流切片 1 独立 QA；未经 QA 通过与产品验收不得开始切片 2。
