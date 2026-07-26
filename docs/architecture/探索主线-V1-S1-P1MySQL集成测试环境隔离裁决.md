# 探索主线 V1 S1：P1 MySQL 集成测试环境隔离裁决

> 日期：2026-07-24
>
> 结论：**确认 P1 环境隔离缺口；授权将 `mysql-m2a.integration.test.ts` 迁至随机临时数据库，并要求停写窗口的完整 suite 零污染复验。未完成前不得进入基础 Contracts、UAT 004 部署或 S2 / S3。**
>
> 依据：`docs/product/当前运行事实.md`、`tests/mysql-m2a.integration.test.ts`、`tests/mysql-m1.integration.test.ts`、当前 `test:mysql:integration` 文件集合。

## 【P1 结论】

当前不能宣称完整 MySQL integration suite 对日常库零污染。

已确认：

```text
knowledge_base：schema records 1–4 保持；reviews 4 → 4；items 459 → 534。
knowledge_base_uat：schema records 1–3、items 20、reviews 14 均保持不变。
```

75 条 Item 增量不能基于现有证据唯一归因：历史 `mysql-m2a.integration.test.ts` 直接使用 `.env` 的 `MYSQL_DATABASE` 创建 app / migrator pools 并执行业务写入；同时验收窗口可能存在 H5 / API 写入。因此“名称前缀清理”不是有效隔离证明。

代码盘点确认：在现有 `test:mysql:integration` 文件集合中，`mysql-m2a.integration.test.ts` 是仍直接以 `.env` 的 `MYSQL_DATABASE` 连接业务 app / migrator pool 的唯一测试文件。其余 M1、M2-B、M3、M4、M5、API M5-B 与 S1 文件均使用随机临时数据库，或仅以 `.env` 获取 root 连接所需 host / port / 凭据后再创建临时库。

该缺口定为 **P1**：它允许自动化测试向当前日常运行主库写入，且无法对测试写入和真实用户写入做可信归因。

## 【运行事实裁决】

以下事实保持，不回滚、不重写：

```text
knowledge_base：schemaVersion 4。
knowledge_base_uat：schemaVersion 3。
```

`knowledge_base` 的既成 004 状态不代表 S1 已验收。`knowledge_base_uat` 在独立运行环境部署授权前仍禁止 004。

本轮发现的 Items 增量作为事实记录；不得删除、回填、恢复、清库或试图通过数据操作归零。当前不掌握每条记录的可信来源，任何清理都会存在删错用户真实数据的风险。

## 【一次性最小授权】

允许修改范围：

```text
tests/mysql-m2a.integration.test.ts
package.json（仅 test:mysql:integration 集合 / 启动参数确有必要时）
docs/daily-contributions/YYYY-MM-DD.md（实际工程验证后追加）
```

不得修改：

```text
任何 migrations/**
packages/**
apps/**
BackupData / BackupDocumentV3
其余测试文件
MySQL Compose、账号、权限、端口或运行组合
knowledge_base / knowledge_base_uat 的 schema、业务数据、migration、清库、恢复
```

## 【`mysql-m2a` 迁移要求】

`mysql-m2a.integration.test.ts` 必须改为整文件使用单个随机临时 database 与独立 app / migrator 用户；不得保留任何直接以 `.env` 的 `MYSQL_DATABASE` 创建业务 pool 的路径。

受控 fixture 要求：

```text
root 使用 .env 仅取得 host、port、root 密码
→ 创建随机 kb_m2a_<uuid> database
→ 创建随机 app / migrator 用户
→ app：SELECT / INSERT / UPDATE / DELETE
→ migrator：既有 DDL 最小权限
→ migration 在临时库执行当前 migrations/ 目录
→ 所有 M2-A 用例只使用临时 app / migrator pool
→ 每个 test 后清理仅临时库中的合成数据，或隔离 fixture 重新建库
→ afterAll / finally 停止 pool、DROP 临时 database、DROP 临时用户
```

fixture 必须显式断言：

```text
database 匹配 /^kb_m2a_/
database !== process.env.MYSQL_DATABASE
database !== knowledge_base_uat
```

不得降低既有 M2-A 业务覆盖、减少状态转移组合、删减跨对象 purge 场景、放宽失败回滚断言或通过更长 timeout 解决问题。不得让 migration 只在第一个测试隐式执行而其余测试依赖日常库残留；临时 schema 必须在 fixture 初始化时明确准备。

## 【停写窗口零污染复验】

迁出完成并完成定向测试后，QA 必须在一次受控停写窗口执行完整复验。

### 停写窗口前置

```text
1. 停止本机 H5 与 API 进程，确认 127.0.0.1:10086 / 127.0.0.1:32146 无监听。
2. 禁止人工浏览器操作、UAT、migration、backup restore、清库与其他 MySQL 写入任务。
3. 只读获取 knowledge_base 与 knowledge_base_uat 的：
   - schema_migrations 全量 records；
   - 十个业务集合的行数；
   - 按表主键稳定排序的 SHA-256 内容摘要，或等价可复算快照；
   - system_metadata 摘要。
4. 记录快照时间、目标 database 与只读凭据 / 查询命令。
```

### 执行与后置

```text
5. 在 .env 下执行 corepack pnpm test:mysql:integration。
6. 测试运行期间不得启动 H5 / API 或任何并行数据库任务。
7. 运行后以同一方法复取两个库完整快照。
8. 两个库的 schema records、十个业务集合、system_metadata 的行数与内容摘要均必须逐项相等。
9. 若任一差异存在，立即停止，保留前后快照与测试日志，按 P1 再次裁决；不得自行清理差异。
```

“只比较 items / reviews 行数”不足以证明零污染；必须覆盖全部业务集合与 `system_metadata`。快照仅为验证目的，不能向业务 API 或浏览器暴露 metadata。

## 【验收门】

QA 与架构复审通过需要同时满足：

```text
mysql-m2a 定向临时库运行通过，且 fixture 清理无残留。
M1 / M2-A / M5 / S1 定向运行证明都连接随机临时库。
.env 下 test:mysql:integration：全部文件、全部测试通过。
停写窗口前后：knowledge_base、knowledge_base_uat 完整快照完全一致。
无 .env 常规全量 test、typecheck、git diff --check 通过。
日常库 schemaVersion 4、UAT schemaVersion 3 未变化。
```

若满足，才可关闭 P1，并重新进行 S1 Schema 004 的 QA / 架构稳定审阅；这不自动授权基础 Contracts或 UAT 004 部署。

## 【持续禁止】

在 P1 关闭前，持续禁止：

```text
基础 Contracts、UAT 004 部署、S2、S3、API、H5、Backup V3。
对 knowledge_base / knowledge_base_uat 进行 migration、DDL 回退、清库、恢复或测试业务写入。
将当前或后续测试直接连接 MYSQL_DATABASE。
测试与 H5 / API 运行并发，随后声称测试零污染。
```
