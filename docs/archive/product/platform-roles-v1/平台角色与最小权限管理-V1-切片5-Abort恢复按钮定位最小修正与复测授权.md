# 平台角色与最小权限管理 V1—切片 5 Abort 恢复按钮定位最小修正与复测授权

日期：2026-07-31

状态：已授权单文件单点 E2E 修正及随后完整 8 项 QA 复测；切片 5 仍未通过

## 结论

产品依据 `docs/architecture/平台角色与最小权限管理-V1-切片5-Abort恢复按钮定位最小修正裁决.md`，确认当前失败是 Abort 恢复步骤同时匹配真实控件与 unknown 正文的 E2E strict-mode 歧义，与已关闭的 503 locator 缺陷同型，不构成新的生产 P0–P3。现授权严格按冻结范围修正 Abort 恢复按钮定位，并在修正后完整执行切片 5 全部 8 项。

## 唯一允许修改的工程文件

- `tests/platform-administration-v1-slice5.e2e.test.ts`

必要的 `docs/architecture/平台角色与最小权限管理-V1-切片5-独立QA报告.md`、`docs/product/当前运行事实.md`、本授权、后续验收记录及按章程触发的 `docs/daily-contributions/2026-07-31.md` 可同步实际结果。

## 唯一允许的修正

仅修改 Abort 恢复步骤：

- 以 `abortTarget.username` 冻结唯一 `.platform-user-row` 为 `abortTargetRow`。
- 以 `abortTargetRow.locator('.platform-target-notice')` 冻结 `abortNotice`，仅精确断言 unknown 正文。
- 点击前断言同一目标行内动态管理按钮不存在。
- 记录当前列表 GET 数量和该目标角色 PUT 数量。
- 在 `abortTargetRow.locator('.platform-user-actions')` 内，以 exact 文本定位唯一“刷新用户列表”控件并执行普通 Playwright `click()`。
- 点击后等待同一 `abortTargetRow` 内动态命名的管理按钮恢复。
- 断言只新增一条既有列表 GET、目标 PUT 数量不变、同行 notice 已清除。

点击边界应等价于：

`abortTargetRow.locator('.platform-user-actions').getByText('刷新用户列表', { exact: true }).click()`

不得修改该场景的其他操作、等待、断言或恢复步骤。

## 必须保持

- Abort 注入、角色提交、完整 username 搜索、管理控件真实点击与确认步骤不变。
- 点击前目标保持 `role-unknown`，管理按钮不可用，unknown 正文可见。
- 恢复点击只触发一条列表 GET，不新增、重放或补偿任何 PUT。
- 只有 GET 成功返回同一目标后，才采用服务端摘要、清除 notice、解锁并恢复管理按钮。
- A/B 多目标、503、响应截断、分页、搜索、harness、场景顺序和 timeout 不变。
- 后续 `sessions-unknown`、再次撤销会话、取消、重新确认、operationId 与恢复步骤不变。

## 明确禁止

- 禁止修改生产代码、harness、其他测试、SCSS、状态、API Client、API、Contracts、Application、Repository、Migration、Schema、Backup、脚本或配置。
- 禁止 force click、DOM click、坐标、键盘、全页模糊文本、运行时 CSS 注入、延长 timeout 或降低断言。
- 禁止调整场景顺序、跳过后续场景、预先恢复目标、自动重试或增加补偿请求。
- 禁止执行真实 006、授予真实管理员、写入运行库、重启或部署服务及云端操作。

## 完整 QA 复测授权

- 修正后必须原样串行执行切片 5 全部 8 项，不得只重跑 Abort 场景。
- Abort 恢复控件必须在目标行 actions 内唯一命中并通过真实鼠标点击。
- 点击网络差值严格为一条列表 GET、零新增目标 PUT；GET 返回目标后 notice 清除、目标解锁并恢复管理按钮。
- 完成后续 `sessions-unknown`、再次撤销、取消、重新确认、不同 operationId 及最终明确结果。
- A/B、503、Abort、响应丢失、角色与会话两类 unknown、显式恢复及无自动重试完整闭环必须通过。
- 24 用户、固定分页、403/404/409、actor 降级、并发互撤、owner/Backup 隔离及敏感扫描不得回归。
- 临时目录、database、账号、进程、端口和浏览器 context 必须 finally 为 0。
- `knowledge_base` 与 `knowledge_base_uat` 前后只读深度快照必须分别为 `SNAPSHOTS_IDENTICAL`。
- `build:h5`、`typecheck` 与 `git diff --check` 必须通过。

## 本轮 root 连接值一次性例外

- 本次完整 8 项 E2E 复测重新独立授权 QA 仅从仓库根未跟踪且已忽略的私有 `.env` 读取 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_ROOT_PASSWORD`，并只注入当前测试子进程内存。
- 只允许本机 `127.0.0.1:3306` 或等价 `localhost:3306`；其他 host 或 port 必须拒绝。
- 禁止读取 `.env.uat`，禁止回显、持久化、写回或将秘密放入命令参数、PowerShell transcript、stdout/stderr、Vitest reporter、截图、报告、临时 manifest、构建产物或 Git。
- 子进程结束后必须清除注入值。本例外只适用于本次 Abort locator 修正后的完整 8 项复测，不延续至后续 QA、部署或其他任务。
- root 只可管理本轮正则约束的随机临时 database/账号、核对临时 grants 及建立两个运行库的只读快照；不得对运行库执行 DDL/DML。

## 验收门

只有修正后的全部 8 项 E2E、`build:h5`、`typecheck` 与 `git diff --check` 均通过，Abort 恢复严格满足单 GET、零新增 PUT 和服务端事实后解锁，无新增 P0/P1，临时资源零残留，敏感扫描无泄漏且两运行库分别 `SNAPSHOTS_IDENTICAL`，才能回产品经理执行平台角色 V1 最终产品验收。

本授权不构成切片 5 QA 通过、V1 最终验收、真实 006、真实管理员授予、运行部署或封板授权。
