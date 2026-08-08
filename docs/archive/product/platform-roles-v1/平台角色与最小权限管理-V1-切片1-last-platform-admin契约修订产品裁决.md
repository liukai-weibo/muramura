# 平台角色与最小权限管理 V1：切片 1 last-platform-admin 契约修订产品裁决

日期：2026-07-30
状态：产品裁决已完成；仅授权架构与状态文档修订，不授权源码、测试或运行环境修改

## 产品裁决

选择方案一：`last-platform-admin` 仅作为“任意成功提交后系统不得失去最后一名 platform_admin”的内部安全不变量，不再作为对外可观察的 Repository 错误码。

## 冻结行为

- 管理员不得调整自己的角色。单管理员撤销自己必须稳定返回 `self-role-change`。
- actor 必须是获得管理员集合锁后的最新 `platform_admin`；否则稳定返回 `actor-not-platform-admin`。
- 两名管理员并发互撤时只允许一次成功；失败方重新获得管理员集合锁后已经不再是管理员，必须稳定返回 `actor-not-platform-admin`。
- 任意成功提交后至少保留一名 `platform_admin`。
- `last-platform-admin` 从 `PlatformAdministrationRepositoryErrorCode` 移除，Repository 不再公开抛出该错误，未来 Application、API 与 H5 也不得映射或展示该文案。
- 不通过调整错误优先级、放宽自操作规则或构造异常 actor/target 组合制造不可自然到达的错误场景。
- 管理员集合锁、固定 userId 锁序、事务审计、operationId、commit 前回滚、commit 后 unknown-outcome 与显式重读规则全部保持不变。

## 本次文档修订范围

- `docs/product/当前运行事实.md`
- `docs/architecture/平台角色与最小权限管理-V1-切片1-Schema与Repository冻结记录.md`
- 本产品裁决记录

## 后续最小修复建议范围

后续必须由产品经理另行签发编码授权，且最多允许修改：

- `packages/contracts/src/index.ts`
- `packages/storage-mysql/src/platform-administration-repository.ts`
- `tests/mysql-platform-administration-repository.integration.test.ts`
- 必要的切片 1 实现、QA、产品记录与实际验证当日贡献记录

修复内容仅限：移除公开 `last-platform-admin` code/分支，补齐单管理员自撤与双管理员并发互撤的精确错误断言。既有事务、审计、锁序、operationId、回滚及 unknown-outcome 测试不得删除或放宽。

## 禁止事项

- 不修改 `migrations/006_add_platform_roles_and_security_audit.sql`、`user_roles` 或 `security_audit_events`。
- 不修改 `AuthUser`、认证刷新、CLI、Application、API、H5 或 Backup。
- 不执行真实 Migration，不触碰 `knowledge_base`、`knowledge_base_uat`、现有用户、现有会话、Docker、云端或运行配置。
- 切片 1 QA 仍不通过；未经最小修复授权、QA 复测和产品验收，不得开始切片 2。

## 下一责任岗与编码许可

下一责任岗：产品经理签发切片 1 最小修复编码授权。
是否允许写代码：否。
