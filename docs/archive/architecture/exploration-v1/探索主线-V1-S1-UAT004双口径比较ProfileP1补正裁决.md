# 探索主线 V1 S1：UAT 004 双口径比较 Profile P1 补正裁决

> 日期：2026-07-24
>
> 结论：**确认 P1：`uat-schema004-compare.sh` 未用可执行规则限定其仅适用于冻结的 UAT Schema 004 v3 → v4 部署。授权最小补正脚本与负向自动化验证；UAT 004 数据一致性后验继续未通过，H5 / API 必须保持停止。**
>
> 依据：`docs/product/当前运行事实.md`、`docs/architecture/探索主线-V1-S1-UAT004Items快照表示层差异裁决.md`、`scripts/uat-schema004-compare.sh`。

## 【P1 判断】

正向数据核验成立：既有八个 Items 字段 20 行逐行一致、新列全 NULL、`exploration_tracks` 为空、其余九个既有集合与 `system_metadata` 完整 hash 一致，且 `knowledge_base` 完整快照一致。

但比较工具本身未闭合边界：将同一份 v3 快照同时作为 pre / post 输入仍退出 `0` 并报告：

```text
comparisonResult PASS
expected-schema-representation-change
```

这说明脚本没有验证实际发生：

```text
目标库为 knowledge_base_uat
pre 为 schema 001 / 002 / 003
post 为 schema 001 / 002 / 003 / 004
post 真实存在 004 的表、列、三个索引与指定外键
pre 真实不存在该 004 对象集合
```

因此，它可能把未来 migration、错误数据库或根本未执行 004 的快照误判为可忽略的“新增 NULL 列”差异。该工具不能作为未来新增列的通用忽略机制；P1 阻断 UAT 004 最终验收。

## 【本次最小授权范围】

允许修改：

```text
scripts/uat-schema004-compare.sh
tests/uat-schema004-compare.test.ts（如现有脚本测试文件不存在则新增）
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md（实际工程修改与验证完成后追加）
```

不允许修改：

```text
scripts/uat-schema004-readonly-snapshot.sh
migrations/**
packages/**
apps/**
.env / .env.uat
docker-compose.yml、docker/mysql/**
用户、权限、端口或运行组合
任何 DDL、DML、migration、restore、清库、回退或业务写入
```

本轮不得启动 H5、API、Vitest MySQL integration suite、UAT migration 或任何业务写入进程。脚本测试必须使用合成快照文本 / 临时目录，不得连接 MySQL 或运行库。

## 【Profile 的可执行适用性门】

`uat-schema004-compare.sh` 在读取或比较 `records.sql` 前，必须从 pre / post 的 `schema.tsv` 与 `manifest.sha256` 同时验证以下全部条件；任一不符必须输出固定脱敏错误、退出非零，并且**不得**输出 `comparisonResult PASS` 或 `expected-schema-representation-change`。

### A. Snapshot 身份与目标库

```text
pre manifest 的 database = knowledge_base_uat
post manifest 的 database = knowledge_base_uat
pre / post database 必须一致
```

不得只依赖目录名、调用参数或 live 数据库查询；身份必须来自快照工件。若当前 manifest 格式无法可靠读取 database，允许最小扩展 snapshot script 的 manifest 字段格式，但仅能增加静态 `database`、schema identity、表计数 / hash 字段，不得改变其只读行为或访问边界。

### B. 精确 migration 演进

从 `schema.tsv` 解析 `schema_migrations`：

```text
pre versions：精确 001 / 002 / 003
post versions：精确 001 / 002 / 003 / 004
pre 不含 version 004
post 的 004：
  name = 004_add_exploration_tracks.sql
  checksum = 6703b3ec3a0125b867a4077d4eab350bf6df8dfe75a9f061660344696a9f8a9f
```

不得接受：

```text
pre = post = v3
pre / post 为 v4 但无 004 结构差异
任何额外 migration version
004 名称不一致
004 checksum 不一致
仅比较 MAX(version)
```

### C. 精确 004 Schema 对象演进

从 `schema.tsv` 解析并验证：

```text
pre：
- exploration_tracks 不存在；
- items.exploration_track_id 不存在；
- exploration_tracks_normalized_name_unique 不存在；
- exploration_tracks_active_updated_idx 不存在；
- items_exploration_track_created_idx 不存在；
- items_exploration_track_fk 不存在。

post：
- exploration_tracks 存在，列 / 主键定义符合正式 004；
- items.exploration_track_id 为 VARCHAR(128) NULL；
- 三个索引存在，列顺序和唯一性符合正式 004；
- items_exploration_track_fk 存在，items.exploration_track_id → exploration_tracks.id；
- 不接受借由同名但不同定义的对象通过。
```

脚本可将该固定 Profile 的预检输出写入 comparison manifest，例如：

```text
profileEligibility	schema-004-v3-to-v4-uat
profileEligibilityResult	PASS | FAIL
profileEligibilityFailure	<固定原因或 none>
```

只有 `profileEligibilityResult = PASS` 时，才允许进行既有 Items 投影比较，并将完整 dump 差异标记为 `expected-schema-representation-change`。

## 【固定负向测试矩阵】

新增或修改本地脚本测试，至少覆盖：

| 场景 | 预期 |
|---|---|
| 正确 UAT pre v3 → post v4 / 004 结构 / Items NULL 表示差异 | 退出 0，`profileEligibilityResult PASS`，`comparisonResult PASS` |
| 同一 v3 snapshot 作为 pre 与 post | 非零；拒绝“post 缺少 version 004”；不得出现 PASS 或 expected 表示差异 |
| pre 为 v4 | 非零；拒绝“pre 不精确为 001/002/003” |
| post 缺少 004、004 文件名错误、checksum 错误、或存在额外 version | 非零 |
| pre 存在任一 004 对象 | 非零 |
| post 缺少任一 004 对象或对象定义不符 | 非零 |
| manifest database 非 knowledge_base_uat 或 pre/post 不同 | 非零 |
| Profile 合格但既有 Item 字段不同 / 新列非 NULL / Track 非空 / 其他集合 hash 变化 | 非零，保留逐项差异 |

负向工件可为最小合成 `schema.tsv`、`manifest.sha256`、`records.sql` 与本地临时目录；禁止连接 Docker / MySQL，禁止读取真实受限快照内容进入项目或 Git。

## 【QA 复验与后续】

QA 必须先验证脚本正向与所有冻结负向场景。仅在工具 Profile 门通过后，才允许在**继续停 H5 / API、无并行写入**的状态下，使用已保存的受限 UAT v3 / v4 快照重新执行比较。

UAT 004 数据一致性后验最终通过条件：

```text
Profile eligibility = PASS。
Items 八个既有字段逐行一致，20 行。
exploration_track_id 非 NULL 计数 = 0。
exploration_tracks 行数 = 0。
其余九个既有集合与 system_metadata hash 一致。
knowledge_base 完整快照一致。
原始 Items 完整 dump 差异保留并明确归类为 004 表示层变化。
```

在 QA 通过与架构复审前，继续禁止启动 H5 / API、API health、基础 Contracts、Repository、Application、Backup V3、S2、S3 和任何数据库写操作。
