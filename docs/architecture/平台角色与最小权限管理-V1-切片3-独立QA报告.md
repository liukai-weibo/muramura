# 平台角色与最小权限管理 V1：切片 3 独立 QA 报告

日期：2026-07-30
结论：通过；管理请求认证/授权与 body-size 门顺序的 P1 已完成最小修复并独立复测通过，建议转产品经理验收。真实 006、服务重启、H5 与切片 4–5 仍禁止。

## 测试范围

- 三条冻结管理路由及其 401、403、参数、DTO、错误映射和 no-store/requestId 边界。
- Platform Administration Application 编排、Repository 脱敏重读、一致性分页、事务锁、审计与 unknown-outcome。
- actor 事务内降级、并发互撤、operationId 冲突、回滚、自操作及目标不存在。
- platform_admin 对十个业务集合的 owner 隔离不扩权。
- 完整 MySQL 回归、typecheck、`git diff --check`、运行库只读快照和临时资源清理。

未执行真实 006、服务重启、运行库写入、H5 接入或切片 4–5。

## 环境与版本

- 工作目录：`C:\Users\Administrator\Desktop\mikey\Knowledge_Base`。
- 数据库测试显式加载 `.env`，仅使用随机 Schema 6 临时库、临时 app/migrator 账号及随机秘密。
- 最小 HTTP 探针仅使用随机 loopback 端口和未连接数据库的惰性连接池；未触碰当前 API/H5 或任何运行库。
- 完整 MySQL 回归严格串行。

## 通过场景

- 正常大小请求下，无 Cookie 返回 401，member 对已覆盖的合法/非法目标、非法请求体及未知管理路径统一返回 403，且零写入。
- 管理员列表固定每页 20，稳定排序，支持空末页、真实 total、字面量子串及 `%`、`_`、`=` 转义搜索；重复或未知参数及非法 page 返回 400。
- 列表与单用户摘要只返回 id、username、roles、createdAt；异常角色事实失败关闭。
- 角色授予、撤销、相同状态零写入、真实重读、自操作 403、目标不存在 404 和 operationId 409 符合冻结语义。
- 会话撤销仅影响目标尚未撤销的会话，actor 会话保持有效；自撤返回 403。
- actor 在 HTTP 认证读取后、Repository 加锁前被降级时，事务内二次校验返回 403，角色与审计零副作用。
- 两管理员并发互撤仍为一次成功、一次 `actor-not-platform-admin`，最终保留管理员且只有一条成功审计。
- beforeCommit 失败整体回滚；afterCommit 失败不重试，角色和唯一审计只能显式重读确认。
- platform_admin 对其他用户十个业务集合的读取、写入、删除和恢复继续返回既有 404；列表、搜索、Dashboard 与回收站仍受当前 Cookie owner scope 限制。
- 未新增管理别名、H5 入口、Schema、Migration、角色或 owner 绕过能力。

## 自动化结果

- 切片 3 定向：4 文件 / 21 项通过。
- 完整 MySQL 串行回归：13 文件 / 135 项通过。
- `corepack pnpm typecheck`：通过。
- `git diff --check`：通过，仅有既有 LF/CRLF 提示。

## 零污染证据

- `knowledge_base` PRE/POST：`efdd20e2630c655ebf877aca937f9ee85af9adbc597297834fdbfcef050500b2`。
- `knowledge_base_uat` PRE/POST：`2e19b990cbb6e38bfeaca7bde239ff4c350c8772a553fbf461c543083934c39f`。
- 两库均保持 15 个 base table、Schema 5、平台表 0；结论为 `SNAPSHOTS_IDENTICAL`。
- 测试前后所有额外 `kb_*` 临时数据库和账号均为 0。

## 问题清单

### P1：管理请求在认证/授权前返回请求体大小错误（已关闭）

复现步骤：

1. 在随机 loopback 端口构造当前 `createApiServer`，无需建立数据库连接。
2. 不携带 Cookie，向 `PUT /api/v1/admin/users/target/roles` 发送 `Content-Type: application/json` 且 `Content-Length: 65537` 的请求体。
3. 可再次携带无效 `kb_session` Cookie 发送相同请求，结果相同。

实际结果：

- 两次均返回 HTTP 413、`error.code=REQUEST_TOO_LARGE`，并含 requestId。
- `apps/api/src/index.ts` 在 Cookie 恢复和 `/api/v1/admin/**` 管理员门之前执行全局 `Content-Length` 检查，因此授权门尚未运行。

期望结果：

- 管理请求必须先恢复安全 Cookie 会话：无有效会话固定返回 401 `UNAUTHORIZED`。
- 已认证 member 对任意 `/api/v1/admin/**`，包括超限或其他非法请求体，必须在路由和参数/请求体解析前统一返回 403 `FORBIDDEN`。
- 仅管理员通过授权门后，才可观察 64 KiB 限制形成的 413；所有响应继续包含 requestId、`X-Request-Id` 与 `Cache-Control: no-store`，并保持零写入。

该问题会破坏冻结的认证授权顺序及 member 统一 403 边界，现有 21 项测试因只覆盖正常大小请求体而未发现。

关闭依据：管理请求现先恢复最新 Cookie 会话并执行管理员门，再对已授权管理员检查普通 64 KiB 限制；无 Cookie、无效 Cookie、member 和管理员四类超限请求均已加入直接回归。

## P1 最小修复独立复测（2026-07-30）

- 无 Cookie 的超限管理请求返回 401 `UNAUTHORIZED`。
- 无效 Cookie 的超限管理请求返回 401 `UNAUTHORIZED`。
- 已认证 member 的超限管理请求统一返回 403 `FORBIDDEN`。
- 仅管理员通过授权门后，超限管理请求返回 413 `REQUEST_TOO_LARGE`。
- 四类响应均断言 error requestId、`X-Request-Id`、`Cache-Control:no-store`；角色、会话和审计表前后完全一致。
- 非管理路由继续使用普通 64 KiB 前置限制，Backup restore 继续使用 16 MiB 限制；CORS、health 与既有错误 DTO 未改变。
- 切片 3 定向复测：4 文件 / 21 项通过。
- 完整 MySQL 串行回归：13 文件 / 135 项通过。
- `corepack pnpm typecheck` 与 `git diff --check`：通过。
- `knowledge_base` PRE/POST：`efdd20e2630c655ebf877aca937f9ee85af9adbc597297834fdbfcef050500b2`。
- `knowledge_base_uat` PRE/POST：`2e19b990cbb6e38bfeaca7bde239ff4c350c8772a553fbf461c543083934c39f`。
- 两库保持 15 个 base table、Schema 5、平台表 0，所有额外 `kb_*` 临时数据库和账号最终为 0；结论为 `SNAPSHOTS_IDENTICAL`。
- 本轮新增 P0–P3 缺陷：无。

## 回归风险

- 修复必须保持 Backup restore 的 16 MiB 限制、普通非管理路由 64 KiB 限制、CORS、health 和既有错误 DTO 不变。
- 当前两个运行库仍为 Schema 5；不得用新源码重启、部署或替换当前 API。
- H5、真实 006、运行库接入及切片 4–5 均不在本轮范围。

## QA 裁决

- 是否建议切片 3 产品验收：通过。
- 下一责任岗：产品经理执行切片 3 最终验收。
- QA 通过不等于真实 006、服务重启、H5 接入或切片 4 授权；切片 4–5 继续禁止。
