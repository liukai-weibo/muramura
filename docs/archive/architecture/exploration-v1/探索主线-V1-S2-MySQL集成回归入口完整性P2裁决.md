# 探索主线 V1 S2：MySQL 集成回归入口完整性 P2 裁决

> 日期：2026-07-24
>
> 结论：**P2 成立；S2 运行库零污染门通过，但 S2 暂不得作为完整封板提交。授权一次仅修复固定 MySQL 集成回归入口的最小变更。**

## 【复审依据】

- `docs/product/当前运行事实.md`
- `docs/architecture/探索主线-V1-S2-RepositoryApplication与原子工作流架构任务书.md`
- `package.json`

QA 已在 H5 / API 均停止的窗口中，以显式 `.env` 和 `vitest run --no-file-parallelism` 完成 M1–M5、S1、S2 共 13 个真实 MySQL 测试文件回归：

```text
13 files passed / 121 tests passed
knowledge_base：SNAPSHOTS_IDENTICAL
knowledge_base_uat：SNAPSHOTS_IDENTICAL
```

故 S2 的真实 MySQL 事务、读模型与运行库零污染证据有效。

但 `package.json` 的固定入口 `test:mysql:integration` 当前仅列出 12 个文件，缺少：

```text
tests/mysql-s2-exploration-tracks.integration.test.ts
```

这会使日后的标准串行回归遗漏 S2，因此不能将 S2 描述为“完整回归入口已覆盖”或直接封板。

## 【最小补正授权】

仅允许数据 / Application / Repository 工程师修改：

```text
package.json
docs/architecture/**
docs/daily-contributions/2026-07-24.md
```

唯一修改：在现有 `test:mysql:integration` 命令中，按既有执行顺序将：

```text
tests/mysql-s2-exploration-tracks.integration.test.ts
```

追加在 `tests/mysql-s1-exploration-tracks.integration.test.ts` 后。

必须保持：

```text
vitest run --no-file-parallelism
既有 M1–M5、API M5-B 与 S1 文件均不删除、不改名、不调换
不新增第二个替代入口
不修改任何测试用例、fixtures、环境变量、用户、Docker 或数据库配置
```

## 【验证门】

在继续保持 H5 `10086`、API `32146` 无监听且无写入并行的窗口中，执行：

```text
set -a && . Knowledge_Base/.env && set +a
corepack pnpm -C Knowledge_Base test:mysql:integration
```

期望：

```text
13 files / 121 tests passed
```

且对 `knowledge_base` 与 `knowledge_base_uat` 按已冻结深度快照口径进行前后比较：

```text
SNAPSHOTS_IDENTICAL
```

并执行：

```text
corepack pnpm -C Knowledge_Base typecheck
git -C Knowledge_Base diff --check
```

无 `.env` 的常规全量测试仍须按设计跳过 MySQL 集成测试，不得连接运行库。

## 【持续禁止】

```text
migrations/**、Schema、运行库 DDL / DML、restore、清库、回退
packages/**、apps/**、tests/**
.env / .env.uat、Compose、用户、权限、端口与运行组合
S3、Backup V3、API、H5
双写、同步、回填、fallback、浏览器直连 MySQL
```

## 【后续】

补正与 QA 定向复验通过后，流转架构师完成 S2 总体稳定审阅。只有架构复审确认标准入口 13 文件覆盖且零污染门仍通过，才可流转产品经理进行 S2 封板裁决。本裁决不自动授权 S3。
