# SQLite 主库迁移 — S6-B1 诊断失败分类补测裁决

> 状态：**B1 核心实现有条件通过；暂不冻结为前端可消费 Contract，暂不允许候选环境诊断 UI 实施。**
>
> 当前唯一运行主库仍为 IndexedDB；SQLite 仍是候选存储和临时合成测试目标。
>
> 关联：`docs/architecture/SQLite主库迁移-S6-B1候选环境诊断架构裁决与实施任务书.md`。

## 【技术结论：有条件可行，必须补齐分类 DTO 证据】

已核对 `apps/local-api/src/index.ts`：失败映射采用 `SqliteStorageOpenError.code`，而非匹配 SQLite 原始错误文本：

```text
directory-unavailable     → database-directory-unavailable / SQLITE_DIRECTORY_UNAVAILABLE
database-open-failed      → database-open-failed / SQLITE_UNAVAILABLE
schema-migration-failed   → schema-migration-failed / SQLITE_SCHEMA_UNAVAILABLE
integrity-check-failed    → integrity-check-failed / SQLITE_INTEGRITY_FAILED
未知异常                   → unknown-database-error / SQLITE_CANDIDATE_UNKNOWN
```

这一映射方向正确，且 `message` 为固定脱敏文案，不回传 SQLite 原始错误、SQL 或堆栈。写锁探测也使用：

```text
BEGIN IMMEDIATE
→ ROLLBACK
```

并已证明不会改变业务 `BackupData` 或 `system_metadata`。

但是，当前定向测试只直接验证：

```text
database-directory-unavailable
database-write-unavailable
```

其余四个稳定分类尚未通过 `/api/candidate-environment` 的 HTTP 响应实证。既然这些分类将成为未来前端 adapter 的唯一可信输入，就不能以代码阅读替代自动化 Contract 证据。

## 【必须补齐的 B1 定向测试】

在 `tests/local-api-s6a.test.ts` 或新建等价 `tests/local-api-s6b1.test.ts` 中，以受控注入方式分别构造下列失败。每例必须请求：

```http
GET /api/candidate-environment
```

并精确断言：

```text
HTTP 503
status = database-unavailable
failureCategory
diagnosticId
固定脱敏 message
checks 的精确布尔组合
Cache-Control = no-store
响应中不含原始错误、SQL、stack、Item、Review、Method、BackupData
既有数据库文件不被替换或清空（适用时）
```

### 1. SQLite 文件无法打开

```text
SqliteStorageOpenError.code = database-open-failed
→ failureCategory = database-open-failed
→ diagnosticId = SQLITE_UNAVAILABLE
→ checks = {
     apiReachable: true,
     databaseOpenable: false,
     databaseWritable: false,
     candidateSchemaReady: false,
     integrityPassed: false
   }
```

### 2. Schema 初始化失败

```text
SqliteStorageOpenError.code = schema-migration-failed
→ failureCategory = schema-migration-failed
→ diagnosticId = SQLITE_SCHEMA_UNAVAILABLE
→ checks = {
     apiReachable: true,
     databaseOpenable: true,
     databaseWritable: false,
     candidateSchemaReady: false,
     integrityPassed: false
   }
```

### 3. 完整性检查失败

```text
SqliteStorageOpenError.code = integrity-check-failed
→ failureCategory = integrity-check-failed
→ diagnosticId = SQLITE_INTEGRITY_FAILED
→ checks = {
     apiReachable: true,
     databaseOpenable: true,
     databaseWritable: false,
     candidateSchemaReady: true,
     integrityPassed: false
   }
```

### 4. 未知打开异常

```text
非 SqliteStorageOpenError
→ failureCategory = unknown-database-error
→ diagnosticId = SQLITE_CANDIDATE_UNKNOWN
→ checks = {
     apiReachable: true,
     databaseOpenable: false,
     databaseWritable: false,
     candidateSchemaReady: false,
     integrityPassed: false
   }
```

## 【最小实现 / 测试 seam 约束】

允许为 `createLocalApi()` 新增**仅供测试注入**的数据库打开函数 seam，例如：

```ts
openDatabase?: (databasePath: string) => DatabaseState
```

或等价、非导出的测试钩子。

约束：

```text
生产 main.ts 不传入该参数
生产 Local API 仍只能使用 createSqliteS4Repository()
seam 不得允许调用方伪造 ready database 或改变 host / port
seam 不得暴露为 HTTP 配置、环境变量或用户可控选项
```

若能通过 `openKnowledgeDatabase` 已有测试 hooks 在不修改生产 API 的情况下构造上述错误，也可采用。但不能通过：

```text
匹配错误 message
损坏真实用户数据库
依赖操作系统文件权限的偶然行为
创建业务记录来制造失败
```

## 【额外审阅确认】

### 已通过的边界

```text
candidate-environment 是只读诊断 API，不返回业务集合
write probe 不写业务数据、备份或 metadata
除 health / candidate-environment 外 /api/* 仍为 not-found
apps/client/** 未接入
IndexedDB 主路径未改
```

### 尚未获得授权的能力

```text
前端候选环境诊断 UI
任何业务 API
前端 HTTP adapter
SQLite 业务读写
真实迁移、双写或主库切换
```

## 【验收与流转】

补测完成后必须执行：

```sh
corepack pnpm -C Knowledge_Base test --run tests/local-api-s6a.test.ts
corepack pnpm -C Knowledge_Base typecheck
corepack pnpm -C Knowledge_Base test
corepack pnpm -C Knowledge_Base build:h5
git -C Knowledge_Base diff --check
```

并按项目规则更新：

```text
docs/daily-contributions/YYYY-MM-DD.md
```

通过后：

```text
数据 / API 工程师
→ QA B1 定向复验
→ 架构师冻结 B1 诊断 Contract
→ 才可授权前端实现设置页低频诊断 UI
```

## 【下一责任岗】

**数据 / Application / Repository 工程师。**

## 【是否允许写代码】

**允许，仅限 B1 失败分类 DTO 的受控定向测试及必要的私有测试 seam；不允许前端或业务 API 实施。**
