# 跨平台本机启动器

> 创建于 2026-08-04，WSL/Linux 日常启动入口已实现并通过隔离验证；原生 Windows 继续使用 PowerShell 兼容入口，统一前台入口尚未完成。

当前项目已经具备数据库目标校验、端口保护、API 健康检查和受控停止能力，但主要实现位于 Windows PowerShell 脚本中。项目工作目录和常用开发工具又可能运行在 WSL/Linux，导致开发者必须理解 PowerShell、Shell、Corepack、pnpm、Docker Compose、环境变量加载、API/H5 双终端和 UAT 隔离后才能正确启动。这个任务要保留现有数据与环境安全边界，先把 WSL/Linux 日常开发入口收敛为 `pnpm setup` 和 `pnpm dev`；原生 Windows 在具备可靠 Job Object 或等价进程树所有权前继续使用既有 PowerShell 入口，避免为了形式统一留下孤儿进程。

## 最终目标

首次准备环境时，开发者只需要执行：

```bash
corepack enable
pnpm install
pnpm setup
```

`corepack enable` 是机器级的一次性准备，用于根据根 `package.json` 的 `packageManager` 字段选择固定 pnpm 版本，不应出现在后续每条日常命令中。`pnpm setup` 负责创建和校验配置，并确认既有日常 MySQL 可达；如果首次生成了 `.env`，脚本必须退出并要求开发者先填写本机私有值，不能带着示例密码继续启动。当前 Compose 标识与运行事实中的真实数据容器不一致，因此数据库创建、停止和 Migration 不纳入本启动器，继续使用既有受控流程并先确认真实目标。

日常开发只需要一个前台命令：

```bash
pnpm dev
```

该命令在同一个终端中启动并展示 API 与 H5 日志。API 和 H5 由启动器直接持有，按一次 `Ctrl+C` 即可停止本次启动器创建的两个子进程；MySQL 继续独立运行并按当前运行事实单独管理。

UAT 不进入日常启动路径。日常命令永远只读取 `.env` 并连接 `knowledge_base`；后续若收敛 UAT，使用独立的 `pnpm uat:setup` / `pnpm uat:dev`，仍显式读取 `.env.uat` 并确认 `knowledge_base_uat`。

## 主要任务和改动原因

| 改动位置 | 需要做什么 | 为什么需要这样改 |
| --- | --- | --- |
| 根 `package.json` | 将主要入口收敛为 `setup`、`dev`；保留 `dev:api`、`dev:h5` 作为单服务调试入口；不改写数据库与 UAT 的既有受控入口 | 开发者应只记住稳定的日常命令，命令名称不应暴露具体操作系统或实现文件 |
| `scripts/local-runtime.mjs` | 提供无第三方依赖的 `.env` 解析、配置校验、端口探测、子进程启动、健康轮询、信号转发和 POSIX 进程组安全结束能力 | WSL/Linux 复用同一套关键规则；原生 Windows 在可靠进程树所有权完成前失败关闭 |
| `scripts/local-setup.mjs` | 在 `.env` 缺失时仅从 `.env.example` 创建并退出；配置完成后校验日常目标并确认 MySQL 可达，不自动启动容器或执行 Migration | 当前 Compose volume 与真实运行数据源身份不一致；先提供安全的跨平台配置入口，避免“初始化”意外连到另一套空数据库 |
| `scripts/local-dev.mjs` | 校验日常环境、MySQL 可达性和端口，前台启动 API，等待可信 `/health`，再启动 H5；统一输出状态和原始服务日志；失败或退出时只结束自己创建的 API/H5 | 前台编排可以删除隐藏窗口、PID 文件和平台进程树追踪等复杂度，同时让开发者直接看到错误和编译日志 |
| `archive/scripts/windows-local-launcher/` | 归档旧 `kb-init/start/stop.ps1`，从活动 `scripts/` 和 README 主路径移除 | 本机已经由 `pnpm dev` 真实运行；旧 PowerShell 仍保留历史实现，但不再形成第二套活动入口 |
| UAT 相关脚本 | 第一阶段不重写，只维持当前显式入口和隔离规则；第二阶段再评估是否复用 `local-runtime.mjs` | UAT 包含迁移、破坏性测试与故障注入，风险高于普通开发，不应为了“一次性统一”扩大首个切片 |
| `README.md` 与 `docs/development/本机迁移与一键启动.md` | README 只把 `pnpm setup`、`pnpm dev` 作为首选流程；手工启动和 PowerShell 兼容方式放在故障排查或兼容章节；说明 Corepack 只需启用一次 | 当前文档同时呈现多套入口，使开发者无法判断哪一套是默认路径；文档必须与实际跨平台能力一致 |
| `tests/local-runtime.test.ts` | 使用临时目录、随机端口和假的子进程/HTTP 响应验证配置、编排、失败清理和进程树处理；真实 MySQL 验证只在运行事实允许时单独执行 | 启动器会接触真实端口和数据库，绝大多数分支必须先在无真实数据风险的环境中证明 |

## 命令职责

### `pnpm setup`

`setup` 是显式配置检查命令，不是日常启动命令。当前执行顺序固定为：

```text
确认 Node 版本满足项目要求
→ 检查 .env
→ 不存在则从 .env.example 创建并立即退出
→ 读取并校验日常配置
→ 确认目标为 127.0.0.1 / knowledge_base
→ 确认配置中的 MySQL 端口可达
→ 输出下一步 pnpm dev
```

若 MySQL 不可达或数据库身份不明确，`setup` 必须拒绝继续并保持数据库不变。数据库创建、停止和版本升级必须使用既有受控流程，不能借 `setup` 自动完成。等 Compose 项目与 volume 身份和当前运行事实完成统一后，才能另行评估是否把“仅为空库初始化”安全收回 `setup`。

### `pnpm dev`

`dev` 是唯一推荐的日常全栈源码入口。执行顺序固定为：

```text
读取 .env，不读取 .env.uat
→ 校验 knowledge_base 与 loopback 地址
→ 检查 API/H5 端口未被占用
→ 确认既有日常 MySQL 可达
→ 前台启动 API 子进程
→ 等待 GET /health
→ 确认 status=ready、database=knowledge_base、schemaVersion 为正整数
→ 前台启动 H5 子进程
→ 等待 H5 监听
→ 输出两个入口并持续转发日志
```

API 在健康门之前退出时，启动器应保留并展示 API 已有的脱敏结构化启动诊断，然后结束自己创建的进程并以非零状态退出。健康响应指向 UAT、未知数据库或非 ready 状态时必须拒绝启动 H5。

`dev` 不执行 Migration、不恢复 Backup、不创建管理员、不运行 owner claim、不自动打开浏览器，也不在失败后自动切换数据库或重试写操作。

### 退出和停止

`pnpm dev` 保持前台运行，不再默认创建隐藏窗口或后台 PID 状态。收到 `SIGINT`、`SIGTERM`、`SIGHUP` 或自身启动失败时：

1. 仅向本次记录的 API/H5 进程组或 Windows 进程树发送结束请求。
2. 在有限等待后强制结束仍存活的自有进程组；不根据端口寻找目标。
3. 不根据端口猜测并杀死未知进程。
4. 默认不停止 MySQL。

MySQL 不属于 `pnpm dev` 的进程所有权，继续按当前运行事实单独管理。任何流程都不得提供或推荐 `docker compose down -v`。

## 技术实现方向

启动器使用 Node.js `.mjs`，不增加运行时依赖。根项目没有声明 `type: module`，使用 `.mjs` 可以明确采用 ESM，又不改变现有源码模块规则。初始化脚本只依赖 Node 标准库，因此在项目依赖尚未完整安装时也能给出可理解的配置错误。

环境文件应由启动器读取后形成明确的子进程环境。变量的实际值继续来自 `.env`，代码只固定“允许读取哪些变量”和日常环境的可信身份：`knowledge_base`、`127.0.0.1:32146`、`127.0.0.1:10086`。这些常量不能再从同一个 `.env` 中自证正确，否则误把 UAT 值写进 `.env` 时启动器也会接受。API 只接收 app MySQL 与监听配置，H5 不接收数据库凭据；父 shell 的 root、migrator、UAT、Compose 和 `NODE_OPTIONS` 等执行控制值不得透传。解析使用 Node 22 标准能力并覆盖现有模板实际使用的空行、注释、引号和包含 `=` 的值；任何日志和错误都不得输出密码、Token、完整环境或数据库原始异常。

WSL/Linux 子进程调用不能依赖 `node.exe`、`npm.cmd`、PowerShell cmdlet、`bash`、`curl`、`lsof` 或 `ss`，统一通过 Node 的 `child_process`、`net` 和内置 `fetch` 编排，并直接解析项目内 `tsx` / Taro CLI。原生 Windows 不能用不可靠的 `taskkill` 推断替代进程所有权，当前明确失败关闭并保留 PowerShell 兼容入口。

第一阶段不追求后台守护。开发服务前台运行更容易看到日志、处理热更新和正确退出，也能从根本上减少现有 Windows 启动器中隐藏窗口、临时状态、监听 PID 与进程祖先验证的复杂度。

## 必须保留的安全边界

- 日常启动只接受 `.env`、`127.0.0.1` 和 `knowledge_base`，绝不读取或推断 `.env.uat`。
- UAT 只接受 `.env.uat` 和 `knowledge_base_uat`，后续即使复用共享代码也必须使用不同的显式入口。
- 端口被占用时拒绝启动，不停止、不替换、不接管现有 UAT 或未知服务。
- `/health` 是 API 启动后的唯一可信数据库与 Schema 身份确认；不能根据端口、文案或配置猜测实际连接结果。
- 日常 `dev` 不执行 Migration；`setup` 只允许初始化没有 Schema、没有业务表的空库。
- 不修改既有 Migration，不手工改 `schema_migrations`，不删除 `mysql-data`，不自动恢复 Backup。
- 不输出或提交 `.env`、`.env.uat`、密码、Token、个人 Backup、业务数据和包含秘密的日志。
- 启动器失败时只清理自己创建的 API/H5 子进程，MySQL 和未知进程保持不变。
- Docker 容器入口 `docker/app-entrypoint.sh` 继续使用 Shell；本任务只收敛本机开发编排，不机械替换合理的 Linux 容器脚本。

## 实施顺序

### 第一阶段：冻结命令和共享规则

先为环境校验、端口检查、health 判定和退出清理建立直接测试，再实现 `local-runtime.mjs`。这一阶段不启动真实数据库，不修改 UAT 脚本。

### 第二阶段：实现日常 `setup` 和 `dev`

先实现配置检查、MySQL 可达性确认与前台开发编排，将根命令切换到新入口。数据库创建、停止和 Migration 因 Compose 数据源身份不一致而明确留在既有受控流程之外。通过假的 TCP/HTTP/子进程完成失败分支测试后，再在运行事实允许的数据库状态下执行真实冒烟。

### 第三阶段：收敛文档与兼容入口

README 只保留一条首选路径；既有 PowerShell 脚本明确标记为兼容入口。确认 Windows 与 WSL 均通过后，再决定 PowerShell 是否改成调用 `.mjs` 的薄包装，避免两套核心规则继续漂移。

### 第四阶段：独立评估 UAT 收敛

在日常入口稳定后，单独评估 `uat-db-up.sh`、`start-uat-api.sh` 和故障注入脚本。UAT 调整必须单独验证目标数据库、Schema、前后快照和恢复条件，不与日常启动器实现混在同一切片。

## 旧 PowerShell 脚本归档结果

旧 `kb-init.ps1`、`kb-start.ps1`、`kb-stop.ps1` 已整体移动到 `archive/scripts/windows-local-launcher/`，活动入口只保留 `pnpm setup` / `pnpm dev`。归档文件不再承担原生 Windows 启动或 Backup restore；原生 Windows `pnpm dev` 当前明确失败关闭，项目在 WSL/Linux 中运行。历史产品/架构文档继续保留当时的原路径事实，活动 README、开发说明和直接测试已改为新入口或归档路径。

## 验证标准

自动化验证至少覆盖：

- `.env` 缺失时只生成文件并退出，不启动 Docker 或服务。
- 配置目标为 `knowledge_base_uat`、非 loopback 地址或占位密码时拒绝。
- 父进程残留 UAT 环境变量时，日常子进程仍精确采用 `.env`，且日志不泄露值。
- API 或 H5 端口被占用时零进程替换、零数据库写入。
- MySQL 启动失败、API 提前退出、health 超时、503、错误数据库和无效 Schema 分别明确失败。
- API 未 ready 前不启动 H5。
- `Ctrl+C`、API 异常退出和 H5 启动失败均只清理本次创建的子进程。
- `dev` 与 `setup` 永远不调用 Docker、Migration、Backup restore、管理员授予或 owner claim。
- WSL/Linux 完成无私密输出的启动/退出验证；原生 Windows 在解除失败关闭前完成 Job Object 或等价所有权测试。
- 定向测试、`typecheck`、相关构建与 `git diff --check` 通过。

真实启动或 Migration 验证前必须先读取 `docs/product/当前运行事实.md`，并通过当前 `/health` 确认实际数据库和 Schema。2026-08-04 已只读确认本机 `ready / knowledge_base / schemaVersion=9`，且进程树明确为 `pnpm dev → scripts/local-dev.mjs → API/H5`；其他机器仍必须独立通过同一检查，不能复用本机结论。

## 当前进度

WSL/Linux 的 `local-runtime.mjs`、`local-setup.mjs`、`local-dev.mjs` 和根 `setup` / `dev` 命令已实现，README 已切换到新入口，旧 PowerShell 启动器已归档。当前实现按 API/H5 各自白名单传递环境变量，root、migrator、UAT 和父 shell 执行控制值不会进入无关子进程；API health 通过后才启动 H5，前台退出只清理本次记录的 POSIX 进程组。原生 Windows `pnpm dev` 当前失败关闭，不会用不可靠的 `taskkill` 冒充进程树所有权。本机真实进程树、API health 和 H5 监听已经确认；隔离启动器测试、归档脚本保护测试和 typecheck 已通过。本轮未执行 Migration、未修改数据库、未停止当前服务；其他机器的数据库初始化仍使用既有受控流程。
