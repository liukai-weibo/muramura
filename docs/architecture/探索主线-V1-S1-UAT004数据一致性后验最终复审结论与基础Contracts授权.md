# 探索主线 V1 S1：UAT 004 数据一致性后验最终复审结论

> 日期：2026-07-24
>
> 结论：**通过。**Schema 004 的 UAT 部署、双口径数据一致性后验及 P1 比较工具边界均已关闭。允许解除“因 UAT 004 后验未完成”而施加的 H5 / API 停止要求；但 API 实际运行前仍必须依 `当前运行事实.md` 确认日常进程加载 `.env` 且 `/health` 指向 `knowledge_base`。本结论仅书面授权按既有冻结任务书实施 **S1 基础 Contracts**，不授权 S2、S3、API、H5、Backup V3 或任何范围扩张。

## 【复审依据】

- `docs/product/当前运行事实.md`
- `docs/architecture/探索主线-V1-S1-UAT004双口径比较ProfileP1补正裁决.md`
- `docs/architecture/探索主线-V1-S1-UAT004双口径比较ProfileP1补正复审结论.md`
- `scripts/uat-schema004-compare.sh`
- `tests/uat-schema004-compare.test.ts`

## 【架构独立复核】

### 1. Profile 工具边界

复核确认：

```text
corepack pnpm -C Knowledge_Base test --run tests/uat-schema004-compare.test.ts
结果：1 file / 19 tests passed
```

脚本为离线工具，只读取输入快照目录中的：

```text
schema.tsv
records.sql
manifest.sha256
```

不读取 `.env` / `.env.uat`，不连接 Docker / MySQL，未启动 H5、API 或 MySQL integration suite。

冻结的 Profile 拒绝门现已覆盖：

```text
错误目标库或 pre/post 身份不一致
非精确 001/002/003 → 001/002/003/004 演进
004 名称、checksum 或额外 migration 错误
pre 中存在任何 004 对象
post 缺失或错误的 004 列、索引或外键
exploration_tracks 额外列
exploration_tracks 缺失 PRIMARY
exploration_tracks PRIMARY 为 name
exploration_tracks PRIMARY 为 id/name 复合键
Items 既有字段变更、新列非 NULL、Track 非空、既有集合 hash 变化
```

日常库保护性反向执行也被拒绝，未被该 Profile 误判为 UAT 004 通过。

### 2. 受限真实 UAT 快照最终比较

在继续停 H5 / API、无数据库写入的条件下，对保留的受限快照执行：

```text
sh scripts/uat-schema004-compare.sh \
  /tmp/kb-uat-snapshot \
  /tmp/kb-uat-snapshot-post \
  /tmp/kb-uat-schema004-final-compare
```

输出：

```text
profileEligibilityResult = PASS
profileEligibilityFailure = none
itemsLegacyProjectionRowCountBefore = 20
itemsLegacyProjectionRowCountAfter = 20
itemsLegacyProjectionDifferences = 0
exploration_track_id IS NULL，违规计数 = 0
exploration_tracks 行数 = 0
otherExistingCollectionsUnchanged = true
otherExistingCollectionsChanged = none
itemsCompleteDump = expected-schema-representation-change
comparisonResult = PASS
```

因此，完整 Items dump 的差异仍被保留为 Schema 004 新增可空列导致的导出表示差异，未被静默忽略；Items 既有八字段、其余九个既有集合及 `system_metadata` 均保持一致。此前保护快照已证明 `knowledge_base` 完整快照前后一致。

## 【最终裁决】

UAT Schema 004 的数据一致性后验正式通过。以下事实成立：

```text
knowledge_base = schemaVersion 4 的既成现场
knowledge_base_uat = schemaVersion 4，004 受控部署与后验一致性验收通过
004 未改写 UAT 的既有 Item 业务字段
004 未产生任何探索主线业务记录或 Item 关联
```

仍持续禁止：

```text
任何运行库的 DDL 回退、删除 migration record、手工修表、清库或以恢复掩盖现场
双写、同步、回填、浏览器直连 MySQL
远程 / 公网 API、0.0.0.0、多用户与鉴权扩张
S2、S3、API、H5、Backup V3 与未冻结业务能力
```

## 【S1 基础 Contracts 实施授权】

`docs/architecture/探索主线-V1-数据ApplicationRepository实施任务书-封板后生效.md` 的“封板后生效”条件现已满足，授权数据 / Application / Repository 工程师实施其中明确属于 **S1 基础 Contracts** 的最小范围。

实施前必须：

1. 再次读取 `docs/product/当前运行事实.md`；
2. 确认 004 不得重新执行、不得修改 `migrations/004_add_exploration_tracks.sql`；
3. 不启动或改造前端 / API 运行组合；
4. 不进入 Repository、Application、API、H5、Backup V3、S2 或 S3；这些阶段须有独立书面授权；
5. 将任何 Schema、备份格式、运行路径或业务语义的发现性阻断立即上报架构，不得自行扩张。

本授权不等同探索主线 V1 整体封板，也不授权上线新业务能力。
