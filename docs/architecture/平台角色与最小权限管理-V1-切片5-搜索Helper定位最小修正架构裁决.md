# 平台角色与最小权限管理 V1—切片 5 搜索 Helper 定位最小修正架构裁决

日期：2026-07-31
结论：可行，但须由产品经理重新签发单点测试修正与完整 8 项复测授权；当前不得修改代码或执行复测。

## 一、事实核对

- 最新完整 E2E 为 1 文件 8 项，6 通过、2 失败。
- 24 名用户、固定每页 20 条、第 1/2 页、稳定排序、字面量搜索、清除、分页和刷新场景已经通过。
- 搜索输入卸载与顶部按钮真实指针命中两个既有 P1 保持关闭。
- `.platform-more-button` 已按既有授权增加 `role="button"`，但两项失败均未执行到该管理控件。
- `locateManagementUser()` 与 `clearManagementSearch()` 新增了同一定位：`getByRole('button', { name: '搜索', exact: true })`。
- 搜索 Taro 宿主没有冻结的 button role；等待该 role 8 秒超时是测试 helper 的定位假设错误，不是新的生产缺陷。
- 同一 E2E 内既有通过场景已使用 `.platform-administration-search-button` 完成真实鼠标点击，证明该入口的几何、指针命中和单次提交能力有效。

## 二、最小修正冻结

唯一允许修改的工程文件：

- `tests/platform-administration-v1-slice5.e2e.test.ts`

只允许：

1. 将 `locateManagementUser()` 中搜索提交改为对 `.platform-administration-search-button` 的普通 Playwright `click()`。
2. 将 `clearManagementSearch()` 中搜索提交改为对同一选择器的普通 Playwright `click()`。

必须保持：

- 搜索输入仍通过真实 textbox 填写或清空。
- 搜索提交仍是真实 Playwright 鼠标点击，不使用 force、DOM、坐标、键盘或运行时注入。
- 管理控件继续且只能通过 `getByRole('button', { name: \`管理${username}\` })` 唯一定位和真实点击。
- 完整 username 定位、24 用户、固定每页 20 条、两页覆盖、稳定排序及测试间 query/page 清理逻辑不变。
- 每次提交只产生一条既有 GET，不改变生产搜索、分页、权限、写锁或 unknown-outcome 语义。

## 三、明确禁止

- 不得为搜索按钮新增生产 `role`，不得修改其 DOM、文案、交互或样式。
- 不得修改 `apps/client` 下任何生产源码、SCSS、状态或 API Client。
- 不得修改切片 5 harness、其他测试、Contracts、Application、Repository、API、Migration、脚本或配置。
- 不得通过 force click、DOM click、坐标、键盘替代、CSS 注入、延长 timeout 或降低断言绕过真实交互。
- 不得执行真实 006、真实管理员授予、服务重启部署或任何运行库写入。

## 四、完整复测门

产品重新授权后，QA 必须原样串行执行修正后的全部 8 项 E2E，而不是只跑两个失败项：

- 搜索 helper 必须以真实 textbox 加 `.platform-administration-search-button` 普通点击完成提交，并验证单次既有 GET。
- 管理控件必须继续由 role 与动态 accessible name 唯一解析并真实鼠标点击。
- 完成角色授予/撤销、会话撤销，以及角色和会话两类 unknown-outcome、503、Abort、响应丢失和显式重读闭环。
- 保留 Schema 5 启动拒绝、Schema 6 临时库启动成功、403/404/409、actor 降级、并发互撤、owner/Backup 不扩权和敏感信息扫描。
- 随机临时目录、数据库及账号在 finally 后均为 0。
- `knowledge_base` 与 `knowledge_base_uat` 前后只读深度快照须分别为 `SNAPSHOTS_IDENTICAL`。
- `build:h5`、`typecheck` 与 `git diff --check` 均须通过。
- 任何私有凭据读取例外不得从上一轮自动延续，若执行仍需要，必须由产品另行明确授权并保持不回显、不落盘、不写回。

## 五、状态裁决

- 本轮两项失败归类为同一个 E2E helper 定位缺陷，不新增生产 P0–P3。
- `.platform-more-button` 的生产可访问性修正尚未获得完整管理闭环通过证据，必须由修正后的完整 8 项 E2E 验证。
- 切片 5 QA 当前仍不通过，不得进入 V1 产品最终验收。
- 当前责任岗转产品经理，由其决定是否签发单个测试文件修正及完整复测授权。
