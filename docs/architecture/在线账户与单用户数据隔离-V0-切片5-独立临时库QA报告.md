# 在线账户与单用户数据隔离 V0：切片 5 独立临时库 QA 报告

日期：2026-07-30  
结论：不通过；功能回归通过，但存在 P1 配置敏感信息风险，暂不建议 V0 产品最终验收。

## 测试边界

- 仅创建随机 `kb_v0s5_*`、`kb_accounts_*`、`kb_owner_*`、`kb_claim_*` 等临时数据库和独立 app/migrator 账号。
- API、故障 API 和 H5 证据服务器均监听随机 `127.0.0.1` 端口。
- 浏览器使用 Playwright 隔离 Context；未复用 localStorage、Cookie 或页面状态。
- 未修改生产代码、migration、配置、Docker、部署或运行库。
- `knowledge_base` 与 `knowledge_base_uat` 仅执行固定只读摘要查询。

## 本轮新增 QA 文件

- `tests/account-isolation-v0-slice5.e2e.test.ts`
- `docs/daily-contributions/2026-07-30.md` 仅追加对应增加项。

## 实际命令与结果

1. 当前 H5 构建：

   `corepack pnpm --filter @knowledge-base/client build:h5`

   结果：通过；688 modules transformed，仅有既有 Sass legacy JS API 弃用警告。

2. 切片 5 真实 API/H5 临时库端到端：

   `corepack pnpm vitest run --no-file-parallelism tests/account-isolation-v0-slice5.e2e.test.ts`

   首轮 2/3；503 场景因无 Cookie 而按契约在访问 MySQL 前返回 401。仅修正测试前置为随机无效 Cookie 后复跑，最终 1 文件 / 3 项通过。

3. 账户 Schema、真实认证、全业务 owner 隔离、claim 与用户范围 Backup：

   `corepack pnpm vitest run --no-file-parallelism tests/mysql-account-ownership-schema.integration.test.ts tests/api-auth.integration.test.ts tests/api-owner-isolation.integration.test.ts tests/mysql-owner-claim-backup.integration.test.ts`

   结果：4 文件 / 11 项通过。

4. 既有完整 MySQL 回归：

   `corepack pnpm test:mysql:integration`

   结果：13 文件 / 135 项通过。

5. H5 去重回归：

   `corepack pnpm vitest run tests/authentication-h5-flow.test.ts tests/api-client-transport.test.ts tests/authentication-h5-gate.test.ts tests/brand-display.test.ts tests/exploration-h5-adapter.test.ts tests/exploration-h5-visual.test.ts tests/exploration-rename-interaction.test.ts tests/item-content-state.test.ts tests/item-status-relocation.test.ts tests/review-submission-ui.test.ts tests/search-session-state.test.ts tests/settings-data-display.test.ts tests/start-confirm-state.test.ts tests/status-navigation-ui.test.ts tests/unknown-outcome-ui.test.ts`

   结果：15 文件 / 97 项通过。

6. 工程检查：

   - `corepack pnpm exec tsc --noEmit`：通过。
   - `corepack pnpm --filter @knowledge-base/client build:h5`：通过。
   - `git diff --check`：通过，仅有工作区既有 LF/CRLF 提示。

## 通过场景

- 真实 API 注册、登录、当前会话、退出和 Cookie 过期链路通过。
- Set-Cookie 为 HttpOnly、SameSite=Lax、Path=/、带 Expires；HTTP 环境不含 Secure。
- H5 未认证时不挂载工作台或读取业务集合；认证写入后须真实 session GET 成功才进入。
- 已完成登录写请求的 Response 投递被丢弃时不自动重发，输入保留，显式 session GET 后确认。
- 已完成退出请求后注入 Abort 时工作台保持至显式 session GET；退出 POST 未重发。
- 独立故障 API 仅使用错误 app 密码，真实 session GET 返回 503、`MYSQL_UNAVAILABLE` 和 `requestId`；无自动请求，恢复正常 API 后仅由显式 session GET 继续。
- 双用户全业务读写隔离、跨用户 404、搜索、Dashboard、回收站和十集合 owner 归属通过。
- claim 成功、重复幂等、混合归属拒绝、末端失败回滚和 commit 后 unknown-outcome 显式确认通过。
- Backup V1/V2/V3 当前用户导出/恢复、跨用户 ID 冲突 409 及删除前零写入通过。
- 既有单用户 MySQL 与 H5 行为未见回归。
- 响应、H5 构建产物和 Git 跟踪文件中未发现密码哈希、原始 session token、实际 Backup、mysql-data 或个人数据。

## 零污染证据

- `knowledge_base`：
  - PRE：`3bc799dffaceb81ef5fb425953f8953ccbe6babb99af3ad6d9940090e8da63bf`
  - POST：`3bc799dffaceb81ef5fb425953f8953ccbe6babb99af3ad6d9940090e8da63bf`
- `knowledge_base_uat`：
  - PRE：`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
  - POST：`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
  - 当前数据库存在，但只读查询显示 0 个 base table；该状态与状态锚点中的历史 schemaVersion=4 事实不一致，本轮未修复或写入。
- 测试前后 `kb_*` 临时数据库：0。
- 测试前后 `kb_*` 临时账号：0。
- 测试结束 Playwright Chromium 进程：0。
- 测试结束随机 loopback Node 监听：0。
- 首次失败的 mysqldump 尝试在本机无 CLI，连接数据库前终止；其创建的空 `%TEMP%/kb-v0-s5-*` 目录已删除。

## 问题

### P1：本机实际 UAT 密码配置与 Git 跟踪示例值相同

复现：

1. 只在内存读取本机 `.env` 中名称含 `PASSWORD` 的值，不输出值。
2. 与 Git 跟踪文件及 H5 构建产物进行逐值匹配。
3. 只读查询对应 UAT app/migrator 用户是否存在。

实际结果：

- H5 构建产物无实际密码值命中。
- 私有 `.env`、`.env.uat` 和 mysql-data 均未被 Git 跟踪。
- 本机 `.env` 的 `UAT_MYSQL_APP_PASSWORD`、`UAT_MYSQL_MIGRATOR_PASSWORD` 与 `.env.example`、`.env.uat.example` 中公开示例值相同。
- 对应 UAT app/migrator MySQL 用户均实际存在。
- 本轮边界禁止以这些凭据连接 UAT，因此未进一步尝试认证或读取。

期望结果：

- 实际运行账号密码不得与 Git 跟踪示例值相同。
- 应由新的明确授权轮换对应 MySQL 账号和本机配置，并以不输出密码的方式证明示例值无法认证、实际值未进入 Git/构建/日志。

## 剩余风险与建议

- 因 P1 未关闭，不建议在线账户 V0 产品最终验收、归档或封板。
- `knowledge_base_uat` 当前存在但无 base table，与状态锚点历史事实不一致；虽然不影响本轮随机临时库功能结论，产品需裁决是否单独盘点状态锚点。
- 未执行任何真实运行库 claim、Backup 恢复或业务写入。
- 不得开始 Tauri、安卓、同步、协作、HTTPS/域名或部署工作。

## P1 凭据轮换定向复测（2026-07-30）

结论：通过；本节替代本报告此前“P1 未关闭”的阶段性结论，但不构成 V0 产品最终验收或封板。

### 复测结果

- 仓库根 `.env`、`.env.uat` 均未被 Git 跟踪；两份私有配置中的 UAT app/migrator 账号与新秘密一致。
- 两个新秘密彼此不同、满足至少 32 字节安全随机值的编码长度，并均不再等于 `.env.example` 或 `.env.uat.example` 的公开示例值。
- UAT app 与 migrator 账号均唯一存在于 `%` host，当前认证插件均为 `caching_sha2_password`。
- 当前 `SHOW GRANTS` 摘要：
  - app：`47541a7c4133b985a138eaae6bdc471726d5390b593b0e752e9fb3000354b1cc`
  - migrator：`bcb37a1e5bddbe6accc32db192a3ec55bafad215ba2e4c6442d88f860dbe975f`
- app 权限精确为 `SELECT, INSERT, UPDATE, DELETE`；migrator 精确为 `SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX, REFERENCES`；两者均无 `GRANT OPTION`，与冻结账号收敛脚本一致。
- 两个新凭据分别连接 `knowledge_base_uat` 并仅执行 `SELECT 1` 成功。
- Git 跟踪的 app/migrator 公开示例凭据对对应账号均认证拒绝。
- `knowledge_base_uat` 存在且 `BASE TABLE = 0`；未运行 health、migration、恢复、claim 或任何业务表查询/写入。
- 新秘密在 Git 跟踪内容、H5 构建产物和过去 24 小时的本机近期日志中均为 0 命中。
- 复测前后摘要：
  - `knowledge_base` 均为 `3bc799dffaceb81ef5fb425953f8953ccbe6babb99af3ad6d9940090e8da63bf`
  - `knowledge_base_uat` 均为 `e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`
- 测试结束 `kb_*` 临时数据库和账号均为 0。

### 定向 QA 裁决

- 原 P1“实际 UAT 凭据复用 Git 公开示例值”已关闭。
- 当前未发现新的 P0–P3 问题。
- 切片 5 QA 现建议通过并转产品经理执行 V0 最终验收。
- `knowledge_base_uat` 零表是已更新的当前事实，不属于本次凭据修复；不得擅自重建或描述为 schemaVersion 4。
