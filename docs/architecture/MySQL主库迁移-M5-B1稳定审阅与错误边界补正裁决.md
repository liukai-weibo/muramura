# MySQL 主库迁移 — M5-B1 稳定审阅与错误边界补正裁决

> 状态：**有条件通过；不得产品封板，M5-B2 继续冻结，完成本裁决的最小补正与 QA 复验后重新审阅。**
>
> 当前主库边界不变：IndexedDB 是唯一运行主库；MySQL 仅为候选 Repository 与候选 loopback API 路径；SQLite 是实验 / 测试资产。

## 审阅通过项

- M5-B 业务 API 路由矩阵已建立，路由范围与既有 Application Service 映射明确。
- `apps/api` 的组合根使用 MySQL Repository 组装既有 Application Service；已审阅路由未直连 SQL、未暴露 pool / Repository，也未拆分 `completeReview()` 的事务。
- Backup restore 先经 `parseAndValidate()`，随后复用既有 Backup Application 语义；未改变 BackupData、v1/v2 或 metadata 隔离。
- Item DELETE 保持软删除、Method DELETE 保持 moveToTrash；未新增永久清理入口。
- loopback 监听限制、精确 CORS、body 上限、无 secret 前端暴露、无前端 / Schema / Contract / IndexedDB / SQLite 越界改动均符合 M5-B1 边界。
- QA 提供的真实 MySQL 定向与 M1～M5-B1 串行回归结果可作为候选 API 路径的积极证据。

## 封板阻断项

### 1. 未分类异常被误报为 MySQL 不可用

`apps/api/src/index.ts` 的 `mapFailure()` 在未命中已知业务错误和 `MySqlSchemaNotReadyError` 时，一律返回：

```text
503 MYSQL_UNAVAILABLE
本地 MySQL 候选环境当前不可用
```

这会把 JSON 之外的运行时异常、Application / API 编程异常或未分类异常伪装为 MySQL 故障，不符合已冻结错误契约：

```text
MYSQL_UNAVAILABLE = MySQL、pool 或 connection 不可用
INTERNAL_ERROR = 未分类且脱敏的异常
```

### 2. `itemIds` 缺少 URL 总长度保护

当前只校验 `itemIds` 最多 100 个且无空 ID，没有冻结任务书要求的 URL 长度保护。超长参数必须在进入 Application 前被确定性拒绝为：

```text
400 VALIDATION_FAILED
```

不得通过客户端拆分、N+1 请求或异常映射绕过此限制。

## 最小补正授权

仅授权以下 M5-B1 范围内的最小修改：

```text
apps/api/src/index.ts
测试文件（tests/api-m5b*.test.ts 或等价定向测试）
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md（在完成工程验证后按项目规则追加实际修改）
```

必须完成：

1. 仅把可证明为 MySQL / pool / connection 不可用的异常映射为 `503 MYSQL_UNAVAILABLE`；
2. 将未分类异常稳定映射为 `500 INTERNAL_ERROR`，保留脱敏固定文案与 `requestId`，不泄漏 SQL、stack、driver、host、port、database 或凭据；
3. 为 `GET /api/v1/method-source-displays?itemIds=` 增加固定 URL 总长度上限，并在超限时返回 `400 VALIDATION_FAILED`；
4. 添加真实 API 定向证据，至少覆盖：未分类异常的 `500 INTERNAL_ERROR`，以及超长 `itemIds` 的 `400 VALIDATION_FAILED`；
5. 保持冻结矩阵、Application 调用、M5-A 路由、Schema、Contracts、BackupData 和前端边界不变。

## 重新审阅门

补正后必须重新执行并由 QA 复验：

```text
M5-B1 真实 MySQL API 定向测试
M1～M5-B1 串行真实 MySQL 回归
typecheck
全量 test
build:h5
git diff --check
```

只有补正通过、QA 复验通过并完成架构复审后，M5-B1 才可流转产品封板裁决。产品封板后，才可书面授权 M5-B2。

## 持续冻结

```text
M5-B2 / M5-C
apps/client/**
H5 单写验证
IndexedDB / MySQL 双写、同步、回填、fallback 或合并展示
真实历史迁移与主库切换
远程监听、认证、多用户和浏览器直连 MySQL
Schema / Migration
```
