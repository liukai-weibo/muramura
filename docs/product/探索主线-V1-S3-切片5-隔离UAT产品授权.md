# 探索主线 V1 S3 切片 5：隔离 UAT 产品授权

> 授权日期：2026-07-26
>
> 裁决：**可执行隔离 UAT；不构成探索主线 V1 最终验收或封板。**
>
> 依据：`当前运行事实.md`、`探索主线-V1-S3-可信运行时接入产品范围冻结.md`、`../architecture/探索主线-V1-S3-最小架构任务书.md`、`探索主线-V1-S3-切片1-BackupV3产品验收结论.md`、`探索主线-V1-S3-切片2-API与HTTP契约产品验收结论.md`、`探索主线-V1-S3-切片3-H5真实接入产品验收结论.md`、`探索主线-V1-S3-切片4-unknown-outcome产品验收结论.md`。

## 允许范围

QA 可在隔离 `knowledge_base_uat` 执行浏览器 UAT、受控清库/恢复、MySQL 不可用和 unknown-outcome 故障验证，以及必要的 UAT 业务写入。不得修改源码、测试、配置、migration、MySQL 容器或运行库结构。

## 前置与隔离门

1. 显式加载 `.env.uat`，启动后请求 `http://127.0.0.1:32146/health`，记录 `status`、`database=knowledge_base_uat`、`schemaVersion=4`；不满足立即停止。
2. 仅通过 `http://127.0.0.1:10086` 与 loopback API 验收；不得使用 `192.168.128.1:10086` 或任何非 loopback 入口。
3. UAT 前后对两个运行库做只读深度快照；`knowledge_base` 前后必须 `SNAPSHOTS_IDENTICAL`。
4. 清库、restore、故障注入前必须记录 UAT 快照、恢复条件与清理方式；禁止 DDL、删除 migration record、手工修表、删除 `mysql-data`、触及 IndexedDB/SQLite。

## 必测范围

- 主线创建、改名、软删除与恢复；
- existing/new 关联的原子捕获、取消零写入、关联调整/移除；
- deleted/unavailable 诚实降级与稳定拒绝；
- 当前关联事项、定位、历史与已放弃记录；
- Backup V1/V2/V3 导出、清库、恢复、非法输入零写入；
- 超时、断线、响应丢失、MySQL 不可用与 unknown-outcome；
- 无 IndexedDB fallback、桌面/小屏与两行截断。

## 交付与后续

QA 须提交 UAT 结果、隔离证据、缺陷分级、回归风险与验收建议，并在 H5 人工验收后更新当天贡献记录。随后转架构师复审。架构复审通过后，产品经理才可进行探索主线 V1 最终验收、归档与封板。
