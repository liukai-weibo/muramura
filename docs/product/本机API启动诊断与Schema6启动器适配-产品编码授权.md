# 本机 API 启动诊断与 Schema 6 运行事实适配——产品编码授权

> 日期：2026-08-03
>
> 状态：已授权实施；实施完成后仅转 QA，不自动构成产品验收或封板。

## 【结论】

产品同意按 `docs/architecture/本机API启动诊断与Schema6启动器适配-最小任务书.md` 的文件范围与安全边界实施。主要目标是让开发与运维终端在 API 启动失败时获得可定位、可行动且不泄密的结构化诊断；同时移除 PowerShell 启动器中的固定 Schema 版本副本，以 API 的监听前 Schema 门为唯一版本决策源。

## 【当前阶段与编码门判断】

架构最小任务书已完整冻结，用户已明确同意开始实施。本文授权一个启动可诊断性实施切片，不授权运行库、Migration、Docker/Compose 或业务能力修改。

## 【确认的范围】

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
- 本授权记录与后续 QA/验收记录

## 【不允许项】

- 不修改 HTTP/H5 脱敏 503 契约、`apps/api/src/api-errors.ts`、任何路由或 DTO。
- 不输出 host、user、password、Cookie、原始 SQL、MySQL 原始 message、stack、绝对路径、environment 或业务数据。
- 不自动运行 Migration，不自动重试，不手工修表或修改 migration record。
- 不修改 Migration、Schema、运行库、`.env*`、容器/卷、账户/角色、Application、Repository 业务实现、Contracts 或 H5。
- 不将启动器从固定 5 改成另一个固定 6；必须复用已通过 API 唯一 Schema 门的 health 实际版本。

## 【需架构补齐的问题】

无。任务书已冻结 Schema 错误原因、终端分类、脱敏边界、启动器唯一版本决策源与测试门。

## 【验收标准】

1. Schema Migration 记录表缺失、版本落后与 Schema 6 必需表缺失在终端稳定区分，包含安全事实与正确下一步。
2. MySQL 不可用、API 端口冲突与未分类错误稳定分类，不泄露任何哨兵秘密。
3. HTTP `/health` 与普通 API 的现有脱敏响应不变。
4. `kb-start.ps1` 不再硬编码任何 Schema 版本，只接受实际 `ready / knowledge_base / <正整数>` 并在成功 JSON 中输出同一实际版本。
5. `kb-start.ps1` 的隐藏 API 子进程失败时，调用终端可看到同一条安全结构化诊断；只允许从既有临时目录回显受控错误码白名单行，不得透传任意子进程输出。
6. 定向单测、随机临时库 Schema 5/6 启动门测试、typecheck、PowerShell 语法解析与 `git diff --check` 通过；两个运行库未被触及。

## 【下一责任岗】

实施工程师在本授权范围内编码与验证；完成后转 QA。

## 【是否允许写代码】

是，仅限本文与架构任务书列出的文件和边界。
