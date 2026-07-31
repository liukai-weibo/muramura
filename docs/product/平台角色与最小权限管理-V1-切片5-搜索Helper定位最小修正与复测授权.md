# 平台角色与最小权限管理 V1—切片 5 搜索 Helper 定位最小修正与复测授权

日期：2026-07-31

状态：已授权单点 E2E 修正及随后完整 8 项 QA 复测；切片 5 仍未通过

## 结论

产品依据 `docs/architecture/平台角色与最小权限管理-V1-切片5-搜索Helper定位最小修正架构裁决.md`，确认本轮两项失败均来自新增 E2E helper 对搜索按钮采用不存在的 button role，不构成新的生产 P0–P3。现授权严格按冻结范围进行单点测试修正，并在修正后完整重跑切片 5 全部 8 项。

## 唯一允许修改的工程文件

- `tests/platform-administration-v1-slice5.e2e.test.ts`

必要的 `docs/architecture/平台角色与最小权限管理-V1-切片5-独立QA报告.md`、`docs/product/当前运行事实.md`、本授权、后续验收记录及按章程触发的 `docs/daily-contributions/2026-07-31.md` 可同步实际结果。

## 唯一允许的修正

- 将 `locateManagementUser()` 中的搜索提交改为对 `.platform-administration-search-button` 执行普通 Playwright `click()`。
- 将 `clearManagementSearch()` 中的搜索提交作相同修改。

不得修改 helper 的其他逻辑、调用顺序、等待条件或断言。

## 必须保持

- 搜索输入继续使用真实 textbox 填写或清空。
- 搜索提交继续通过真实 Playwright 鼠标点击完成，每次只产生一条既有 GET。
- 管理控件继续且只能通过 `getByRole('button', { name: '管理' + username })` 唯一定位并真实点击。
- 完整 username 定位、24 名用户、固定每页 20 条、第 1/2 页覆盖、稳定排序以及测试间 query/page 清理逻辑不变。
- 生产搜索、分页、权限、目标锁、写请求和两类 unknown-outcome 语义不变。

## 明确禁止

- 禁止为搜索按钮增加生产 role，禁止修改其 DOM、文案、事件或样式。
- 禁止修改任何 `apps/client` 生产代码、SCSS、状态、API Client、harness、其他测试、后端、Contracts、Application、Repository、Migration、脚本或配置。
- 禁止 force click、DOM click、坐标点击、键盘替代、运行时 CSS 注入、延长 timeout、降低断言或跳过失败场景。
- 禁止执行真实 006、授予真实管理员、写入运行库、重启或部署服务及云端操作。

## 完整 QA 复测授权

- 修正后必须原样串行执行切片 5 全部 8 项 E2E，不得只重跑两个失败项。
- 搜索 helper 必须使用真实 textbox 与 `.platform-administration-search-button` 普通点击完成提交，并验证单次既有 GET。
- 管理控件必须继续由 button role 与动态 accessible name 唯一解析并通过真实鼠标点击。
- 完整覆盖角色授予/撤销、会话撤销、角色与会话两类 unknown-outcome、503、Abort、响应丢失及显式重读。
- 保留 Schema 5 启动拒绝、随机 Schema 6 临时库启动、403/404/409、actor 降级、并发互撤、owner/Backup 不扩权及敏感信息扫描。
- 随机临时目录、database、账号、进程、端口和浏览器 context 必须 finally 为 0。
- `knowledge_base` 与 `knowledge_base_uat` 前后只读深度快照必须分别为 `SNAPSHOTS_IDENTICAL`。
- `build:h5`、`typecheck` 与 `git diff --check` 必须通过。

## 本轮 root 连接值一次性例外

- 本次完整 8 项 E2E 复测重新独立授权 QA 仅从仓库根未跟踪且已忽略的私有 `.env` 读取 `MYSQL_HOST`、`MYSQL_PORT`、`MYSQL_ROOT_PASSWORD`，并只注入当前测试子进程内存。
- 只允许本机 `127.0.0.1:3306` 或等价 `localhost:3306`；其他 host 或 port 必须拒绝。
- 禁止读取 `.env.uat`，禁止回显、持久化、写回或将秘密放入命令参数、PowerShell transcript、stdout/stderr、Vitest reporter、截图、报告、临时 manifest、构建产物或 Git。
- 子进程结束后必须清除注入值。本例外只适用于本次单点修正后的完整 8 项复测，不延续至后续 QA、部署或其他任务。
- root 只可管理本轮正则约束的随机临时 database/账号、核对临时 grants 及建立两个运行库的只读快照；不得对运行库执行 DDL/DML。

## 验收门

只有修正后的全部 8 项 E2E、`build:h5`、`typecheck` 与 `git diff --check` 均通过，管理控件 role+name 唯一解析和真实点击成立，无新增 P0/P1，临时资源零残留，敏感扫描无泄漏且两运行库分别 `SNAPSHOTS_IDENTICAL`，才能回产品经理执行平台角色 V1 最终产品验收。

本授权不构成切片 5 QA 通过、V1 最终验收、真实 006、真实管理员授予、运行部署或封板授权。
