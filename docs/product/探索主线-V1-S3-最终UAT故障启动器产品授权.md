# 探索主线 V1 S3：最终 UAT 故障启动器产品授权

> 授权日期：2026-07-26
>
> 裁决：**可实现并测试启动器；不授权浏览器 UAT、最终验收或封板。**
>
> 依据：`当前运行事实.md`、`../architecture/探索主线-V1-S3-最终UAT故障启动器与SOP任务书.md`、`探索主线-V1-S3-切片5.1-最小合规修复产品授权.md`。

## 允许范围

- `scripts/uat-api-fault.ps1`；
- 其直接 PowerShell 测试（仅在既有测试设施可用时）；
- 必要的架构、QA 记录与当天贡献记录。

启动器仅提供固定的 `status`、`stop-normal`、`start-mysql-unavailable`、`restore-normal`、`stop-fault` 动作，以 UAT 环境下的本地 loopback API 子进程验证既有 MySQL 不可用语义。

## 不允许项

- 执行浏览器 UAT、任何 UAT 业务写入、清库、恢复、故障注入或最终封板；
- 修改 API、H5、Application、Repository、Contracts、migration、`.env`、Docker/MySQL 配置或业务功能；
- 新增 health 字段、诊断字段、路由、DTO、幂等、重试、fallback 或任何生产能力。

## 验收门

- 非 UAT、端口占用或健康状态不符合时稳定拒绝；
- 故障子进程只以无效 MySQL 密码运行，既有 `/health` 或冻结 GET 返回 HTTP `503`；冻结 GET 错误 DTO 为 `code=MYSQL_UNAVAILABLE` 且含 `requestId`；
- 恢复后仅以未改动 `.env.uat` 启动正常 API，并确认 `ready / knowledge_base_uat / schemaVersion=4`；
- 临时状态与日志不含密码，且写在项目外临时目录；
- 通过直接测试与 `git diff --check`，并更新当天贡献记录。

完整浏览器 UAT 的前置仍是切片 5.1 三项修复通过 QA；之后才可重建合规 UAT 基线并执行一次故障—恢复闭环。
