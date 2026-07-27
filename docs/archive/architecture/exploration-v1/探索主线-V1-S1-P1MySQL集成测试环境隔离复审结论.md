# 探索主线 V1 S1：P1 MySQL 集成测试环境隔离复审结论

> 日期：2026-07-24
>
> 结论：**P1 MySQL 集成测试环境隔离门通过并关闭。未授权基础 Contracts、UAT 004 部署、S2、S3、API、H5 或 Backup V3。**
>
> 依据：`docs/product/当前运行事实.md`、`docs/architecture/探索主线-V1-S1-P1MySQL集成测试环境隔离裁决.md`、`tests/mysql-m2a.integration.test.ts`。

## 【复审事实】

`mysql-m2a.integration.test.ts` 已满足隔离要求：

```text
随机 kb_m2a_* database
独立 app / migrator 用户
migrator 仅在临时库运行当前 migrations/
全部 M2-A 用例仅使用临时 app / migrator pool
database 显式断言不等于 MYSQL_DATABASE，也不等于 knowledge_base_uat
afterAll 停止 pool 并删除临时 database / 用户
```

QA 在受控停写窗口完成完整验证：

```text
H5 10086 与 API 32146 无监听
无人工 H5 / API、UAT、migration、restore、清库或其他运行库写入
显式加载 .env 后执行 test:mysql:integration
12 files / 110 tests passed
```

`knowledge_base` 与 `knowledge_base_uat` 的前后深度快照均为 `SNAPSHOTS_IDENTICAL`，覆盖：

```text
schema_migrations
十个业务集合的行数
按主键稳定排序的全量内容 SHA-256
完整记录
system_metadata
```

因此，完整 MySQL integration suite 在可排除并行运行时写入的停写窗口内，已被证明不会修改两个运行库的 Schema、业务数据或 metadata。P1 关闭。

## 【现场状态保持】

以下运行事实维持：

```text
knowledge_base：schemaVersion 4（历史 M1 测试造成的既成状态）。
knowledge_base_uat：schemaVersion 3（尚未部署 004）。
```

此前 `knowledge_base.items 459 → 534` 的历史增量仍无法可靠归因；它是事实记录，不是可安全删除的测试垃圾。禁止清库、删除、回填、恢复或 DDL 回退来处理该增量。

## 【边界与下一门】

本结论仅关闭测试环境隔离 P1，不等同于 S1 Schema 004 验收或运行环境部署授权。

持续禁止：

```text
基础 Contracts
向 knowledge_base_uat 执行 004
对任一运行库执行 migration、清库、恢复或测试业务写入
S2、S3、API、H5、Backup V3
```

下一步只能进行一次独立的 S1 Schema 004 稳定审阅：汇总 004 DDL 前预检、正式 SQL、临时库成功 / 冲突 / checksum / 权限证据、串行 MySQL suite 与 P1 零污染复验；再裁决是否可对 UAT 进行受控 004 部署，以及是否可授权基础 Contracts。任何运行环境部署必须另有书面授权、明确目标库、备份 / 停写 / 失败处置与 QA 验收门。
