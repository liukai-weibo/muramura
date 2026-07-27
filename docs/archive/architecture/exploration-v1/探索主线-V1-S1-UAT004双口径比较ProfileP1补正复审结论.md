# 探索主线 V1 S1：UAT 004 双口径比较 Profile P1 复审结论

> 日期：2026-07-24
>
> 结论：**不通过，P1 未关闭。**QA 已证明离线工具、基础 migration 身份门和既有数据一致性核验大部分成立，但脚本未完整实现已冻结的“精确 004 Schema 对象定义”门。本结论仅授权一次最小补正；H5 / API 必须继续停止。

## 【复审依据】

- `docs/product/当前运行事实.md`
- `docs/architecture/探索主线-V1-S1-UAT004双口径比较ProfileP1补正裁决.md`
- `scripts/uat-schema004-compare.sh`
- `tests/uat-schema004-compare.test.ts`

架构复跑以下离线测试，结果通过：

```text
corepack pnpm -C Knowledge_Base test --run tests/uat-schema004-compare.test.ts
1 file / 15 tests passed
```

该命令只产生本机临时合成快照工件，不连接 Docker / MySQL，也不启动 H5、API 或 migration。

## 【已确认成立】

1. 比较工具仅读取 pre / post 的 `schema.tsv`、`records.sql` 与 `manifest.sha256`，不读取运行环境或连接 MySQL。
2. 工具已经拒绝错误目标库、pre/post 非精确 migration 版本、004 名称或 checksum 错误、额外 migration、pre 004 对象存在、post 必需对象缺失及既有数据不变量失败。
3. 同一 v3 快照不再被标记为通过；未通过 Profile 时不会输出 `comparisonResult PASS` 或 `expected-schema-representation-change`。
4. QA 对受限真实 UAT v3/v4 快照的正向结果仍可作为已取得的数据证据，但尚不可作为最终验收结论。

## 【P1 未关闭的根因】

冻结裁决要求 post 快照中的 004 对象为**精确**定义，至少包括：

```text
exploration_tracks 固定六列且无额外列
exploration_tracks.id 主键
三个固定索引的名称、唯一性、列顺序和排序
items.exploration_track_id 的固定类型与可空性
固定外键的本地列、目标表、目标列及约束语义
```

现有 `postSchemaMatches()` 仅检查六个必需列“存在”，未拒绝 `exploration_tracks` 的额外列；也未解析或验证 `exploration_tracks.id` 主键。因此下列未冻结的 Schema 仍可能错误通过 Profile：

```text
exploration_tracks 被额外 ALTER ADD COLUMN
exploration_tracks.id 不是主键或主键定义被替换
```

这违反“同名但不同定义必须拒绝”与“固定列 / id 主键定义”的验收要求。测试中的 `invalid post object definition` 目前只覆盖 `items.exploration_track_id` 宽度错误，未覆盖上述缺口。

## 【最小补正授权】

仅允许数据 / Application / Repository 工程师修改：

```text
scripts/uat-schema004-compare.sh
tests/uat-schema004-compare.test.ts
docs/architecture/**
docs/daily-contributions/2026-07-24.md
```

允许的唯一目标：将 post 004 Schema Profile 收紧为精确定义。

1. `schema.tsv` 解析必须纳入主键记录，或以其已有 index 记录中可判定的主键形式验证 `exploration_tracks.id` 为唯一主键；若现有 snapshot 格式无法表达主键，必须先停止并申请对只读 snapshot 格式的最小补充授权，不得猜测。
2. 验证 `exploration_tracks` 的列集合精确等于：
   `id`、`name`、`normalized_name`、`created_at`、`updated_at`、`deleted_at`；并逐列验证类型与可空性。
3. 验证 `exploration_tracks` 的主键精确为 `id`，不得接受缺失、复合主键或不同列。
4. 保持已有 migration、items 列、索引、外键、数据投影与集合 hash 门不变；不得将本次校验抽象为未来 migration 的通用豁免。
5. 增加至少以下离线合成负向测试：
   - post `exploration_tracks` 额外列；
   - post 缺失 id 主键；
   - post 使用不同或复合主键；
   - 若 snapshot 格式支持，post 同名主键定义异常。

## 【继续禁止】

```text
H5、API、API health
Docker / MySQL 连接
DDL、DML、migration、restore、清库、回退
migrations/**、packages/**、apps/**
.env / .env.uat、Compose、用户、权限、端口或运行组合
基础 Contracts、Repository、Application、API、H5、Backup V3、S2、S3
```

禁止读取真实受限快照内容进入项目或 Git；自动化测试仅可使用合成工件与项目外临时目录。

## 【P1 关闭条件】

补正经 QA 定向复验并由架构复审确认后，必须在仍停 H5 / API、无并行写入的状态下，对保留的真实 UAT v3/v4 受限快照重跑离线比较，并同时满足：

```text
profileEligibilityResult = PASS
Items 八个既有字段 20 行逐行一致
exploration_track_id 非 NULL = 0
exploration_tracks = 0
其余九个既有集合及 system_metadata hash 一致
knowledge_base 完整快照一致
完整 Items dump 差异仅被明确标为 expected-schema-representation-change
```

仅届时可宣布 UAT Schema 004 数据一致性后验通过，并另行决定是否允许 UAT API health 与 S1 基础 Contracts 审阅；本结论不授权任何业务实现。
