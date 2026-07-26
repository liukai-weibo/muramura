# 探索主线 V1 S3 切片 2：API 与 HTTP 契约产品授权

> 授权日期：2026-07-25
>
> 裁决：**可编码；仅限切片 2。**
>
> 依据：`当前运行事实.md`、`探索主线-V1-S3-可信运行时接入产品范围冻结.md`、`探索主线-V1-API契约产品确认结论.md`、`../architecture/探索主线-V1-S3-最小架构任务书.md`、`探索主线-V1-S3-切片1-BackupV3产品验收结论.md`。

## 授权范围

实现已冻结的 Track、Item 关联和受限事项查询 API 路由，以及 HTTP decode、请求限制、DTO 映射、统一错误映射与 `requestId`。API handler 仅调用既有 Application 能力。

允许修改：

- `apps/api/src/**`；
- 与冻结 API 契约直接对应的 `tests/**`；
- 必要的真实架构/验收记录，以及完成工程验证后当天贡献记录。

## 不允许项

- 修改 `packages/application/src/**`、`packages/storage-mysql/src/**`、`packages/contracts/src/**`；
- 修改 API 路由矩阵、DTO、业务状态、关系、命名规则或任何既有业务语义；
- 修改 migration、运行库 DDL/DML、`mysql-data`、MySQL 容器或权限配置；
- 实施 `apps/client/src/**`、真实 H5 接入、unknown-outcome 端到端逻辑、双写、同步、fallback 或浏览器直连 MySQL；
- 新增筛选、计数、分页总数、管理能力或未冻结路由。

## 验收门

API 集成测试只使用随机临时 MySQL database。须覆盖冻结路由与 DTO、稳定排序、64 KiB 普通 JSON body 限制、16 MiB Backup restore 限制、query 边界、400/404/409/503/500 与 413/415/405/`NOT_FOUND_ROUTE`、失败脱敏、`requestId`、`X-Request-Id`、`Cache-Control: no-store` 及无额外路由。

完成后转 QA 与产品复核。未获得两者通过，不得开始切片 3 或任何后续 S3 切片。
