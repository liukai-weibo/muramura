# 平台角色与最小权限管理 V1—切片 5 随机 Schema 6 临时库全链路隔离 QA 任务书

日期：2026-07-31
状态：架构冻结完成；尚未获得切片 5 独立测试授权

## 技术结论

有条件可行，并且必须以测试专用编排完成。切片 1–4 的生产源码已经产品验收；切片 5 不再新增或修复业务能力，只在随机临时 MySQL database、随机临时账号、随机 loopback API/H5 端口及全新无持久化 Chromium context 中验证真实全链路。

允许后续独立测试授权新增测试编排代码，但只可位于 `tests/**`。不得修改任何生产源码、既有 Migration、package script、配置、Docker、运行服务或运行库。当前 `knowledge_base` 与 `knowledge_base_uat` 均为 15 表、Schema 5、平台表 0，真实 006 仍不得部署。

## QA 目标与非目标

本切片只回答：

- 既有 001–006 在全新临时库能否形成可启动 Schema 6，Schema 5 是否仍在监听前失败关闭。
- 初始管理员 CLI、真实 Cookie 会话、管理 API 与 H5 管理入口能否形成一致闭环。
- 认证角色实时刷新、错误映射、事务并发、unknown-outcome、503 与 owner 隔离是否在真实 HTTP/浏览器链路成立。
- 测试能否在不触碰两个运行库的前提下创建、使用并彻底清理临时资源。

非目标：真实 006 部署、日常/UAT 管理员初始化、人工 UAT 数据写入、性能/压力/极限测试、生产发布、Docker/云端验证、HTTPS、视觉重设计或功能修复。发现缺陷只能报告并回流，不得在本授权内改生产代码。

## 唯一允许的测试拓扑

```text
全新 Chromium Context（每个用户独立、无 storageState）
  → 随机 127.0.0.1:H5_PORT 静态 H5 + 测试代理
  → 随机 127.0.0.1:API_PORT 正常 API
  → 随机 kb_platform_v1s5_<runId> 临时 Schema 6

故障阶段：
H5 测试代理
  → 随机 127.0.0.1:FAULT_API_PORT 专用错误凭据 API
  → 同一临时 database（认证失败，返回既有 MYSQL_UNAVAILABLE）
```

强制不变量：

- MySQL 只允许连接本机 `127.0.0.1:3306` 或语义等价的 `localhost:3306`；拒绝远程 host 和其他端口。
- API、fault API、H5 均由操作系统 `listen(0, '127.0.0.1')` 分配随机端口；不得监听 `0.0.0.0`，不得占用或停止 10086、32146、3306。
- 浏览器只能访问随机 H5 origin；`/api` 与 `/health` 由测试代理转发。代理按既有部署方式移除浏览器 Origin 后转发，不扩大 API CORS。
- 正常 API 与 fault API 每个实例只连接本次临时 database。任何 health 若返回 `knowledge_base` 或 `knowledge_base_uat`，立即中止且不得继续浏览器操作。
- Chromium 必须 headless、非持久化；每个用户使用独立 `browser.newContext()`，禁止复用个人浏览器 profile、Cookie、localStorage、IndexedDB 或已有 storageState。

## 显式执行门

测试编排默认必须跳过。只有以下全部条件满足才运行：

- `KB_PLATFORM_V1_SLICE5_E2E=1`。
- `KB_PLATFORM_V1_SLICE5_ALLOW_TEMP_DDL=YES-I-UNDERSTAND`。
- 进程环境已由 QA 在项目外安全注入 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_ROOT_PASSWORD`；测试文件不得读取或解析 `.env`、`.env.uat`。
- host/port 精确通过本机 MySQL 白名单，root 初始连接显式选择系统库 `mysql`。
- `apps/client/dist/index.html` 存在且来自本轮授权后的 `build:h5`。

不得在命令行参数、PowerShell transcript、Vitest reporter、截图文件名或报告中打印密码。授权后的标准入口只允许串行执行：

```text
corepack pnpm --filter @knowledge-base/client build:h5
corepack pnpm vitest run --no-file-parallelism tests/platform-administration-v1-slice5.e2e.test.ts
```

环境变量值由 QA 预先安全注入，任务书与测试日志均不得回显。

## 临时 database、账号与权限

每次 run 生成不可预测 runId，并且仅允许创建：

- database：`kb_platform_v1s5_<runId>`。
- app user：`kb_pv1s5_app_<boundedRunId>`。
- migrator user：`kb_pv1s5_mig_<boundedRunId>`。
- 每个账号使用独立 `crypto.randomUUID()` 或 `crypto.randomBytes()` 生成的随机密码。

创建前必须断言名称匹配固定正则、长度符合 MySQL 限制、与两个运行库不相等，并且本次名称此前不存在。动态标识符只能来自该正则生成器，不接受外部字符串拼接。

权限保持冻结范围：

- app 账号仅拥有该临时 database 的 `SELECT, INSERT, UPDATE, DELETE`。
- migrator 账号对本次随机临时 database 的权限精确冻结为 `SELECT, INSERT, CREATE, ALTER, INDEX, REFERENCES`；这些权限仅用于既有 001–006 的预检、建表/改表/索引/外键及写入 `schema_migrations`，不得授予 `DROP`、`UPDATE`、`DELETE`、全局权限、`GRANT OPTION` 或其他 database 权限。
- root 只用于创建/删除本次临时 database 与两个临时账号、核对 grants、建立两运行库只读快照；不得执行运行库 DDL/DML。
- 测试前后比较 `SHOW GRANTS` 结构事实，证明 grants 未扩大；输出只能是权限代码与随机 database，不含密码。

## Schema 5 → Schema 6 启动门

同一临时 database 按以下顺序验证，禁止通过删除运行库 migration record 模拟：

1. 仅执行既有 001–005，确认 `schemaVersion=5`、15 个 base table、平台表 0。
2. 调用真实 `startApiMain` 启动门，但注入不实际绑定端口的 create/listen spy；必须在 createServer/listen/log 之前拒绝，不得尝试绑定当前 32146。
3. 仅对该临时 database 执行未经修改的 `006_add_platform_roles_and_security_audit.sql`。
4. 确认 `schemaVersion=6`、平台两表结构/约束存在，既有用户 member 回填符合冻结事实。
5. 再次调用 `startApiMain` 门，确认允许进入 create/listen 步骤；该步骤仍不绑定 32146。
6. E2E 正常 API 使用 `createApiServer` 连接该 Schema 6 临时库并在随机 loopback 端口真实监听。
7. 正常 API 及 H5 代理 `/health` 均必须为 `ready / <随机临时database> / schemaVersion=6`，随后才允许注册或管理写入。

任何 Schema/health 事实不符均为 P1 阻断；不得自动重建、修表或回退后继续。

## 初始管理员 CLI 与真实 Cookie

必须按真实顺序完成：

1. 通过真实 H5 注册 adminCandidate、memberA、memberB；每人使用独立 browser context 和随机登录密码。
2. adminCandidate 注册后的旧 Cookie 先证明角色只有 `member`，且 H5 无管理入口。
3. 调用已验收 `runInitialPlatformAdminCli`，参数精确为显式 `--user-id`、随机 `--expected-database`、`--apply`；环境只含临时 app 凭据。
4. 捕获 CLI stdout/stderr 到内存，断言 granted、目标 userId 与 database 正确；不得把 CLI operationId 原文写入 reporter 或证据。
5. 不重新登录、不更换 adminCandidate Cookie；旧 Cookie 下一次真实 `GET /auth/session` 必须读取 `['member','platform_admin']`。
6. 在同一旧 Cookie context 重新加载 H5，必须出现用户管理入口并成功读取管理列表。
7. CLI 对同一目标再次执行为幂等，对另一目标在已有管理员时拒绝；不得新增第二条初始化审计。

Cookie 只断言名称、HttpOnly、SameSite、Path、有效期和是否失效；value 只留内存，禁止打印、截图、写 HAR 或附入报告。

## 真实 H5/API 端到端闭环

### 用户列表、搜索与分页

- 通过真实注册链创建至少 22 个 member，使列表跨两页；不得直接插入用户绕过注册默认 member 事实。
- 管理 H5 验证固定 20、total、稳定分页、上一页/下一页、username 字面量搜索、清除搜索和显式刷新。
- H5 DOM 只出现 username、角色、createdAt 与操作；不得出现内部 userId、密码/哈希、Cookie、会话、审计、邮箱或业务数量。
- 通过代理延迟两次真实 GET，验证搜索→翻页→刷新乱序、写入与旧 GET 交错时，旧结果不覆盖事实且读取状态不永久停留。

### 角色调整与旧 Cookie 实时角色

- adminCandidate 在 H5 向 memberA 授予 platform_admin；Network 只有一条 PUT，body 为规范 UUID operationId，页面只采用服务端摘要。
- memberA 注册时取得的旧 Cookie 无需重新登录；下一次 `/auth/session` 必须读取最新管理员角色，重载 H5 后出现入口。
- 由另一管理员撤销 memberA 管理员角色；memberA 旧 Cookie 继续保持登录，但下一次管理 GET 必须为 403，H5 隐藏入口、卸载管理页面并返回行动模块。
- 被撤销者自己的业务数据仍可按 member owner scope 读取；不得把角色撤销解释为账号或数据删除。

### 会话撤销

- 同一 target 用户建立至少两个独立真实 Cookie context。
- 管理员 H5 撤销其全部会话；Network 只有一条 POST，明确成功只显示 revokedSessionCount。
- 两个旧 Cookie 随后的 `/auth/session` 均为 401，管理员及其他用户会话不受影响。
- 当前管理员自己的行不显示角色或会话写入口；直接调用自会话撤销仍为冻结 403。

## 错误、事务与并发场景

以下场景都在同一随机临时库执行，允许测试编排用临时 app/migrator 连接做受控锁和断言，但不得改生产代码：

- member 使用真实 Cookie 调用三条管理 API：目标存在/不存在、合法/非法请求体均统一 403 + requestId，安全表零写入；H5 member 始终无入口。
- 管理员操作不存在 target：404 `NOT_FOUND + requestId`，H5 保留旧列表并提供显式刷新。
- 同一已提交 operationId 在 actor 仍有权限、目标有效且非自操作时重放：409 `CONFLICT + requestId`，不得推断前次成功；operationId 只在内存比较，不落盘证据。
- actor 在 HTTP 会话认证完成后、Repository 事务取锁前被受控降级：请求最终 403，目标角色/审计零写入，H5 完整卸载。
- 两名管理员用两个 Cookie 并发互撤：仅一次 200，另一次 403；最终至少一名 platform_admin，只有一条成功撤销审计，不出现 `last-platform-admin`。
- 单管理员自角色调整稳定 403 `self-role-change`；不制造不可达错误优先级。

受控直接 SQL 仅允许临时库 fixture 核对、管理员集合锁、actor 降级和并发后验。连接必须在 finally 回滚/关闭，SQL 中不得出现运行库名。

## unknown-outcome 与故障注入

测试代理只允许四种可复位模式，默认 normal，每个故障必须一次性消费并自动回到 normal：

```text
normal
delay-next-read
drop-next-completed-write-response
route-next-request-to-mysql-unavailable-api
```

浏览器内可另对一条已完成 fetch 抛出 `AbortError`，但必须记录服务端已完成响应且 Network 只有一条目标写请求。不得停止 MySQL 容器、正常服务或当前 API，不得改用户权限、端口、`.env` 或数据库配置。

### 角色 unknown-outcome

- 对两个目标分别让真实角色 PUT 在服务端完成后丢弃响应，证明每个目标只有一条写请求、保留写前角色、无自动重试并独立进入 role-unknown。
- 显式搜索/刷新只返回目标 A 时，只采用 A 的服务端角色并解锁 A；目标 B 保持旧事实与锁。随后显式 GET 返回 B 才解锁 B。
- 错误凭据 API 返回真实 503 `MYSQL_UNAVAILABLE + requestId` 时不得乐观更新或重试；恢复 normal 后只有显式 GET 可以确认当前角色。
- 另覆盖一次真实写已完成后浏览器抛出 AbortError，行为与响应丢失一致。

### 会话 unknown-outcome

- 让真实撤销会话 POST 在服务端完成后丢弃响应或抛出 AbortError；页面显示会话专用 unknown，列表 GET 不得解除。
- 恢复 normal 后，管理员必须再次点击“再次撤销会话”、重新阅读确认层并最终确认；第二次使用全新 operationId，只发一条新 POST。
- 第二次可能返回 revokedSessionCount=0，这是新的明确事实；不得据此倒推第一次一定成功。
- 错误凭据 API 的 503 同样进入会话 unknown；恢复后不得用用户列表声称已确认。

故障证据只记录 method、脱敏 path、status、请求次数、error code/requestId 和 `operationId: <redacted>`；禁止 HAR、trace、原始 headers、Cookie 或完整 request body。

## platform_admin owner 隔离回归

通过真实 API 在 ownerA scope 完成一个覆盖十个业务集合的既有闭环，并由另一个 platform_admin Cookie 验证：

- 自己的事项、方法、复盘、探索主线、回收站和 Backup 只包含自己的数据。
- 对 ownerA 可按 ID 寻址的事项、状态事件、关系、复盘、方法、证据、版本、应用、墓碑和探索主线读写/删除/恢复均保持不泄露 404。
- 跨 owner 尝试前后十个业务集合内容快照一致，零补偿写入。
- 管理员导出 Backup 不包含 ownerA 数据；导入包含其他 owner 数据 ID 的 Backup 沿用 ownership-conflict 拒绝，不能接管数据。
- 管理页面返回的 userId 不得被传入业务 scope、Backup query/body 或前端业务 API。

不得为简化 QA 直接改 owner_user_id、复制运行数据或引入共享语义。

## 敏感信息保护与扫描

本轮以下全部不得落盘或输出：root/app/migrator/login 密码、password_hash 原文、Cookie value、会话原始 secret/摘要、operationId 原文、`.env`/`.env.uat` 私有配置值。

- 随机秘密只存在测试进程内存和临时数据库；不得作为命令行参数、测试名、console、异常 message 或快照值。
- CLI 输出、HTTP bodies 和代理请求体先在内存提取，只输出布尔、数量或脱敏结构；失败信息不得包含 received 原文。
- 禁止 Playwright trace、HAR、video、storageState 和含 Network headers/body 的附件；截图只能包含无秘密 UI。
- 生成独特 canary 后，在 finally 清理前扫描允许新增测试文件、`apps/client/dist`、项目 Git diff 文本、测试捕获 stdout/stderr 和项目外证据目录。只报告文件路径与敏感类别，不报告匹配值。
- 对动态 Cookie/operationId/password_hash 内存集合执行精确值扫描；临时数据库内按设计保存的值不属于泄漏，但 database 删除后必须消失。
- 公共响应/DOM/Backup 另做字段名扫描，拒绝密码/哈希、Cookie、session secret/hash、审计内容及额外个人数据字段。

QA 报告可以保留 requestId；requestId 不得代替或关联输出 operationId。

## 两运行库只读深度快照

在创建临时资源前和全部 finally 清理后，分别对 `knowledge_base`、`knowledge_base_uat` 建立只读一致性深度快照：

- 先断言 database 名精确、15 个 base table、`schemaVersion=5`、平台两表均不存在。
- 使用 read-only consistent snapshot；只执行 `SELECT`/`SHOW`/`information_schema` 查询，不加写锁，不执行登录、注册、health、Migration、Backup 或业务 API。
- 摘要覆盖表/列/索引/约束、schema_migrations、所有表按主键稳定排序的全量内容；BLOB/日期/NULL 固定规范化并流式 SHA-256。
- password_hash、session hash 等原始值只能进入内存哈希流。证据只保存 database 名、Schema/表数量和最终 SHA-256。
- PRE/POST 必须各自 `SNAPSHOTS_IDENTICAL`。任何差异即 QA 不通过；不得 reset、恢复、清理或改写运行库制造一致。

执行窗口内用户不得操作日常 H5；测试不得停止、重启或替换当前日常 API/H5/MySQL。

## finally 清理与失败回退

嵌套 finally 顺序固定：

1. 代理恢复 normal 并停止接收新请求。
2. 关闭全部 browser page/context/browser，不保存 profile。
3. 关闭随机 H5、fault API、normal API，确认随机端口释放。
4. 回滚并关闭受控锁连接、app/migrator pool。
5. 仅当名称再次通过固定正则和 runId 匹配时，DROP 本次随机 database。
6. 仅删除本次两个临时 MySQL 账号，不修改任何既有账号/grants。
7. 只读确认本次 database/账号均不存在，关闭 root pool。
8. 执行敏感值扫描与两运行库 POST 快照。

项目外 `%TEMP%\kb-platform-v1-s5-<runId>\resource-manifest.json` 只记录随机资源名称、PID/端口和阶段，不得记录密码、Cookie、operationId、userId 或请求体。正常清理后删除；异常退出时保留，QA 只可依据同一独立测试授权重试清理这些精确资源。

若 finally 失败：QA 直接不通过；先停止本轮随机进程；只清理 manifest 指定且通过 runId/正则双重校验的临时资源。清理仍失败时回产品经理重新授权，不得修改 MySQL 容器、mysql-data 或运行库。

## 精确允许文件与测试编排裁决

裁决：允许且必须新增测试编排；不允许修改生产代码。

产品后续切片 5 独立测试授权只可新增：

- `tests/platform-administration-v1-slice5.e2e.test.ts`：场景、断言和测试入口。
- `tests/helpers/platform-administration-v1-slice5-harness.ts`：仅临时资源生命周期、随机端口 H5 代理、故障一次性编排、只读快照、脱敏和 finally 清理。

只允许新增/更新记录：

- `docs/architecture/平台角色与最小权限管理-V1-切片5-独立QA报告.md`。
- `docs/product/当前运行事实.md`。
- 产品后续切片 5 测试授权/验收记录。
- 完成工程验证或 H5 人工验收后按章程追加 `docs/daily-contributions/2026-07-31.md`；只记录测试基础设施增加项或实际缺陷修复，不记录通过数量和过程。
- 项目外 `%TEMP%\kb-platform-v1-s5-<runId>\` 脱敏临时证据。

现有测试和生产文件只能读取/执行，不得编辑。明确禁止修改：

- `apps/api/src/**`、`apps/client/src/**`。
- `packages/contracts/src/**`、`packages/application/src/**`、`packages/storage-mysql/src/**` 及其他 packages。
- `migrations/**`、`scripts/**`、根或应用 `package.json`、lockfile。
- `.env`、`.env.uat`、`.env.example`、Docker、端口、MySQL 配置、账号初始化脚本。
- 两个运行库、现有账号/会话/业务数据、MySQL 容器、mysql-data、云端。

若测试需要生产注入点、路由、DTO、日志或配置变更，切片 5 立即阻断并回架构/产品重新立项，不得以 QA 名义实现。

## 验证命令与验收门

获得独立测试授权后，建议顺序：

1. 两运行库 PRE 快照与环境安全门。
2. `build:h5`。
3. 新增切片 5 E2E 单文件串行运行。
4. 切片 1–4 平台角色定向后端/前端测试串行回归。
5. 既有完整 MySQL 回归、完整 H5 回归和认证/owner 隔离回归。
6. `typecheck`、`build:h5`、`git diff --check`。
7. finally 零残留、敏感扫描与两运行库 POST 快照。

验收必须同时满足：

- 所有闭环与故障证据通过，无 P0/P1。
- 正常/fault health、随机 database、Schema 5/6 启动门可追溯且无运行库混用。
- Network 证明 unknown 场景每次只有一条目标写请求、无自动重试。
- 敏感信息扫描无泄漏。
- 临时 database、账号、随机监听进程、browser context 和证据临时秘密零残留。
- 两运行库 PRE/POST 分别 `SNAPSHOTS_IDENTICAL`，仍为 15 表、Schema 5、平台表 0。
- 工作区既有脏改动未被 reset、clean、删除、移动、暂存或覆盖。

切片 5 QA 通过只构成平台角色 V1 最终产品验收输入，不自动授权真实 006、初始管理员真实授予、API/H5 重启部署或运行库接入。必须回产品经理作最终验收与后续真实部署的独立裁决。

## 当前状态

切片 5 QA 架构与任务书已冻结，尚未授权新增测试编排或执行任何命令。下一责任岗为产品经理签发“平台角色与最小权限管理 V1—切片 5 随机 Schema 6 临时库全链路隔离 QA 独立测试授权”。
