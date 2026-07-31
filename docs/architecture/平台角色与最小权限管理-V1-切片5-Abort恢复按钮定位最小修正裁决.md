# 平台角色与最小权限管理 V1—切片 5 Abort 恢复按钮定位最小修正裁决

日期：2026-07-31
技术结论：可行。当前唯一失败是 Abort 恢复步骤的 E2E strict-mode 定位歧义，与已关闭的 503 locator 缺陷同型；未发现新的生产 P0–P3。须由产品经理重新签发单文件、单点测试修正与完整 8 项复测授权，当前不得修改测试或执行复测。

## 一、事实与根因

- 503 恢复已真实通过：同行 actions 内 exact 点击只新增一条 GET、零 PUT，GET 返回目标后提示清除、目标解锁并恢复管理按钮。
- Abort 写入已进入目标级 `role-unknown`，当前失败发生在恢复点击前。
- E2E 第 415–416 行在整个目标行内使用非精确 `getByText('刷新用户列表')`。
- 同一目标行同时包含：
  - `.platform-user-actions` 中真实“刷新用户列表”控件；
  - `.platform-target-notice` 中“请显式刷新用户列表确认真实角色。”正文。
- Playwright strict mode 因两个匹配在真正点击前失败；这不是 Abort 分类、target lock、notice 渲染或显式恢复的生产失败。

## 二、唯一允许的工程修正

唯一允许修改：

- `tests/platform-administration-v1-slice5.e2e.test.ts`

仅允许修改 Abort 恢复步骤：

1. 以 `abortTarget.username` 冻结唯一 `.platform-user-row` 为 `abortTargetRow`；
2. 冻结 `abortNotice = abortTargetRow.locator('.platform-target-notice')`，只用于精确断言 unknown 正文；
3. 点击前断言同行动态管理按钮不存在；
4. 记录当前列表 GET 数量与该目标角色 PUT 数量；
5. 在 `abortTargetRow.locator('.platform-user-actions')` 内，以 `{ exact: true }` 定位“刷新用户列表”并普通 Playwright `click()`；
6. 点击后等待同一 `abortTargetRow` 内动态命名管理按钮恢复；
7. 断言只新增一条既有列表 GET，该目标 PUT 数量不变，同行 notice 已清除。

推荐点击边界等价于：

`abortTargetRow.locator('.platform-user-actions').getByText('刷新用户列表', { exact: true }).click()`

notice 不得承担点击职责，不得使用整行或全页非精确文本定位。

## 三、必须保持

- Abort 注入方式、角色提交、完整 username 搜索、真实管理控件点击与确认步骤不变。
- 点击前目标必须保持 `role-unknown`，管理按钮不可用，unknown 正文可见。
- 恢复点击只触发一次用户列表 GET，不能新增、重放或补偿任何 PUT。
- 只有 GET 成功返回该目标后，才采用服务端摘要、清除 notice、解除锁并恢复同行管理按钮。
- 后续 `sessions-unknown`、再次撤销会话、取消与重新确认、operationId 及恢复步骤不得改变。
- A/B 多目标、503、响应截断、分页、搜索、场景顺序、timeout 与 harness 均保持。

## 四、明确禁止

- 不得修改生产代码、harness、其他测试、SCSS、状态、API Client、API、Contracts、Application、Repository、Migration、Schema、Backup、脚本或配置。
- 不得使用 force、DOM click、坐标、键盘、全页模糊文本、CSS 注入、延长 timeout 或降低断言。
- 不得调整场景顺序、跳过 sessions-unknown、预先恢复目标、自动重试或增加补偿请求。
- 不得执行真实 006、真实管理员授予、服务重启部署或任何运行库写入。

## 五、完整复测门

产品重新授权后，QA 必须原样串行执行全部 8 项：

- Abort 恢复入口在目标行 actions 内唯一命中并真实鼠标点击；
- 点击网络差值严格为一条列表 GET、零新增目标 PUT；
- GET 返回目标后 notice 清除、目标解锁并恢复动态管理按钮；
- 继续完成 sessions-unknown、再次撤销、取消、重新确认、不同 operationId 和最终明确结果；
- A/B、503、响应丢失、Abort、role/session unknown、显式恢复及无自动重试完整闭环通过；
- 24 用户、固定分页、403/404/409、actor 降级、并发互撤、owner/Backup 隔离及敏感扫描不回归；
- 临时目录、随机数据库与临时账号最终为 0；
- `knowledge_base` 与 `knowledge_base_uat` 前后分别为 `SNAPSHOTS_IDENTICAL`；
- `build:h5`、typecheck、`git diff --check` 通过。

任何私有凭据读取例外不得自动延续；如完整 E2E 仍需要，须由产品经理重新书面授权。

## 六、当前状态

- 多目标和 503 恢复均已通过；当前无新增生产 P0–P3。
- 切片 5 完整 QA 仍不通过，不得进入 V1 产品最终验收。
- 当前不允许修改测试或执行复测。
- 下一责任岗为产品经理，签发单个 E2E 文件的 Abort locator 单点修正及完整 8 项复测授权。
