# 平台角色与最小权限管理 V1—真实 Schema 6 接入与运行验收授权

日期：2026-07-31

## 结论

产品已书面授权本机 `knowledge_base_uat` 与 `knowledge_base` 的真实 Schema 6 接入、各自唯一既有 `admin` 账户的初始 `platform_admin` 授予，以及接入后的 API/H5 运行验收。本授权不包含云端、Docker 应用镜像或公网部署。

## 受控顺序

1. 只读确认两个目标库均为 Schema 5、15 张表，并记录唯一既有账户。
2. 停止当前本机 API/H5，保存两个运行库的完整逻辑备份、迁移记录和深度摘要。
3. 先对 `knowledge_base_uat` 执行既有 006 Migration；确认 Schema 6、17 张表、既有用户仅回填 `member`。
4. 以显式 UAT `userId`、`expected-database=knowledge_base_uat` 和 `--apply` 执行既有初始管理员 CLI；确认角色与审计事实。
5. 在显式 `.env.uat` 环境启动 API/H5并完成 UAT；结束后停止 UAT 服务。
6. 对 `knowledge_base` 执行同样的 006、显式初始管理员授予、API/H5 启动和日常运行验收。
7. 更新唯一状态锚点和本机启动顺序，记录真实 Schema、服务入口、备份位置及剩余边界。

## 安全与回滚门

- 仅执行仓库已验收且已归档的 `006_add_platform_roles_and_security_audit.sql`，不得修改 Migration 或手工拼接 DDL/DML。
- 两个数据库必须分别加载各自私有环境并独立迁移，禁止跨库连接执行。
- 初始管理员 CLI 必须使用各库唯一既有 `admin` 的显式 `userId`；不得猜测、自动选择或新增账户。
- 密码只从未跟踪私有环境进入当前进程内存，不得回显、写入命令参数、文档、Git、构建或日志。
- 006 为 MySQL DDL，不能承诺事务回滚；任一步失败立即停止，不得删除 migration 记录、手工删表或回退 Schema。以完整备份和现场只读证据回流架构进行前向修复裁决。
- 初始管理员授予的事务失败应零写入；commit 后结果未知不得自动重试，必须重读 `user_roles` 与 `security_audit_events` 判定。
- 不执行 claim、Backup restore、业务数据改写、账号密码修改、grants 修改、Docker 应用镜像构建或云端部署。

## 验收门

- 两库分别达到 Schema 6、17 张 base table，001–006 migration 记录完整且 checksum 无漂移。
- 每个既有用户均有且仅有 `member`；显式目标另有且仅有 `platform_admin`。
- 两次初始管理员操作各有一条对应审计，不泄露秘密或原始会话内容。
- API `/health` 分别准确返回目标 database 与 `schemaVersion=6`。
- UAT 与日常 H5 均能以各自账户进入管理入口；用户列表、角色边界、会话撤销及业务 owner 隔离保持既有语义。
- 业务十集合的 owner、数量和内容在 Schema/角色接入前后保持一致；除角色、审计、migration 与正常会话变化外不得出现业务写入。

## 非目标

- 云端或公网部署、Docker 应用镜像发布、HTTPS/域名。
- 团队、协作共享、自定义角色、动态权限、密码查看或重置。
- Backup restore、claim、业务数据迁移或运行库清理。

## 首次执行状态

2026-07-31 首次执行已在 UAT 006 的任何新增 DDL 前由既有 checksum 安全门停止。数据库记录的 005 checksum 为 Git 归档 LF 内容哈希，Windows 工作树中的同一文件因 CRLF 检出得到不同原始字节哈希，迁移器因此报告既有 005 内容不一致。日常库未进入迁移，两个平台表均未创建，初始管理员 CLI 未执行；两库仍为 15 张表、Schema 5，十个业务集合前后压缩快照分别一致。当前 API/H5 已停止，MySQL 保持健康。未经新的最小跨平台 checksum 处理裁决与产品书面授权，不得绕过安全门继续执行。

## 续行状态

跨平台 checksum 兼容修复经随机临时库定向测试后，UAT 已成功执行 006，达到 17 张表、Schema 6；唯一既有 `admin` 已通过受控 CLI 获得 `member + platform_admin`，并产生一条初始管理员审计。真实 UAT 的 health、H5 可达性、未认证 401、登录、工作台和用户管理入口功能链路通过。

真实页面同时暴露独立前端视觉缺陷：多个 Taro 按钮文字不可见或对比不足，用户行、注册时间和分页字号失控，搜索输入尺寸与整体层级不协调。该问题不否定 Schema、角色或权限功能证据，但阻断 H5 视觉产品验收。日常库继续保持 Schema 5，不得在视觉修复裁决前继续接入；UAT API/H5 验证后停止，MySQL 保持运行。

## 最终执行结果

视觉 P1 经独立修复、QA 与产品视觉验收后关闭。日常 `knowledge_base` 随后完成既有 006、显式初始管理员授予及服务恢复，达到 17 张表、Schema 6；唯一既有 `admin` 拥有 `member + platform_admin`，初始管理员审计 1 条。health、H5、既有凭据登录、工作台和用户管理入口均通过，十个业务集合与 `system_metadata` 接入前后摘要一致。完整备份位于项目和 Git 外 `维护相关/运行库备份/Schema6接入-daily-20260731-163920`。未执行 claim、Backup restore、业务写入、账号/grants/密码修改、云端或公网部署。
