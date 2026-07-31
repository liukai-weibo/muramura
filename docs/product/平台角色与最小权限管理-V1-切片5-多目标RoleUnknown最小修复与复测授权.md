# 平台角色与最小权限管理 V1—切片 5 多目标 Role Unknown 最小修复与复测授权

日期：2026-07-31

状态：已授权四文件最小前端修复、直接交错测试及随后完整 8 项 QA 复测；切片 5 仍未通过

## 结论

产品依据 `docs/architecture/平台角色与最小权限管理-V1-切片5-多目标RoleUnknown读模型独立协调修复裁决.md`，确认多目标 `role-unknown` 稳定失败为生产 P1。根因是 reconciliation 以旧 `previous.items` 合并当前服务端结果，使未返回目标 B 污染当前查询并遮蔽已返回目标 A。

现授权严格按冻结范围将“当前可见服务端页”和“未解析 role-unknown 旧事实”分离，不改变 API、搜索、分页、权限或写入语义。

## 唯一允许修改的工程文件

生产前端：

- `apps/client/src/pages/index/platform-administration-state.ts`
- `apps/client/src/pages/index/platform-administration.tsx`

直接测试：

- `tests/platform-administration-h5-state.test.ts`
- `tests/platform-administration-h5-flow.test.ts`

必要的架构、QA、产品状态、验收记录及按章程触发的 `docs/daily-contributions/2026-07-31.md` 可同步实际结果。

## 冻结实现授权

- 每次通过 Abort、读取 generation、认证上下文和事实 generation 保护的成功 GET，当前可见 `PlatformUserPage` 必须精确采用本次服务端 `items`、`page`、`pageSize`、`total` 及服务端顺序。
- 禁止以 `previous.items` 为合并底表，禁止将未匹配目标 B 注入只返回 A 的搜索或分页结果，合法空结果不得被旧页遮蔽。
- `role-unknown` 改为仅前端内存、按 `targetId` 键控的 Map；每项保存 `formedAtFactGeneration` 与写入前最后一次由服务端确认的完整 `PlatformUserSummary`。
- 最后服务端摘要只能来自写入前已经 API DTO 校验的当前快照，不得由 requested roles、按钮动作、username、时间或前端推断生成。
- 写入编排在最终确认兼容性校验通过后、发送请求前冻结目标摘要；只有角色写入形成 unknown 时才建立 Map 记录。
- 当前有效 GET 返回某目标且读取事实 generation 不早于其形成 generation 时，只采用、解锁并清理该目标的记录、notice 和 lock。
- 当前 GET 未返回的目标继续保留其旧摘要记录、notice 与 `role-unknown` lock，但不得污染当前可见结果。
- reconciliation 纯函数不得修改输入 Map；组件只删除 resolved 目标。
- `sessions-unknown` 继续不由用户列表 GET 确认，不得纳入角色 reconciliation。
- 认证上下文卸载时这些内存记录随组件销毁，不得持久化或跨登录复用。

明确成功、明确 404/409 等结果不得伪造 unknown 记录；不得自动发起额外 GET、自动重试或补偿写入。

## 直接测试授权

至少覆盖：

- A、B 均 unknown，GET 只返回 A：可见 snapshot 精确等于服务端 A，A resolved；B 的记录、notice 和 lock 保持。
- 随后 GET 只返回 B：只解析 B，不改变已确认 A。
- query、page、pageSize、total 和服务端排序原样采用，不将 B 注入 A 的搜索或分页结果。
- 合法空结果真实显示，不被旧页或未返回 unknown 目标遮蔽。
- 失败、Abort、旧 generation、旧 auth、旧 fact 不改变当前可见事实或任何 unknown 状态。
- 写入前摘要来自已校验的服务端快照，不使用 requested roles 推断。
- 角色明确成功、404/409、503、响应丢失及 `sessions-unknown` 边界不回归。

## 前端工程门

修复后必须先通过上述直接测试、相关前端定向测试、完整 H5 回归、`typecheck`、`build:h5` 与 `git diff --check`，随后才能转完整 QA。

## 完整 QA 复测授权

- 必须原样串行执行切片 5 全部 8 项，不得调整 A/B 顺序、预先恢复 B 或修改 E2E/harness。
- B 未解析时搜索 A，单次有效 GET 返回 A 后，A 必须立即可见并采用服务端摘要；B 继续保持 unknown，直至后续显式 GET 返回 B。
- 完整覆盖后续 503、Abort、角色与会话两类 unknown、响应丢失及显式恢复。
- 不得产生自动写重试、额外补偿写入、自动 GET、轮询或成功推断。
- 临时目录、database、账号、进程、端口和浏览器 context 必须 finally 为 0。
- `knowledge_base` 与 `knowledge_base_uat` 前后只读深度快照必须分别为 `SNAPSHOTS_IDENTICAL`。
- 定向测试、完整 H5 回归、`typecheck`、`build:h5` 与 `git diff --check` 必须通过。

## 本轮 root 连接值一次性例外

- 本次完整 8 项 E2E 复测重新独立授权 QA 仅从仓库根未跟踪且已忽略的私有 `.env` 读取 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_ROOT_PASSWORD`，并只注入当前测试子进程内存。
- 只允许本机 `127.0.0.1:3306` 或等价 `localhost:3306`；其他 host 或 port 必须拒绝。
- 禁止读取 `.env.uat`，禁止回显、持久化、写回或将秘密放入命令参数、PowerShell transcript、stdout/stderr、Vitest reporter、截图、报告、临时 manifest、构建产物或 Git。
- 子进程结束后必须清除注入值。本例外只适用于本次四文件修复后的完整 8 项复测，不延续至后续 QA、部署或其他任务。
- root 只可管理本轮正则约束的随机临时 database/账号、核对临时 grants 及建立两个运行库的只读快照；不得对运行库执行 DDL/DML。

## 明确禁止

- 禁止修改切片 5 E2E/harness 来规避交错顺序。
- 禁止修改 `api-client.ts`、SCSS、API、Contracts、Application、Repository、Migration、Schema、Backup、配置或数据库。
- 禁止修改页面布局、管理按钮 role、搜索、分页、排序、权限、operationId 或业务写入语义。
- 禁止新增路由、DTO、字段、持久缓存、全局状态、自动 GET、轮询、自动重试或补偿写入。
- 禁止执行真实 006、授予真实管理员、写入运行库、重启或部署服务及云端操作。

## 验收门

只有四文件修复的直接与完整前端工程门通过、切片 5 全部 8 项 E2E 通过、多目标逐项确认及当前服务端页精确采用成立，无新增 P0/P1，临时资源零残留，敏感扫描无泄漏且两运行库分别 `SNAPSHOTS_IDENTICAL`，才能回产品经理执行平台角色 V1 最终产品验收。

本授权不构成切片 5 QA 通过、V1 最终验收、真实 006、真实管理员授予、运行部署或封板授权。
