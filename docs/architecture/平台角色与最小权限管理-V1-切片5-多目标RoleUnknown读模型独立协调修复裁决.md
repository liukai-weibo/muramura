# 平台角色与最小权限管理 V1—切片 5 多目标 Role Unknown 读模型独立协调修复裁决

日期：2026-07-31
技术结论：可行。当前稳定失败是生产 P1，违反切片 4 已验收的“GET 返回目标独立采用并解锁，未返回目标独立保留”的规则。须由产品经理另行签发最小前端修复与直接交错时序测试授权；当前不得编码或复测。

## 一、根因

当前 `reconcileRoleUnknownRead(previous, result, unknownFacts, readFactGeneration)` 在仍有未返回的 unknown 目标时，以 `previous.items` 为底，仅替换其中已解析目标。

真实交错中：

1. A 已由显式 GET 解析；
2. B 随后进入 `role-unknown`，当前旧可见快照只包含 B；
3. 用户以 A 的完整 username 发起新 GET，服务端合法结果只包含 A；
4. B 未出现在结果中，因此 reconciliation 继续使用只含 B 的旧快照；
5. A 虽在本次真实结果中，却不在旧数组内，无法被 replace，最终不可见。

该实现把“当前查询的可见读模型”与“未解析目标的旧事实保留”错误绑定。它既遮蔽本次服务端结果，也使一个 unknown 目标阻塞另一个目标的显式确认。

## 二、冻结的数据与可见性边界

### 2.1 当前可见页

每次满足 Abort、读取代次、认证上下文和事实代次保护的成功 GET，当前可见 `PlatformUserPage` 必须精确采用本次服务端结果：

- `items` 不增、不减、不拼接旧页；
- `page`、`pageSize`、`total` 原样采用；
- 服务端 `createdAt DESC → userId ASC` 顺序不变；
- 完整 username 搜索结果不得混入不匹配的旧 unknown 目标；
- 分页结果不得追加其他页的旧目标。

不得以旧 `previous.items` 作为当前结果的合并底表，也不得把 B 追加到只返回 A 的查询结果中。

### 2.2 未解析 role-unknown 事实

role-unknown 必须改为独立、仅前端内存态、按 `targetId` 键控的记录。每条记录最少包含：

- `formedAtFactGeneration`：该 unknown 形成时的事实代次；
- `lastConfirmedSummary`：最终确认发起前，当前快照中该目标最后一次由服务端确认的完整 `PlatformUserSummary`。

`lastConfirmedSummary` 的可信来源只能是写入前已通过 API DTO 校验的当前服务端快照；不得由 requested roles、按钮动作、username、时间或前端推断拼出。

该记录仅用于保留目标旧事实与协调解锁：

- 目标未被当前 GET 返回时，记录、`targetNotices[targetId]` 与 `targetLocks[targetId]='role-unknown'` 全部保留；
- 目标因当前 query/page 不匹配而不可见是正确行为，不得为了展示旧提示污染当前结果；
- 后续有效 GET 返回该 targetId 且读取事实代次不早于形成代次时，仅该目标采用服务端摘要、删除自身 unknown 记录、清除自身 notice 并解锁；
- 其他未返回目标不变化，也不得阻断当前返回目标的展示或解析。

认证上下文卸载时仍随组件状态一并销毁，不得进入 localStorage、IndexedDB、全局状态或跨登录缓存。

### 2.3 sessions-unknown

`sessions-unknown` 不依赖用户列表确认，继续保持既有“再次撤销会话”确认链和新 operationId 规则。本修复不得把会话 unknown 纳入角色 GET reconciliation，也不得使任何 GET 自动解除会话锁。

## 三、最小实现裁决

推荐以单一内部 Map 取代当前仅保存形成代次的 `roleUnknownFactsRef`：

- key：`targetId`；
- value：`{ formedAtFactGeneration, lastConfirmedSummary }`；
- 该类型仅属于 `platform-administration-state.ts` 的前端内部状态，不是 Contracts、DTO 或持久字段。

写入编排必须在最终确认兼容性校验通过后、发送请求前冻结目标的最后服务端摘要。只有角色写入形成 unknown 时才写入该 Map；明确成功、明确 404/409 等失败不得伪造 unknown 记录。

`reconcileRoleUnknownRead` 必须调整为：

1. 以本次 `result` 作为唯一可见 snapshot；
2. 逐个检查 role-unknown 记录；
3. 当前 result 包含目标且读取事实代次满足条件时，将其加入 `resolved`；
4. 未包含的目标加入 `unresolvedTargetIds`，但不改变 result；
5. 函数不得修改输入 Map；组件只删除 `resolved` 中对应记录，并只清除对应锁和提示。

不得通过改变 E2E 顺序、先恢复 B、自动发额外 GET、自动重试写入或放宽搜索/分页来规避。

## 四、精确允许修改文件

后续产品编码授权最多允许以下四个工程文件：

### 生产前端

- `apps/client/src/pages/index/platform-administration-state.ts`
  - 内部 role-unknown 记录类型；
  - reconciliation 纯函数改为当前服务端 result 决定可见页、目标逐项解析。
- `apps/client/src/pages/index/platform-administration.tsx`
  - 写前冻结最后服务端摘要；
  - role unknown 记录的建立、逐目标删除及认证上下文销毁；
  - 不改变页面结构、文案、操作入口或 API 调用。

### 直接测试

- `tests/platform-administration-h5-state.test.ts`
  - A/B 同时 unknown，GET 只返回 A：可见 snapshot 精确等于 A 的服务端结果，A resolved，B unresolved 且旧记录保持；
  - 随后 GET 只返回 B：B 独立采用并解锁；
  - query/page/total/order 原样采用，不把 B 注入 A 的搜索结果；
  - 单目标缺失继续 unknown，但不得保留旧页遮蔽合法空结果。
- `tests/platform-administration-h5-flow.test.ts`
  - 最后确认前冻结服务端摘要，不使用 requested roles 推断；
  - 只删除当前 resolved 目标；
  - 未返回目标的 notice、lock 和记录保持；
  - sessions-unknown 不受列表 GET 影响。

必要的架构、产品授权、QA、验收与当天贡献记录可随对应责任岗更新。

## 五、明确禁止

- 不得修改 `api-client.ts`、API、Contracts、Application、Repository、Migration、Schema、Backup、配置或数据库。
- 不得修改 H5 页面布局、SCSS、管理按钮 role、搜索、分页、排序、权限、operationId 或写入语义。
- 不得新增路由、DTO、字段、持久缓存、全局状态库、自动 GET、轮询、自动重试或补偿写入。
- 不得修改切片 5 E2E/harness 来绕过当前交错顺序；生产修复后必须由既有场景原样证明。
- 不得执行真实 006、真实管理员授予、服务重启部署或任何运行库写入。

## 六、验收门

### 直接前端测试

至少覆盖：

1. A、B 均 unknown，GET(A) 后 A 可见、采用真实摘要并解锁；B 的旧摘要记录、notice 和 lock 不变。
2. 当前搜索只返回 A 时，snapshot 仅含 A，分页与 total 为服务端值，不显示 B。
3. 后续 GET(B) 只解析 B，不改变已确认 A。
4. GET 不含任何 unknown 目标时，成功结果仍真实显示；所有未返回目标继续独立 unknown。
5. 读取失败、Abort、旧 generation、旧 auth、旧 fact 不改变可见事实或任何 unknown 状态。
6. 明确角色成功、404/409、503、响应丢失与 sessions-unknown 的既有边界不回归。

### QA 完整复测

产品授权且前端工程门通过后，QA 必须原样串行执行切片 5 全部 8 项，重点证明：

- 不调整 A/B 顺序，不预先恢复 B；
- B 未解析时搜索 A，单次 GET 返回 A 后 A 立即可见并采用服务端摘要；
- B 仍保持 unknown，直至包含 B 的后续显式 GET；
- 完成后续 503、Abort、role/session unknown、响应丢失和显式恢复闭环；
- 无自动写重试、无额外补偿写入；
- 临时目录、随机数据库和账号最终为 0；
- `knowledge_base` 与 `knowledge_base_uat` 前后分别为 `SNAPSHOTS_IDENTICAL`；
- 定向测试、完整 H5 回归、typecheck、`build:h5` 与 `git diff --check` 通过。

私有凭据读取例外不得自动延续；如完整 E2E 仍需要，须由产品经理再次书面授权。

## 七、当前状态

- 生产 P1 成立，切片 5 QA 不通过。
- 当前不允许编码或测试执行。
- 下一责任岗为产品经理，签发上述四文件最小前端修复、直接测试及完整 8 项 QA 复测授权。
- 未经修复复测、QA 通过和产品最终验收，不得宣称平台角色 V1 完成。
