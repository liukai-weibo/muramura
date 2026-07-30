# 在线账户与单用户数据隔离 V0：切片 5 P1 UAT 凭据轮换与事实盘点授权

日期：2026-07-30  
状态：受控轮换与定向 QA 通过；P1 已关闭

## 问题与结论

切片 5 功能与隔离回归通过，但整体 QA 不通过。当前本机实际 UAT app/migrator 密码与 Git 跟踪示例值相同，且对应 MySQL 用户真实存在，构成 P1 凭据暴露风险。另只读盘点确认 `knowledge_base_uat` 当前存在但为 0 个 base table，已与 2026-07-24 的历史 `schemaVersion=4` 事实不同。

## 最小修复目标

- 为现有 UAT app 与 migrator MySQL 账号分别生成新的高熵、互不相同的本机秘密。
- 同步更新当前实际使用的私有本机配置；不得打印、提交、写入日志或构建产物。
- 证明 Git 跟踪的公开示例凭据无法再认证，新的实际凭据可完成最小 `SELECT 1` 认证，且不读取或写入业务表。
- 只读确认 `knowledge_base_uat` 的当前表、migration 与 health 能力事实并更新状态记录；本项不重建或修复 UAT Schema。

## 架构复审冻结结论

`ALTER USER` 不具备双账号事务原子性，必须严格按“UAT app → 验证 → UAT migrator → 验证”顺序执行，并为每一步配置失败补偿。任一步失败均按架构 SOP 反向恢复已变更账号和两份私有配置；补偿失败立即停止并回流架构与产品，不得继续尝试。

## 本次一次性允许范围

- 仅轮换两个既有 UAT MySQL 账号密码；不新增、删除或改名账号，不改变认证插件或 grants。
- 严格按 UAT app 轮换并验证成功后，再轮换 UAT migrator 并验证。
- 仅同步仓库根已忽略且未跟踪的 `.env`、`.env.uat`；实施前后均须确认未被 Git 跟踪。
- 每个新秘密由 32 字节安全随机源生成且彼此不同，只允许经 PowerShell 内存和匿名 stdin 传递；不得进入命令参数、Shell 历史、日志、Git、构建产物或临时 SQL 文件。
- 必要的只读验证、QA/架构/产品记录与当天贡献记录。

## 定向验收门

- Git 跟踪的公开示例凭据对两个 UAT 账号均认证失败。
- 两个新凭据分别仅执行 `SELECT 1` 成功；不得读取或写入业务表。
- 两个账号的 `SHOW GRANTS` 前后逐项一致且权限未扩大，认证插件与账号名不变。
- 新秘密在 Git 跟踪内容、H5 构建产物和本轮日志中均零命中；不得在报告中记录秘密本身。
- 只读确认 `knowledge_base_uat` 数据库存在且 `BASE TABLE = 0`；不运行 health，不沿用历史 `schemaVersion=4`，不修复 Schema。
- 失败补偿须恢复账号和 `.env`、`.env.uat` 的一致状态；补偿失败立即停止，不得转 QA 通过。

## 明确禁止

- 修改 API、H5、Contracts、Application、Repository、Migration、Backup、Docker、公开示例配置、业务代码或部署。
- 除本次精确授权的两个账号 `ALTER USER` 外，禁止对 `knowledge_base`、`knowledge_base_uat` 或云端运行库执行任何账号变更、DDL、DML、migration、恢复、claim、清理或业务读写。
- 运行 Docker migrate、`reconcile-users.sh`、任何 migration、恢复或数据库初始化。
- 输出旧/新密码、连接串或可用于认证的值。
- 在 P1 关闭及 UAT 事实完成归档前进行 V0 最终验收、封板、真实运行库迁移或后续 Tauri/部署工作。

## 当前裁决

现书面授权按架构 SOP 执行一次受控轮换及上述只读验证。完成后必须转 QA 定向复测；未经 QA 通过与产品最终验收，V0 不得归档或封板。

## 关闭结论（2026-07-30）

受控轮换和定向 QA 已完成且未触发补偿。两份私有配置保持未跟踪并同步一致；两个新秘密彼此不同且满足冻结随机长度，公开示例凭据均认证拒绝，新凭据分别仅执行 `SELECT 1` 成功。账号名、host、认证插件和 grants 前后一致且未扩大，新秘密在 Git、H5 构建产物和近期日志中零命中。原 P1 正式关闭。

`knowledge_base_uat` 当前仍为 0 个 base table；该事实不属于凭据 P1，也未在本轮修复。
