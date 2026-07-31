# 平台角色与最小权限管理 V1—切片 5 独立 QA 报告

日期：2026-07-31
最新结论：通过。随机 Schema 6 临时库全链路 8 项全部通过，无新增 P0–P3；建议转产品经理执行 V1 最终产品验收，但不自动授权真实 006、真实管理员授予、运行库接入或部署。

## 2026-07-31 最终完整复测

- 唯一工程修改为授权的 Abort 恢复 locator：冻结 `abortTargetRow` 与 `abortNotice`，在同行 `.platform-user-actions` 内 exact 点击真实“刷新用户列表”按钮，并断言单 GET、零新增 PUT、notice 清除和管理按钮恢复。
- 原样串行执行切片 5 全部 8 项：1 file / 8 tests passed。
- Schema 5 启动拒绝、既有 006 后随机 Schema 6 启动、初始管理员 CLI、真实 Cookie 与旧会话角色刷新通过。
- 24 用户、固定 20 条分页、字面量搜索、服务端顺序、角色与会话管理、member 403、目标 404、operationId 409、actor 降级、自操作和并发互撤通过。
- A/B 多目标 role-unknown、503、Abort、截断响应、单次写入、无透明重发、显式 GET 恢复，以及 sessions-unknown 不由列表 GET 解锁、取消、重新确认和新 operationId 通过。
- platform_admin 未绕过十个业务集合或当前用户 Backup scope；公开 DTO、允许证据和扫描范围无凭据、秘密、哈希、审计内容或原始 operationId 泄漏。
- `build:h5`、`typecheck`、`git diff --check` 通过；仅有既有 Sass 与 LF/CRLF 提示。
- 项目外临时证据目录、`kb_platform_v1s5_*` 数据库、`kb_pv1s5_app_*` 与 `kb_pv1s5_mig_*` 账号均为 0；浏览器、端口和进程由 finally 清理。
- harness afterAll 对 `knowledge_base` 与 `knowledge_base_uat` 的前后只读深度快照分别比较通过：`SNAPSHOTS_IDENTICAL`。

## 最终问题与风险

- P0–P3：无新增问题。
- 剩余风险：本轮仅证明随机本机临时 Schema 6 环境，不构成真实运行库 Migration、真实管理员初始化、服务重启部署或运行验收。

## 最终验收建议

QA 通过，建议转产品经理执行平台角色 V1 最终产品验收。未经产品最终验收与后续独立运行授权，不得执行真实 006、真实管理员授予、运行库写入、服务重启部署或宣称 V1 封板。

## 2026-07-31 503 定位修正复测

- 仅修改授权的 E2E 文件：冻结唯一 `target503Row`，notice 只断言正文/requestId，并在同行 `.platform-user-actions` 内 exact 点击真实“刷新用户列表”按钮。
- 503 恢复已通过：点击前为 `role-unknown` 且管理按钮不可用；点击仅新增一条列表 GET、零新增 PUT；GET 返回目标后 notice 清除并恢复动态管理按钮。
- 完整 8 项结果仍为 7 passed / 1 failed。执行已继续进入 Abort 场景，但第 415 行目标行内非精确 `getByText('刷新用户列表')` 同时命中真实按钮和 unknown 正文，Playwright strict mode 在点击前失败。
- Abort 失败与已修正的 503 locator 同型，属于 E2E 编排缺陷；本轮唯一授权不包含该位置，未修改或绕过。后续 sessions-unknown 及剩余恢复步骤因此仍缺本轮通过证据。
- `build:h5`、`typecheck`、`git diff --check` 通过；临时证据目录、随机数据库和两类账号均为 0；harness finally 两运行库快照未报告变化。

当前建议仍为不通过。须仅授权 Abort 目标行 actions 内 exact 定位真实恢复按钮，并保留单 GET、零新增写入及恢复后解锁断言；修正后必须再次完整执行全部 8 项。

## 2026-07-31 多目标修复复测

- 使用修复后 H5 原样串行执行全部 8 项，未修改 E2E/harness、A/B 顺序、timeout、操作或恢复步骤。
- 结果：1 file / 8 tests，7 passed / 1 failed。
- 原 P1 已越过：A、B 均进入目标级 `role-unknown`；搜索 A 的单次有效 GET 精确显示并解锁 A，B 未污染 A 的结果；随后搜索 B 的 GET 独立显示并解锁 B。
- 失败发生在后续 503 场景。目标已正确进入带 requestId 的 `role-unknown`，但 E2E 使用 `notice503.getByText('刷新用户列表').click()`；该 locator 位于 `.platform-target-notice` 内，实际命中提示正文“请显式刷新用户列表确认真实角色。”中的文本节点，而真实刷新按钮位于同一行 `.platform-user-actions`，不在 notice 内。因此点击未发起 GET，随后等待管理按钮超时。
- 该失败属于 E2E 恢复控件定位错误，不是本轮状态协调修复回归；当前授权禁止修改 E2E，不能通过替代点击绕过。
- `build:h5`、`typecheck`、`git diff --check` 通过；仅有既有 Sass 与 LF/CRLF 提示。
- 项目外临时目录、`kb_platform_v1s5_*` 数据库及两类临时账号均为 0；harness finally 两运行库只读快照比较未报告变化。

## 当前阻断与建议

完整 E2E 尚未通过，503 之后的 Abort、sessions-unknown 与剩余恢复链路在本轮未执行。当前无新增生产缺陷；须由架构与产品仅授权将 503 恢复点击定位到目标行内唯一、真实的“刷新用户列表”按钮，并原样重跑全部 8 项。不得进入 V1 产品最终验收或任何真实运行库/部署动作。

## 2026-07-31 最新复测

- 仅修改授权的 E2E 与 harness：行动断言限定唯一 `.global-module-title`；drop 模式等待上游完成，发送真实 200 与完整 `Content-Length`，写出严格较短 JSON 前缀后断开 socket，并删除 `Transfer-Encoding`。
- Chromium 直接证据成立：目标写仅一条、harness 上游状态 200、operationId 仅为 `<redacted>`、浏览器收到 response 200 及 `ERR_CONTENT_LENGTH_MISMATCH` requestfailed；页面进入无 requestId 的目标级 unknown，未透明重发。
- `build:h5`、`typecheck`、`git diff --check` 通过；临时证据目录、`kb_platform_v1s5_*` 数据库和两类临时账号均为 0。每次 harness finally 均完成两个运行库只读快照比较，未报告变化。
- 完整 8 项连续两次稳定为 7 passed / 1 failed；失败均为同一恢复步骤，不是代理、定位或随机时序失败。

## P1：一个未解析角色目标遮蔽另一目标的显式读取

复现步骤：

1. 对目标 A 的角色写入截断响应，确认 A 进入 `role-unknown`；显式清空搜索读取后 A 可独立恢复。
2. 对目标 B 的角色写入截断响应，确认 B 进入 `role-unknown`。
3. 保持 B 未解析，输入 A 的完整 username 并普通鼠标点击既有搜索按钮，发起显式 GET。

实际结果：A 行在 8 秒内始终不可见。连续两轮均超时于 `locateManagementUser(page, targetA.username)`；读取协调在 B 未随结果返回时保留当前 B 旧快照，A 的新查询结果未成为可见列表。

期望结果：显式 GET 返回 A 后，应采用 A 的真实摘要并显示 A；B 继续保持自身旧摘要、提示和写锁，二者互不阻塞。该行为正是切片 4 已冻结并验收的逐目标协调语义。

级别：P1。它会使一个未解析角色目标阻断对其他用户的搜索与管理，且现授权禁止修改生产状态协调代码，不能通过调整 E2E 顺序或先恢复 B 绕过。

## 最新验收建议

不通过。回流前端与架构，仅允许针对多目标 `role-unknown` 的读模型合并/可见性做最小修复和交错时序测试；修复后必须重新执行全部 8 项。不得进入 V1 产品最终验收、真实 006、真实管理员授予、服务重启部署或运行库接入。

## 最新执行

- 原样串行执行修正后的全部 8 项 E2E；未修改 E2E/harness，未使用 force、DOM、坐标、键盘、CSS 注入或延长 timeout。
- 结果：1 file / 8 tests，6 passed / 2 failed。
- `build:h5`、`typecheck`、`git diff --check` 通过；仅有既有 Sass 与 LF/CRLF 提示。
- 项目外临时目录、`kb_platform_v1s5_*` 数据库及两类临时账号均为 0。
- Harness finally 的两运行库只读快照比较未抛出变化异常。

## 已确认通过

- 24 用户、每页 20 条、两页覆盖、稳定排序及完整 username 搜索定位保持有效。
- 搜索 Helper 使用真实 textbox 与 `.platform-administration-search-button` 普通鼠标点击后成功进入目标读模型。
- `.platform-more-button` 可由 `getByRole('button', { name: 管理用户名 })` 唯一解析并通过真实鼠标点击。
- 角色授予、撤销、旧 Cookie 角色刷新及 member 后续管理 GET 403 已实际完成。
- 搜索输入卸载与顶部按钮命中两个既有 P1 保持关闭。
- Schema/CLI、403/404/409、actor 降级、并发互撤、owner/Backup、敏感扫描及清理门的通过证据未回归。

## 失败一：测试定位歧义

角色撤销及 member 管理 GET 403 已成功后，测试使用：

`getByText('行动', { exact: true }).waitFor()`

页面同时存在导航文字“行动”和全局模块标题“行动”，Playwright strict mode 匹配到 2 个元素并立即失败。该失败发生在生产 403 卸载动作之后，属于 E2E 定位歧义，不是角色或权限生产失败。

期望的最小测试修正应定位唯一的行动模块标题或明确的工作台容器，不得降低 403、管理组件卸载及管理入口隐藏断言。

## 失败二：P1 候选——真实响应丢失未进入预期 unknown 状态

unknown-outcome 场景已完成：

- 清除上一 query/page；
- 完整 username 搜索唯一目标；
- `getByRole(button, 管理用户名)` 唯一解析并真实点击；
- 打开授予管理员确认层；
- 故障代理在服务端写入完成后执行 `response.destroy()` 丢弃响应投递。

随后 8 秒内页面未出现“操作结果尚未确认。请显式刷新用户列表确认真实角色。”，因此测试未能继续验证不自动重试、显式重读、503、Abort、会话 unknown 与恢复闭环。

生产 API Client 对写入 fetch rejection 应转换为 `ApiClientUnknownOutcomeError`，管理组件应据此进入 `role-unknown` 并显示提示。现有证据尚不能区分：

- Chromium/Node 代理的 `response.destroy()` 没有及时让 fetch reject；
- fetch 已 reject，但错误未被分类或页面状态未采用；
- 目标提示已生成但因当前读模型/渲染条件不可见。

该项阻断核心 unknown-outcome 安全闭环，暂列 P1 候选。下一步必须只读采集代理网络记录、写入次数、浏览器 requestfailed/response、目标锁状态和页面实际 notice，再决定修 harness、E2E 或生产代码。

## 是否建议验收

不通过。先由架构师冻结“行动”唯一定位的测试修正，并对真实响应丢失链路做只读诊断。未经再次完整 8 项通过，不得进入 V1 产品最终验收、真实 006、真实管理员授予、服务重启部署或运行库接入。
