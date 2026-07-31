# 平台角色与最小权限管理 V1—切片 4 独立 QA 报告

日期：2026-07-31
当前结论：定向复测通过，初次 QA 发现的 2 个 P1 已关闭，建议转产品经理验收。切片 5、真实 006、服务重启和运行库操作继续禁止。下文保留初次不通过的历史事实与复现记录。

## P1 最小修复定向复测

- 列表读取已增加独立 read owner。写入提升事实代次时，只结束当时在途旧读取建立的 `refreshing`；旧 GET 后到、失败、Abort 或过期均不能覆盖写入事实，也不能结束后来建立的新读取。
- 角色 unknown 已改为逐目标协调。同一 GET 返回且代次有效的目标独立采用服务端摘要并解除自身锁；未返回目标保留旧摘要、提示和锁，可由后续 GET 独立确认。
- 单目标 role-unknown、sessions-unknown、同目标同步写锁、不同目标隔离、401/403 销毁边界均完成回归。
- 切片 4 定向及认证门：4 files / 42 tests passed。
- 完整 H5 去重回归：18 files / 129 tests passed。
- `corepack pnpm exec tsc --noEmit`：通过。
- `corepack pnpm --filter @knowledge-base/client build:h5`：通过；仅有既有 Sass legacy API 弃用警告。
- `git diff --check`：退出 0；仅有既有 LF/CRLF 提示。
- 未读取 `.env` 或 `.env.uat`，未启动 API、MySQL、H5 开发服务，未连接或操作运行库，未执行真实联调或 006。
- 复测问题清单：P0–P3 均无新增；以下两个历史 P1 均已关闭。

## 测试范围与环境

- 依据 `docs/product/当前运行事实.md`、切片 4 产品编码授权、设计冻结和 H5 前端架构冻结记录执行。
- 仅静态审查五个前端源码文件及四个直接测试文件，并运行 mock/纯状态 H5 测试。
- 未读取 `.env` 或 `.env.uat`，未启动 API、MySQL、H5 开发服务，未连接或操作任何运行库，未执行真实 006。
- 工作目录：`C:\Users\Administrator\Desktop\mikey\Knowledge_Base`。

## 独立验证结果

- 切片 4 定向及认证门：4 files / 38 tests passed。
- 完整 H5 去重回归：18 files / 125 tests passed。
- `corepack pnpm exec tsc --noEmit`：通过。
- `corepack pnpm --filter @knowledge-base/client build:h5`：通过；仅有既有 Sass legacy API 弃用警告。
- `git diff --check`：退出 0；仅有既有 LF/CRLF 提示。

## 通过场景

- 管理 API Client 使用冻结路由、同源 Cookie、精确请求体及严格 DTO 校验；明确错误保留状态与 requestId，写入无自动重试。
- member 入口预门控、platform_admin 独立入口、管理 401/403 回调及认证上下文代次保护已接入。
- 搜索 draft/applied 分离、固定 20 条分页、读请求 Abort/generation/auth/fact 保护和当前账号按服务端 userId 判断已实现。
- 最终确认后生成 CSPRNG UUID、同目标同步占锁、独立 attempt token、明确成功采用服务端响应且不乐观更新。
- 角色与会话 unknown-outcome 的基础状态、显式恢复入口和无自动重试边界已实现。

## 问题清单

### P1：写入使在途列表 GET 过期后，页面会永久停留在“正在读取”

复现步骤：

1. 平台管理员进入用户管理并成功取得列表。
2. 点击“刷新”，让该列表 GET 暂缓返回，页面进入 `refreshing`。
3. 在旧列表中对任一其他用户完成角色调整或会话撤销，并让写请求先明确成功。
4. 再让步骤 2 的 GET 成功返回。

实际结果：写入开始时 `factGenerationRef` 递增；旧 GET 在 `shouldApplyPlatformRead` 处被正确判为过期，但函数直接返回，未把 `listState` 从 `refreshing` 恢复。写入成功路径也不恢复列表读取状态。页面持续显示“正在读取最新用户信息”，搜索、刷新和分页保持禁用；切换普通模块后再返回仍保留该状态，只能重建页面上下文恢复。

期望结果：过期 GET 不得覆盖写入后的事实，同时必须结束它建立的读取中状态；写入成功后列表保持可继续搜索、刷新和分页。

定位：`apps/client/src/pages/index/platform-administration.tsx` 的 `readUsers` 过期响应返回路径与 `submitConfirmation` 明确成功路径。

### P1：多个角色 unknown 目标被错误绑定为“全部同时出现才解锁”

复现步骤：

1. 同一列表快照中对目标 A、B 分别发起角色调整，并让两个请求均形成 `role-unknown`。
2. 显式刷新，返回合法列表且包含 A，但因并发用户变化、排序或分页变化不包含 B。

实际结果：代码先汇总全部 `roleUnknownFactsRef`；只要 B 未出现，就在处理任何目标前拒绝整个结果。已由本次新 GET 确认的 A 也不会更新或解锁，违背目标级独立锁语义。若后续页面结果无法同时包含 A、B，两者可持续无法恢复。

期望结果：同一成功 GET 应只更新并解锁其中实际返回且满足形成代次的目标；未返回的目标继续保留旧事实和 unknown 锁，不得阻塞其他目标确认。

定位：`apps/client/src/pages/index/platform-administration.tsx` 中 `unresolvedRoleTargets.length > 0` 在逐目标处理前整体返回的逻辑。

## 回归风险与结论

- 两项均位于管理写入、旧请求保护和 unknown-outcome 的冻结核心边界，可能使后续管理操作持续不可用。
- 现有 flow 测试主要是源码字符串断言，状态测试只覆盖单一 unknown 目标，未直接覆盖上述交错时序。
- 初次 QA 结论为不通过；该历史结论已被本报告顶部的 2026-07-31 定向复测结论替代。当前建议切片 4 转产品经理验收；切片 5 仍不得开始。
