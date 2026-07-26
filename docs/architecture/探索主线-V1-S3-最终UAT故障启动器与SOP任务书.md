# 探索主线 V1 S3：最终 UAT 故障启动器与 SOP 任务书

> 日期：2026-07-26
> 责任岗：架构师
> 状态：**待产品经理一次性授权工具实现与最终 UAT；不得实现业务功能或封板。**

## 【技术结论：可行】

将既有 `scripts/uat-api-fault.ps1` 收敛为唯一的 Windows UAT MySQL 不可用启动器，并以本 SOP 收敛后续工作。启动器只编排本地 loopback API 子进程及临时证据，不触及 API 业务代码、MySQL 容器或运行库结构。

最终 UAT 只补齐唯一未完成闭环：MySQL 不可用时 API 真实 `503`、H5 不伪造成功且保留草稿、恢复后用户显式重读确认。已通过的 unknown-outcome、生命周期、关联与视觉 UAT 证据不要求重复为低价值极限测试。

## 【可复用现有能力】

- `scripts/uat-api-fault.ps1`：已具备 loopback 监听检查、`.env.uat` 读取、直接启动 API、日志与 health 轮询基础；
- `scripts/uat-schema004-readonly-snapshot.sh`：对 `knowledge_base` 或 `knowledge_base_uat` 生成只读深度快照；
- 既有 API：`ER_ACCESS_DENIED_ERROR` 已映射为 `503 MYSQL_UNAVAILABLE`；无需修改 API。

## 【最小新增能力与允许修改范围】

仅授权实现测试工具及其直接测试/文档：

```text
scripts/uat-api-fault.ps1
tests/uat-api-fault*.test.ps1（如现有 PowerShell 测试设施可用；否则不新增测试框架）
docs/architecture/探索主线-V1-S3-最终UAT故障启动器与SOP任务书.md
docs/daily-contributions/YYYY-MM-DD.md（完成工程验证后）
```

禁止修改：

```text
apps/api/**、apps/client/**、packages/**、migrations/**、.env*、docker-compose.yml
MySQL 用户/权限、容器、端口、网络规则、数据库结构、migration record、mysql-data
任意业务对象、字段、状态、关系、路由、DTO、自动重试或生产能力
```

## 【固定故障启动器规格】

实现后的唯一入口为：

```text
powershell -NoProfile -File scripts/uat-api-fault.ps1 <action>
```

动作固定为：

| action | 行为与成功条件 |
| --- | --- |
| `status` | 输出 JSON：监听 PID、模式、临时状态文件是否存在、health 原文；不得写库。 |
| `start-normal` | **紧急恢复入口。**仅在端口空闲、`.env.uat` 经校验为 UAT loopback 配置后，直接启动正常 API main；不得依赖 state.json、不得运行 migrate/restore/Docker。health 必须恢复 ready、`database=knowledge_base_uat`、`schemaVersion=4`，否则停止新子进程并失败。 |
| `stop-normal` | 仅在 `/health` 为 ready、`database=knowledge_base_uat`、`schemaVersion=4` 时停止该 loopback API；否则拒绝。 |
| `start-mysql-unavailable` | 仅在端口空闲、`.env.uat` 的数据库名为 `knowledge_base_uat`、host/port 为固定 loopback API 配置后启动。子进程加载 UAT 环境，**仅在子进程**把 `MYSQL_APP_PASSWORD` 覆盖为固定无效测试值；直接运行 API main，不运行 migrate/restore/Docker。启动器只验证既有 `/health` 或既有冻结 GET 的标准 HTTP 503；冻结 GET 必须返回既有错误 DTO 的 `code=MYSQL_UNAVAILABLE` 与 `requestId`。不得新增 health 字段、诊断字段、路由或 DTO。失败时停止子进程。 |
| `restore-normal` | 仅接受由启动器状态文件记录的故障 PID；停止该 PID，再以未修改 `.env.uat` 直接启动 API main。health 必须恢复 ready、`knowledge_base_uat`、Schema 4，才删除状态文件。 |
| `stop-fault` | 仅停止状态文件记录的故障 PID，不执行恢复；供失败回退使用。 |

启动器临时 PID、模式、启动时间和端口写入 `%TEMP%/knowledge-base-uat-fault/`，日志也写入该目录；不得写入项目工作区、Git 或 `.env.uat`，不得记录任何密码。`start-mysql-unavailable` 与 `restore-normal` 均须等待 health 至多 30 秒；超时立即停止新进程、保留无敏感诊断并以非零退出。

状态文件不是可信的进程控制来源。每个 action 开始时必须清理已退出 PID 的陈旧 state；停止动作只能终止 state 中记录且仍与 32146 listener PID 一致的子进程。故障子进程启动时，必须在**该子进程内部**加载并校验 `.env.uat`，再覆盖唯一的 `MYSQL_APP_PASSWORD`，不得依赖父 PowerShell 的环境继承。建议通过 `powershell.exe -NoProfile -EncodedCommand` 启动该专用子进程，以隔离环境并避免命令行泄露凭据。

## 【数据可信边界】

- 启动前：读取 `.env.uat` 仅用于建立子进程环境，并硬拒绝 `MYSQL_DATABASE` 非 `knowledge_base_uat`、`API_HOST` 非 `127.0.0.1`、`API_PORT` 非 `32146`。
- 故障期间：只允许 H5 / API 的冻结 GET 读取；不允许 POST、PUT、PATCH、DELETE、restore、迁移或清库。
- 故障来源是 API 对 MySQL 的认证不可用，不是停止 API、浏览器断网或容器停止；因此 API 的既有 `MYSQL_UNAVAILABLE` 映射受真实验证。
- 恢复后：只允许用户明确触发 GET 重读确认；不得自动重试、补偿写入或按草稿推断成功。

## 【最终隔离浏览器 UAT SOP】

### 0. 准备与快照

1. 确认没有 API 监听后，以未修改 `.env.uat` 启动正常 API；`GET /health` 必须为 ready、`knowledge_base_uat`、Schema 4。
2. 在项目外受保护目录分别执行现有只读快照：
   `sh scripts/uat-schema004-readonly-snapshot.sh knowledge_base <daily-pre>`
   `sh scripts/uat-schema004-readonly-snapshot.sh knowledge_base_uat <uat-pre>`
3. 在 H5 `http://127.0.0.1:10086` 建立一个可见的草稿/明确关联选择，并读取一次现有真实数据，作为失败前页面基线。

### 1. MySQL 503 故障验证

1. 执行 `stop-normal`，再执行 `start-mysql-unavailable`；记录既有 `/health` 的标准 503 响应，不要求或检查新增诊断字段。
2. 在 H5 发起一个冻结 GET 读取（主线列表或事项关联读取）；不得发送写请求。
3. 验证 API 返回 503 `MYSQL_UNAVAILABLE`、错误 DTO 含 `requestId`；H5 不显示空列表或成功、不清空草稿或明确选择、不自动重试、不产生写请求。
4. 记录 Network、页面、错误 DTO、启动器 status 与 UAT 快照；本步骤的 UAT 业务集合应保持不变。

### 2. 恢复与真实重读

1. 执行 `restore-normal`；`/health` 必须恢复 ready、`knowledge_base_uat`、Schema 4。
2. 仅由测试人员触发一次冻结 GET 重读；验证页面显示真实数据，草稿/明确选择仍由用户控制，且无自动补偿写入。

### 3. 收尾证据与判定

1. 再次生成 `knowledge_base` 与 `knowledge_base_uat` 只读快照。
2. `knowledge_base` 前后 manifest、schema 与 records 必须 `SNAPSHOTS_IDENTICAL`；UAT 在故障场景未发生写入，亦应一致。
3. 失败即执行 `stop-fault` 或 `restore-normal`，重新确认 health ready / UAT / Schema 4，保留快照和日志；不得用 DDL、清库或临时改配置回退。
4. QA 输出唯一未完成项的通过/失败证据。通过后转架构复审，再转产品最终验收；任何一方未通过均不得封板。

## 【自动化测试与 UAT 建议】

启动器最小自动化验证只覆盖：拒绝非 UAT 环境、拒绝端口占用、故障模式 health 为 503、恢复模式 health 为 UAT ready、状态文件不含密码。不得为此新增 API 测试路由、故障注入接口或模拟 MySQL 容器。

浏览器 UAT 只执行上述一次故障—恢复闭环；不再重复已验收的低价值极限组合。

## 【Windows PowerShell 解析兼容性修复门】

`scripts/uat-api-fault.ps1` 必须以 **UTF-8 with BOM** 保存；运行时异常、拒绝提示和日志文本使用 ASCII，避免 Windows PowerShell 5.1 以系统代码页读取非 BOM 源码时破坏字符串边界。不得借此修改任何业务文件或引入新的脚本入口。

HTTP 503 轮询必须兼容 Windows PowerShell 5.1：不得使用 `Invoke-WebRequest -SkipHttpErrorCheck`。实现方应以 `Invoke-WebRequest -UseBasicParsing` 的 `try/catch` 和异常响应中的 status code，或等价 .NET HTTP 读取方式，取得既有 503；不得通过新增 health 字段或 API 诊断字段规避。

实现方先在 Windows PowerShell 直接执行以下解析门；未通过不得执行任何 fault action：

```text
powershell.exe -NoProfile -File scripts/uat-api-fault.ps1 status
```

该命令必须退出 0 且输出可解析 JSON。直接测试还必须覆盖：

1. `status` 不创建故障子进程、不写业务数据；`start-normal` 可在无 state 的紧急离线现场恢复 UAT ready health；
2. `stop-normal` 在 health 不满足 UAT ready / Schema 4 时拒绝，`start-mysql-unavailable` 在端口占用或环境门不满足时拒绝；
3. 受控 `start-mysql-unavailable` 后，既有冻结 GET 返回 HTTP 503、`code=MYSQL_UNAVAILABLE` 与 `requestId`；
4. `restore-normal` 能清理已退出的陈旧 PID state，并恢复 health ready / `knowledge_base_uat` / Schema 4；
5. `%TEMP%/knowledge-base-uat-fault/` 的 state 和日志不包含 `MYSQL_APP_PASSWORD` 值、固定无效密码或 `.env.uat` 的凭据文本。

任何解析失败、启动器遗留子进程、正常 API 未恢复、日志泄露凭据或日常库快照变化均为阻断；执行 `stop-fault` 或 `restore-normal` 后回流 QA 重测。

## 【交付给产品经理的授权条件】

产品经理如批准，应一次性书面授权：仅实现本启动器规格、执行本 SOP 一次、按证据转架构复审。授权不包含任何业务功能、API/H5 修改、数据库维护操作或探索主线 V1 封板。
