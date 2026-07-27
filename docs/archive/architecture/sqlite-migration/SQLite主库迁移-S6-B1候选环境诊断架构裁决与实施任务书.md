# SQLite 主库迁移 — S6-B1 候选环境诊断架构裁决与实施任务书

> 状态：**产品与设计方向冻结；允许进入 B1 数据 / API 契约实施，暂不允许前端实施。**
>
> 本文替换 S6-B 中“bootstrap gate / 全页阻断”的候选阶段表述。
>
> 当前唯一运行主库仍为 IndexedDB；SQLite 仍是候选存储。

## 【技术结论：可行，必须取消候选阶段的 Bootstrap Gate】

设计裁决正确。当前运行事实是：

```text
IndexedDB = 当前工作台唯一运行主库
SQLite    = 尚未迁移、尚未接入主路径的候选存储
```

因此候选 SQLite 的失败不能阻断 IndexedDB 工作台，也不能被渲染为空工作台、首次使用或数据库故障页。

S6-B1 正式改为：

```text
正常进入 IndexedDB 工作台
→ 应用启动后静默检查 Local API 候选环境
→ 仅在设置页“候选环境诊断”中展示结构化结果
→ 失败不改变事项、复盘、方法、搜索、备份或回收站主流程
```

原全页阻断页仅作为未来设计资产。它的启用前提是：

```text
S6-C 真实 JSON 迁移成功
+ 恢复演练成功
+ 重启 UAT 成功
+ 产品验收 SQLite 为唯一运行主库
+ IndexedDB 退出业务读写路径
```

在上述条件前，严禁启用。

## 【一、S6-B1 范围与非目标】

### B1 范围

```text
Local API 候选环境诊断接口
前端候选环境诊断 adapter
应用启动后的非阻断静默检查
设置页低频“候选环境诊断”区域
重新检查、检查中、已就绪、不可用、暂时无法确认状态
```

### B1 非目标

```text
前端运行主库切换
删除或替换 createIndexedDbRepository()
任何 SQLite 业务读写 API
事项 / 复盘 / 方法 / 搜索 / 回收站 HTTP API
真实 JSON 导入、恢复点、迁移标记
创建或写入真实候选业务数据
双写、数据同步、合并、回退
全页阻断工作台
```

B1 诊断结果不是用户业务事实：

```text
不得写入 IndexedDB
不得写入 SQLite BackupData
不得进入 JSON 备份
不得跨会话持久化
```

## 【二、必须修正的设计 / 契约前提】

现有 S6-A 的：

```text
GET /api/health
```

只足以返回：

```text
ready / database-unavailable
数据库路径
安全错误说明
```

它**尚不足以**支撑设计稿中的：

```text
databaseWritable
schemaReady
integrityPassed
initializedForFutureMigration
failureCategory
diagnosticId
```

前端不得根据 `health` 的 HTTP 状态、浏览器异常、端口、文本 error 或路径自行推断这些字段。B1 必须先由 Local API 产生稳定、结构化的候选环境读模型。

### `initializedForFutureMigration` 不进入 B1

该字段语义在 S6-C 前不成立：迁移是否完成属于真实数据导入和基础设施元数据，不应由候选环境检查伪造。

B1 将其替换为：

```text
candidateSchemaReady
```

含义仅为：

```text
候选 SQLite 已可按当前 Schema 打开，且当前候选层检查可执行。
```

它不表示：

```text
已迁移
已导入真实数据
已切换主库
已具备正式使用资格
```

## 【三、B1 最小 Local API 契约】

新增只读诊断入口：

```http
GET /api/candidate-environment
```

它不是业务 API、不是 bootstrap 读模型，也不返回 Item / Review / Method / BackupData。

### 1. API 可达且候选环境可用

```http
200 OK
Cache-Control: no-store
```

```ts
type CandidateEnvironmentReady = {
  status: 'ready'
  diagnosticId: 'CANDIDATE_READY'
  databasePath: string
  checks: {
    apiReachable: true
    databaseOpenable: true
    databaseWritable: true
    candidateSchemaReady: true
    integrityPassed: true
  }
}
```

### 2. API 可达但候选 SQLite 不可用

```http
503 Service Unavailable
Cache-Control: no-store
```

```ts
type CandidateEnvironmentUnavailable = {
  status: 'database-unavailable'
  failureCategory:
    | 'database-directory-unavailable'
    | 'database-open-failed'
    | 'database-write-unavailable'
    | 'schema-migration-failed'
    | 'integrity-check-failed'
    | 'unknown-database-error'
  diagnosticId:
    | 'SQLITE_DIRECTORY_UNAVAILABLE'
    | 'SQLITE_UNAVAILABLE'
    | 'SQLITE_WRITE_UNAVAILABLE'
    | 'SQLITE_SCHEMA_UNAVAILABLE'
    | 'SQLITE_INTEGRITY_FAILED'
    | 'SQLITE_CANDIDATE_UNKNOWN'
  databasePath: string
  message: string
  checks: {
    apiReachable: true
    databaseOpenable: boolean
    databaseWritable: boolean
    candidateSchemaReady: boolean
    integrityPassed: boolean
  }
}
```

`message` 是面向用户的稳定、脱敏说明；禁止返回 SQLite 原始错误、SQL、堆栈、文件内容和备份内容。

### 3. Local API 完全不可达

这不是服务端响应，由前端 adapter 分类：

```ts
type CandidateEnvironmentUnknown = {
  status: 'unknown'
  diagnosticId: 'LOCAL_API_UNAVAILABLE' | 'LOCAL_API_RESPONSE_INVALID' | 'LOCAL_API_TIMEOUT'
}
```

前端固定显示“暂时无法确认候选环境状态”，不得将其描述为 SQLite 损坏或当前用户数据不可用。

### 4. 固定地址信任边界

前端 adapter 的 API base 必须为编译时固定值：

```text
http://127.0.0.1:32145
```

日常静态托管同源时允许请求相对 `/api/candidate-environment`，但必须确认页面 origin 就是：

```text
http://127.0.0.1:32145
```

开发 H5 只能通过明确代理转发至该固定地址。不得：

```text
读取用户输入的 API 地址
读取可编辑环境变量决定远程 host
因当前页面 host 不同请求任意同源 API
通过 localhost、IPv6 或局域网地址替换
```

`apiAddressTrusted` 是前端固定配置的结果，不是服务端返回的业务事实；无需出现在 API 响应中。

## 【四、诊断检查的可信实施边界】

B1 检查只能验证候选环境，不得改变业务事实。

### 可检查

```text
Local API 正常响应
SQLite 已成功打开
当前 Schema 初始化已完成
quick_check 已通过
SQLite 可获得写事务锁
```

### 写入能力探测

`databaseWritable` 不得通过创建 Item、Review、Method、metadata 或任何业务记录验证。

唯一允许的实现是：

```text
BEGIN IMMEDIATE
→ 不执行任何业务 INSERT / UPDATE / DELETE
→ ROLLBACK
```

或等价的 SQLite 无持久化写锁探测。该探测：

```text
不创建数据库
不迁移
不恢复
不导入 JSON
不清理、覆盖或删除文件
不改变 BackupData 或 system_metadata
```

若服务启动时数据库已无法打开，则诊断只能报告已知失败分类；不得为了“重新检查”尝试创建替代数据库文件。

### `quick_check` 与 Schema

S6-A 已在打开数据库时执行 Schema 初始化与 `quick_check`。B1 的诊断接口只读取其当前运行状态及受控写锁探测；不得重复执行会改变 Schema 的操作，也不得将“首次创建候选空库”伪装为迁移完成。

## 【五、前端 adapter 状态模型】

前端只消费以下状态：

```ts
type CandidateDiagnosticState =
  | { phase: 'idle' }
  | { phase: 'checking'; requestId: number }
  | { phase: 'ready'; result: CandidateEnvironmentReady }
  | { phase: 'unavailable'; result: CandidateEnvironmentUnavailable }
  | { phase: 'unknown'; diagnosticId: 'LOCAL_API_UNAVAILABLE' | 'LOCAL_API_RESPONSE_INVALID' | 'LOCAL_API_TIMEOUT' }
```

映射冻结：

| adapter 状态 | 设置页文案 |
|---|---|
| `idle` | 未检查 |
| `checking` | 正在检查 |
| `ready` | 已就绪 |
| `unavailable` | 不可用 |
| `unknown` | 暂时无法确认 |

任何状态均必须保持：

```text
当前工作台仍使用本地浏览器数据。
```

### 异步保护

```text
应用启动 → 静默检查一次
进入设置 → 显示当前会话的最后结果
重新检查 → 发起新 requestId
旧请求晚返回 → 忽略，不能覆盖最新检查状态
同一时刻不允许并发重新检查
请求失败 → 不清空 IndexedDB 页面数据、不弹全局错误
```

使用 `AbortController` 或等价 request-id 门闩均可；关键是以最后一次用户明确重试为准。

## 【六、设置页实现边界】

设计方案通过，前端只能在设置页增加低频诊断分组：

```text
候选环境诊断
用于确认未来本地数据库迁移所需的运行环境。
当前工作台仍使用本地浏览器数据。
```

允许：

```text
状态文本
重新检查
折叠的检查详情
诊断标识
由 API 返回的数据库路径
```

禁止：

```text
在事项池、详情、复盘、方法或顶部栏常驻展示
候选失败 Toast / 全局横幅
全页阻断
创建事项、备份恢复或迁移操作
将 ready 呈现为“已迁移”“正在使用 SQLite”“SQLite 已接管数据”
展示 HTTP 状态码、原始错误、SQL 或堆栈
```

## 【七、B1 自动化与验收】

### Local API 定向测试

必须新增并验证：

1. `GET /api/candidate-environment` 在 ready 时返回稳定 `ready` DTO；
2. 目录不可用、文件不可打开、完整性失败分别映射为稳定 `database-unavailable` 分类和诊断标识；
3. 写锁探测失败时返回 `SQLITE_WRITE_UNAVAILABLE`，且数据库业务备份与 `system_metadata` 前后完全不变；
4. 诊断接口不返回业务数据、原始错误、SQL 或堆栈；
5. 除诊断 / health 外，尚无业务 API。

### 前端定向测试（后续实施时）

1. IndexedDB 工作台初始化和现有业务操作不等待、不依赖诊断结果；
2. API 不可达、503、无效响应分别映射为 `unknown` 或 `unavailable`；
3. 候选状态不会变成工作台空态、阻断页或全局错误；
4. 重试期间禁止并发；旧响应不能覆盖新的结果；
5. 诊断不持久化进 IndexedDB / JSON 备份；
6. 构建与源代码检查确认 B1 没有从 IndexedDB 主路径迁移到 SQLite。

## 【八、允许修改的层与文件范围】

### 当前授权：B1 数据 / API 契约实施

允许：

```text
apps/local-api/**
packages/storage-sqlite/**（仅无持久化诊断能力或安全错误映射）
tests/local-api-s6b1*.test.ts
或 tests/local-api-*.test.ts

docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

禁止：

```text
apps/client/**
packages/application/**
packages/contracts/**
packages/storage-indexeddb/**
业务 API
SQLite 业务数据写入
真实迁移、双写、主库切换
```

### 后续前端实施授权条件

只有当 B1 API Contract 经数据层测试、QA 和架构复审通过后，才允许前端工程师修改：

```text
apps/client/**
```

且仅用于候选环境诊断 UI；不得移除或替换当前 IndexedDB 主路径。

## 【下一责任岗】

**数据 / Application / Repository 工程师（Local API B1 诊断 Contract）。**

## 【是否允许写代码】

**允许，仅限 Local API 候选环境诊断接口、无持久化写锁探测与定向测试；不允许前端实现或任何业务 API。**
