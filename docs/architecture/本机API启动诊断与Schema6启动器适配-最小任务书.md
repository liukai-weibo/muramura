# 本机 API 启动诊断与 Schema 6 启动器适配——最小任务书

> 日期：2026-08-03
>
> 状态：架构范围已冻结；待产品经理书面评审并按本文件范围单独授权编码。

## 【技术结论：有条件可行】

当前 HTTP/H5 对 MySQL 不可用与 Schema 未就绪保持脱敏 503 是正确边界，但 API 直接启动入口将所有异常压缩为 `API_STARTUP_FAILED`，无法区分 Migration 记录表缺失、Schema 版本落后、Schema 6 必需表缺失、MySQL 不可用与 API 端口冲突。可在不改 HTTP 契约、不输出原始 SQL/密码/堆栈、不自动迁移的前提下，为本机终端增加安全的结构化诊断。

日常库与 API 已以 Schema 6 为当前运行事实，`scripts/kb-start.ps1` 仍将健康门与成功输出硬编码为 Schema 5，会将真实 ready 的 Schema 6 API 误判为启动失败。不应把该副本改成另一个硬编码 6；API 的 `MYSQL_REQUIRED_SCHEMA_VERSION` 和监听前 Schema 门是唯一版本决策源，启动器只需确认自己启动的 API 返回 `ready / knowledge_base / <正整数 schemaVersion>`，并将该实际版本原样写入成功输出。

## 【可复用现有能力】

- `MYSQL_REQUIRED_SCHEMA_VERSION` 作为唯一最低 Schema 版本常量。
- `getMySqlHealth()` 的库名校验、`schema_migrations` 版本读取和 `assertMySqlPlatformSchemaReady()` 的必需表探测。
- `MySqlSchemaNotReadyError` 的既有类型身份，保持 HTTP `MYSQL_SCHEMA_NOT_READY` 映射不变。
- `startApiMain()` 的监听前失败关闭顺序。
- `tests/api-schema6-startup.integration.test.ts` 的随机临时库 Schema 5/6 启动门证据。
- `tests/local-start-schema5.test.ts` 对 PowerShell 启动器健康门的直接静态断言（实施时替换为不绑定特定版本号的测试）。

## 【最小新增能力与实施切片】

本次只允许一个实施切片，内含两个不可分离的启动修正：

1. 将 Schema 未就绪原因结构化为 `migration-table-missing`、`schema-version-behind` 与 `required-table-missing`，附带安全的 database、actual/required version 及可选 requiredTable 事实。
2. API 直接启动失败时，终端输出稳定的错误 code、安全详情与下一步命令；未分类异常继续只输出通用错误，不打印原始 `error.message`、stack 或对象序列化。
3. 移除日常 PowerShell 启动器对 Schema 5 的版本决策副本：health 门仅接受 `ready / knowledge_base` 且 `schemaVersion` 为正整数的实际 API 响应，成功 JSON 写入同一响应的实际版本；其他端口、进程归属、拒绝接管与停止语义不变。
4. API 子进程在隐藏窗口启动失败时，一键启动器必须把同一条安全结构化诊断传回调用终端，不能只保留 `daily API did not become ready`；仅允许回显受控 `API_STARTUP_FAILED` 白名单行，不得透传任意子进程输出。
5. 同步本机启动文档中的 Schema 6 与当前空账户事实，不改写历史验收记录。

## 【数据可信边界】

- 终端诊断只使用当次实际连接返回的 database、`schema_migrations` 版本与必需表缺失事实，不从端口、历史文档或容器名推断。
- HTTP/H5 继续只获得现有脱敏 503，不得增加 database、version、table 或 migration 详情。
- 终端不得输出 host、user、password、Cookie、原始 SQL、MySQL 原始 message、stack、绝对路径或业务数据。
- `database` 只可来自已解析配置/当次连接的校验事实；不得输出整个 environment。

## 【实施方案】

### Storage 错误事实

- 保留 `MySqlSchemaNotReadyError` 的 `instanceof` 身份和现有通用 message。
- 为其新增只读结构化 details：`reason`、`database`、`requiredSchemaVersion`、可选 `actualSchemaVersion`、可选 `requiredTable`。
- `schema_migrations` 缺失时标记 `migration-table-missing`；版本小于 6 时标记 `schema-version-behind`；版本达标但 `user_roles` 或 `security_audit_events` 缺失时，仅在底层 code 为 `ER_NO_SUCH_TABLE` 时标记 `required-table-missing`，其他 MySQL 异常不得伪装为 Schema 问题。

### API 终端诊断

- 在 `apps/api/src/main.ts` 实现可单测的纯格式化函数。
- Schema 错误格式固定包含 `API_STARTUP_FAILED`、`code=MYSQL_SCHEMA_NOT_READY`、reason、database、actual/required version（有值时）与下一步；版本落后/记录表缺失提示 `corepack pnpm db:migrate`，必需表缺失提示停止并检查 migration 状态，不诱导手工修表。
- 安全识别 `EADDRINUSE` 为 API 端口冲突；MySQL 连接/认证常见 code 只归类为 `MYSQL_UNAVAILABLE`，不回显底层 message。其他异常保持单一通用 `API_STARTUP_FAILED code=INTERNAL_ERROR`。
- 不在任何分支自动调用 migration runner，不自动重试。

### PowerShell 启动器

- `Test-DailyReady` 只接受 HTTP 200、`ready`、`knowledge_base` 与正整数 `schemaVersion`；不再持有具体 Schema 版本常量。API 能够监听已证明它通过当前代码的唯一 Schema 门。
- 成功输出必须复用最后一次通过验证的 health 响应，`schemaVersion` 写入该响应的实际值，不重新发请、不猜测、不从 Migration 文件名推导。
- API 子进程的 stdout/stderr 只可重定向到既有 `$TempRoot` 下的固定文件；API 未 ready 时，只读取并回显 `API_STARTUP_FAILED` 且 code 属于 `MYSQL_SCHEMA_NOT_READY`、`MYSQL_UNAVAILABLE`、`API_PORT_IN_USE`、`INTERNAL_ERROR` 的最后一行，随后保留既有通用启动失败提示。不得把 pnpm/Node/PowerShell 的任意原始输出直接透传。
- 不改动 MySQL 启动、API/H5 子进程归属、端口冲突拒绝、日志位置或停止逻辑。

## 【是否涉及 Schema / Migration / 备份】

不涉及。禁止新增或修改 Migration，禁止对 `knowledge_base`、`knowledge_base_uat` 执行 DDL/DML，禁止备份恢复、claim、账户/角色写入或数据卷操作。

## 【运行库隔离与风险保护策略】

- 纯格式化与启动器测试不加载 `.env`，不连接 MySQL。
- Schema 5/6 启动门集成测试若执行，必须继续使用随机临时 database 与临时账号，先确认 API `/health` 的实际 database/schemaVersion，并按既有 `finally` 清理；不得将 `.env`/`.env.uat` 的运行库作为测试目标。
- 本切片不重启或替换当前 API/H5/MySQL，不运行 Compose，不停止、删除或重建任何容器/卷。

## 【允许修改的文件或层】

生产与启动文件：

- `packages/storage-mysql/src/index.ts`
- `apps/api/src/main.ts`
- `scripts/kb-start.ps1`

直接测试：

- 新增 `tests/api-startup-diagnostics.test.ts`
- `tests/api-schema6-startup.integration.test.ts`
- 将 `tests/local-start-schema5.test.ts` 替换为 `tests/local-start-schema-health.test.ts`

必要记录：

- `docs/development/本机迁移与一键启动.md`
- `docs/product/当前运行事实.md`
- `docs/daily-contributions/2026-08-03.md`
- 本任务书对应的产品授权、QA 与验收记录

上述以外文件一律不动；不修改 `apps/api/src/api-errors.ts`、HTTP schema/路由、Migration、Docker/Compose、`.env*`、Application、Repository 业务实现、Contracts 或 H5。

## 【自动化测试与 UAT 建议】

1. 纯单测覆盖三类 Schema 原因、端口冲突、MySQL 不可用与未分类异常的终端文本。
2. 每个输出使用密码、host、user、SQL、stack 哨兵值反向断言不泄漏。
3. 既有 Schema 5 临时库启动拒绝应进一步断言 `actual=5 / required=6 / database=<random>`，Schema 6 仍只在监听步骤成功。
4. 启动器静态测试必须断言 health 门不再硬编码任何 Schema 版本，拒绝缺失/非正整数版本，并将最后一次已验证 health 的实际 `schemaVersion` 写入成功 JSON。
5. 启动器静态测试必须断言隐藏 API 子进程输出写入既有临时目录，并且失败时只回显受控结构化白名单行，不回显任意错误文本。
6. 保持 HTTP `/health` 与普通 API 的脱敏 503 现有测试不变。
7. 工程门：定向单测、既有 Schema 6 启动门集成测试（仅随机临时库）、`corepack pnpm typecheck`、PowerShell 语法解析与 `git diff --check`。
8. 本切片不要求浏览器 UAT；产品验收只需真实本机终端证明 Schema 落后时输出可操作诊断，但不得对两个运行库降级或删改 migration 记录；只能使用随机临时库证明。

## 【交付给产品经理的授权条件】

1. 明确授权上述三个生产/启动文件、三个直接测试范围与必要记录。
2. 确认 HTTP/H5 错误契约继续脱敏且不变，详细信息只进入本机终端。
3. 确认不自动迁移、不自动重试、不修改 Migration/Schema/运行库/容器与账户。
4. 确认本切片编码和测试通过后只转 QA，不在实施会话内宣称产品验收或封板。
