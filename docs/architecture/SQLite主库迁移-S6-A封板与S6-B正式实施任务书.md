# SQLite 主库迁移 — S6-A 封板与 S6-B 正式实施任务书

> 状态：**S6-A 封板。允许完成 S6-B 产品 / 设计 / 架构方案冻结与正式实施任务书；方案冻结前，不允许开始 S6-B 代码实现。**
>
> 当前唯一运行主库仍为 IndexedDB；SQLite 仍是候选存储，仅用于临时合成测试。
>
> 关联：`docs/architecture/SQLite主库迁移-S6-A架构复审与S6-B方案评审授权.md`。

## 【技术结论：S6-A 通过；S6-B 有条件可行】

S6-A 已完成其冻结范围：

```text
Node Local API 基础设施
127.0.0.1:32145 固定监听
SQLite 打开、Schema 初始化与 quick_check 保护
GET /api/health
已构建 H5 静态文件托管
静态资源不存在与编码路径穿越拒绝
```

定向及全量工程验证均已通过。S6-A 不包含业务 API、前端 HTTP Client、真实迁移或主库切换，这些边界未被扩大。

S6-B 的目标不是让前端“连上一个数据库”，而是以 Local API 作为唯一运行数据边界：

```text
浏览器页面
→ 前端 API adapter
→ 127.0.0.1:32145 Local API
→ Application Service
→ SQLite Repository
→ SQLite
```

但 S6-B 需要先由产品经理与设计师冻结页面状态、阻断页信息层级和可行动提示；架构师随后冻结 HTTP Contract 与异步状态保护。三个岗位输出完成前，前端不得开始改造页面。

## 【一、S6-A 封板结论】

### 1. 监听与网络边界

冻结：

```text
host = 127.0.0.1
port = 32145
```

实现已拒绝非该 host / port 的启动参数。禁止：

```text
0.0.0.0
局域网或公网暴露
自动选择其他端口
通过环境变量、CLI 或前端配置覆盖监听边界
```

### 2. 数据库失败语义

冻结：

```text
database-unavailable
= 唯一允许的数据库失败降级
```

数据库目录、文件打开、Schema 或完整性检查失败时，API 返回 `503` 与真实数据库路径；不得：

```text
创建替代空库
覆盖损坏文件
回退 IndexedDB / Dexie
回退浏览器空工作台
将失败伪装成无事项或首次使用
```

### 3. 静态托管边界

已实证：

```text
GET /                    → 200，index.html
GET /known-file.js       → 200，对应资源
GET /missing-file        → 404
GET /%2e%2e/secret.txt   → 404，未读取静态目录外真实文件
```

静态托管只服务已构建 H5 文件；不得把它扩张为文件浏览、任意路径读取或备份文件下载服务。

### 4. S6-A 非阻塞加固项

可在后续安全回归中补充其他多层 URL 编码路径变体，但它是 P3 测试加固，不阻断 S6-A 封板或 S6-B 方案冻结。若补测发现缺陷，只允许修复：

```text
apps/local-api/src/index.ts
tests/local-api-s6a.test.ts
```

## 【二、S6-B 目标与唯一事实源】

S6-B 完成后，**仅在开发 / 合成测试环境中**允许前端通过 HTTP 调用 SQLite 候选层；它仍不等于真实主库切换。

在 S6-B 实现及验证通过前：

```text
正式前端仍走 IndexedDB
SQLite 不接入页面
```

在 S6-B 通过但 S6-C 未验收前：

```text
前端 HTTP 路径只能用于临时合成 SQLite 测试环境
不得导入或写入真实个人数据
不得把 SQLite 描述为唯一主库
```

严禁任何过渡期双写：

```text
一次页面操作
→ 只能写 IndexedDB 或 SQLite 之一
→ 不得同时写两边
```

## 【三、S6-B 方案冻结前置条件】

### A. 产品经理必须输出

按项目岗位格式，冻结：

```text
【用户问题】
【目标】
【范围】
【非目标】
【关键业务规则】
【验收标准】
```

至少裁决：

1. 首次打开工作台时的加载态、ready、API 不可达、`database-unavailable` 三类状态；
2. 阻断页的用户文案、行动建议与“重试”含义；
3. API 不可达与数据库不可用是否使用同一视觉骨架、不同事实说明；
4. 当静态 H5 可加载但 Local API 不可用时，页面禁止进入工作台；
5. 本轮是否仅完成开发 / 合成环境的前端 HTTP 验证，明确不开始真实数据切换。

产品不得增加：

```text
账号、云同步、网络配置、选择数据库、数据合并、自动迁移
```

### B. 设计师必须输出

按项目岗位格式，冻结桌面优先的：

```text
加载态
API 不可达阻断页
database-unavailable 阻断页
重试中 / 重试失败状态
窄屏降级
```

阻断页必须：

```text
明确不是空态
说明当前未加载任何工作数据
显示固定地址 http://127.0.0.1:32145
在 API 可响应时展示数据库路径和可行动建议
提供单一明确的重试操作
```

不得展示：

```text
暂无事项
首次创建事项
自动初始化空数据
SQL 错误详情、备份正文或个人数据
```

### C. 架构师必须在产品 / 设计冻结后输出

冻结：

```text
前端 API adapter 模块边界
HTTP 请求 / 响应 DTO
错误分类与状态映射
bootstrap 读模型
业务 API 的最小分批顺序
开发 H5 代理边界
自动化与 H5 人工验收标准
```

## 【四、S6-B HTTP Contract 设计约束】

### 1. 先读后写，分批开放

S6-B 不允许一次性暴露所有 API。应按可验证切片推进：

```text
B1：health + bootstrap 只读模型 + 阻断页
→ QA / 架构复审

B2：Item、Trash、Search、Dashboard 读写 API
→ QA / 架构复审

B3：Review、Method、备份的业务 API
→ QA / 架构复审
```

B1 未通过前，不得开始 B2；B2 未通过前，不得开始 B3。

### 2. `bootstrap` 读模型

B1 应新增一个受控只读入口，供页面一次初始化获取所需工作台事实。它必须：

```text
由 Local API 内部调用 Application / Repository 的结构化读模型
不向前端暴露 SQLite 表、SQL 或万能查询
不让前端通过多请求自行拼接 Item、Review、Method、Evidence 关系
```

具体 DTO 必须在产品 / 设计明确首屏需要的信息后冻结；禁止为“以后可能需要”返回完整数据库备份。

### 3. 业务命令一一对应

后续 API 只允许映射既有 Application Contract。例如：

```text
updateItemContent
startExecution
changeStatus
completeReview
createItemFromMethod
moveMethodToTrash
restoreMethod
createBackup
restoreBackup
```

每个命令：

```text
一个 HTTP 请求
→ 一个 Application 命令
→ 一个可信事务边界
```

禁止：

```text
通用 SQL API
通用表 CRUD
前端传入关系推断结果
前端批量拼接跨表写入
绕过 BackupApplicationService.parseAndValidate()
```

### 4. 错误响应

错误响应至少区分：

```text
api-unreachable（浏览器网络层失败；前端本地分类）
database-unavailable（API 503）
validation-error（可预期业务校验失败）
not-found（资源或路由不存在）
internal-error（未预期服务端错误）
```

不得把内部 error stack、SQL、文件内容或真实备份数据返给浏览器。数据库路径仅在 `database-unavailable` 这一用户需行动的边界中返回。

## 【五、前端 adapter 与异步保护约束】

S6-B 允许构建前端 API adapter，但必须符合：

```text
不 import @knowledge-base/storage-indexeddb
不 import @knowledge-base/storage-sqlite
不调用 Dexie、IndexedDB、SQLite 或 SQL
不维护双数据库策略
```

对于用户意图和异步状态：

```text
保存失败 → 保留本地草稿
请求失败 → 不清空已呈现的有效列表 / 详情
旧 bootstrap / 详情响应 → 不覆盖用户后续选择或编辑草稿
状态迁移 / 保存失败 → 呈现可解释错误，不伪造成功
阻断状态 → 不渲染真实空态或创建事项入口
```

正式 H5 bundle 移除 IndexedDB 运行路径的验收必须同时包含：

```text
源代码依赖检查
构建产物 / bundle 检查
浏览器人工验证：无 Local API 时显示阻断页而非 Dexie 空库
```

## 【六、开发环境边界】

开发 H5 可配置固定代理，目标只能是：

```text
http://127.0.0.1:32145
```

开发服务器只提供热更新，不能成为数据服务或绕过 Local API。开发时 API 不可达也必须呈现与日常入口一致的阻断语义。

## 【七、S6-B 明确非目标】

```text
真实 IndexedDB → SQLite 导入
真实用户数据写入 SQLite
恢复点文件的真实运行实现
双写、同步、合并、冲突解决
主库切换、灰度、回退
SQLite Schema 或 BackupDocument 版本变更
账号、云端、协作、远程访问
```

上述全部属于 S6-C 或后续范围；未经新架构审批不得提前实现。

## 【八、当前允许修改范围】

当前仅允许方案与任务书：

```text
docs/product/**
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

在产品、设计和架构方案均冻结前，不允许修改：

```text
apps/client/**
apps/local-api/**
packages/application/**
packages/storage-sqlite/**
packages/storage-indexeddb/**
packages/contracts/**
```

## 【下一责任岗】

```text
产品经理
→ 定义 S6-B 阻断页与前端 HTTP 迁移的用户问题、范围与验收
→ 设计师输出状态与交互规范
→ 架构师冻结 B1 bootstrap / adapter Contract
→ 才能授权 B1 实施
```

## 【是否允许写代码】

**否。当前只允许 S6-B 产品、设计与架构方案冻结；前端、Local API 业务接口和真实迁移代码均未获授权。**
