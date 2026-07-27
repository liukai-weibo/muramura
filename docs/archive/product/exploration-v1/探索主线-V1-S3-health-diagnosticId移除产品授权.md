# 探索主线 V1 S3：health diagnosticId 移除产品授权

> 授权日期：2026-07-26
>
> 裁决：**可编码；仅移除未冻结 health 字段。不得封板。**

> 依据：`当前运行事实.md`、`探索主线-V1-S3-可信运行时接入产品范围冻结.md`、`../architecture/探索主线-V1-S3-切片5-受控故障注入架构授权.md`、`../architecture/探索主线-V1-S3-切片5-最终UAT-QA报告.md`。

## 允许范围

- `/health` 503 响应所在的 `apps/api/src/**`；
- 该响应的直接测试；
- 必要的 QA、架构记录与当天贡献记录。

## 唯一修改

移除故障 `/health` 响应中的既有 `diagnosticId=MYSQL_UNAVAILABLE`。冻结 GET 的既有错误 DTO 必须继续保持 `code=MYSQL_UNAVAILABLE` 与 `requestId`。

## 禁止项

不得新增或修改其他字段、DTO、路由、业务对象、状态、关系、Application、Repository、Contracts、H5、migration、运行库、Docker/MySQL 配置或任何业务能力。

## 验收门

- fault health 为脱敏 HTTP 503 且不含 `diagnosticId`；
- 冻结 GET 为 `code=MYSQL_UNAVAILABLE` 且含 `requestId`；
- `restore-normal` 后 health 为 `ready / knowledge_base_uat / schemaVersion=4`；
- 通过直接测试、`git diff --check` 与 QA 定向复测后转架构复审；未经架构复审与产品最终验收，不得封板。
