# SQLite 主库迁移 — S6-A 架构复审与 S6-B 方案评审授权

> 状态：**S6-A 的 Local API / SQLite 运行保护核心通过架构复审；静态托管尚缺一项定向测试证据，S6-A 暂不最终封板。批准进入 S6-B 产品与前端 HTTP Client 方案评审；不批准 S6-B 写代码。**
>
> 当前唯一运行主库仍为 IndexedDB。SQLite 仍只允许作为候选存储和临时合成测试目标。

## 【技术结论：有条件可行】

已核对：

```text
apps/local-api/src/index.ts
apps/local-api/src/main.ts
tests/local-api-s6a.test.ts
```

S6-A 已满足 Local API 的核心安全边界：

```text
固定监听 127.0.0.1:32145
SQLite 打开、Schema 初始化与 quick_check 成功才为 ready
database 打开 / 目录 / 完整性失败时显式返回 database-unavailable
失败时不回退 IndexedDB，不创建替代空库
/api/* 当前除 health 外均返回 not-found
```

但 S6-A 范围包含“静态托管”，现有定向自动化只验证 `/api/health`，尚未请求并断言静态根入口、静态不存在资源和路径穿越边界。不能仅凭代码阅读将静态托管描述为已验收，因此 S6-A 暂不最终封板。

该缺口不影响批准**S6-B 方案评审**，但阻止 S6-B 实现开工。

## 【一、监听地址与远程访问边界：冻结通过】

以下边界冻结：

```text
host = 127.0.0.1
port = 32145
日常入口 = http://127.0.0.1:32145
```

当前实现同时在类型和运行时校验：

```text
host !== '127.0.0.1' → 拒绝启动
port !== 32145         → 拒绝启动
```

因此以下均禁止：

```text
0.0.0.0
localhost 的可配置替代
IPv6 / ::1 监听
局域网或公网 host
通过环境变量、CLI 参数或前端设置覆盖 host / port
```

若未来需要端口冲突诊断，只能返回“固定端口已被占用”的可行动错误；不得为提高可用性自动寻找端口、更改 host 或开放网络边界。

## 【二、数据库失败降级：冻结通过】

`database-unavailable` 是数据库不可用时**唯一允许**的服务端语义：

```text
GET /api/health
→ 503
→ {
     status: 'database-unavailable',
     databasePath,
     error
   }
```

覆盖的失败类别包括：

```text
LOCALAPPDATA / 数据目录不可用
SQLite 文件不可打开
Schema migration 失败
quick_check / 完整性检查失败
磁盘不可写或等价 SQLite 初始化失败
```

铁律：

```text
database-unavailable
≠ 空数据
≠ 首次使用
≠ 允许创建浏览器 IndexedDB
≠ 允许创建替代 SQLite 空文件
```

数据库文件损坏或路径不可用时，必须保留原文件及错误路径，等待用户检查文件或从 JSON 备份执行受控恢复。不能静默覆盖、重命名后重建或自动清库。

## 【三、生产数据路径：冻结通过】

生产默认路径冻结为：

```text
%LOCALAPPDATA%\Knowledge_Base\knowledge-base.db
```

恢复点目录保持冻结：

```text
%LOCALAPPDATA%\Knowledge_Base\backups\
```

`defaultLocalApiPaths()` 是唯一的默认生产路径构造入口。若 `LOCALAPPDATA` 缺失：

```text
拒绝启动
输出明确错误
不得退回项目目录、浏览器存储、临时目录或用户主目录猜测路径
```

测试可传入临时 `databasePath`，但这只服务自动化；不得成为生产环境隐式 fallback。

`.db`、WAL/SHM 伴随文件、自动恢复点与用户手工 JSON 备份均不得进入 Git。

## 【四、S6-A 功能范围：冻结】

S6-A 仅允许：

```text
Node Local API 进程
SQLite 打开与运行保护
GET /api/health
已构建 H5 静态文件托管
```

当前 `/api/*` 除 `/api/health` 以外统一 `404 { error: 'not-found' }` 的行为正确，应保持到 S6-B 方案冻结后。

S6-A 明确禁止新增：

```text
业务读写 API
备份 / 恢复 API
迁移 API
任何 HTTP 调用 Application 写命令的接口
前端 HTTP Client
apps/client 的 IndexedDB 移除或页面状态改造
真实 JSON 导入
双写、主库切换
```

## 【五、S6-A 封板前唯一补测】

只允许补充 `tests/local-api-s6a.test.ts` 或等价 S6-A 定向测试。必须覆盖：

1. 静态根入口：
   ```text
   GET /
   → 200
   → 返回测试 staticDirectory 中的 index.html 内容
   ```
2. 静态资源：
   ```text
   GET /known-file.js
   → 200
   → 返回对应文件
   ```
3. 不存在的静态资源：
   ```text
   GET /missing-file.js
   → 404
   ```
4. 路径穿越：
   ```text
   GET /../任意路径
   GET /%2e%2e/任意路径
   → 不得读取 staticDirectory 外文件
   → 404
   ```

该补测仅验证已实现的静态托管边界。除非暴露真实缺陷，不得改动 Local API 以外的层。

补测通过后：

```text
数据 / API 工程师 → QA S6-A 轻量复验 → 架构师 S6-A 封板
```

## 【六、S6-B 方案评审：授权但不允许实现】

批准下一责任岗启动**产品经理 + 设计师 + 架构师**的 S6-B 方案评审，目标是冻结前端从浏览器 IndexedDB 改为 Local API HTTP Client 的页面状态、阻断页、错误反馈和开发调试边界。

S6-B 方案必须回答：

### 1. 读取与页面初始化

```text
页面加载
→ GET /api/health 或 bootstrap 读模型
→ ready 才进入工作台
→ API 不可达 / database-unavailable 时进入阻断页
```

不得先渲染空工作台，再异步发现数据库不存在。

### 2. 阻断页设计

必须区分：

```text
Local API 未启动 / 无法连接
数据库不可用
静态文件加载成功但 API 路径异常
```

页面需展示固定 API 地址、可行动建议和重试操作。不得暴露 SQL、备份正文或不必要个人数据。

### 3. 前端 API adapter

可以评估建立同形异步 adapter，但它必须：

```text
只调用已冻结 HTTP 业务 Contract
不 import storage-indexeddb
不 import storage-sqlite
不创建浏览器数据库
不在前端拼接跨表关系
```

### 4. 用户草稿与异步保护

方案必须说明：

```text
保存失败保留本地草稿
旧请求不能覆盖用户当前选择或编辑内容
API 请求失败不将当前数据替换为空列表
状态迁移失败时保留用户可解释反馈
```

### 5. 开发模式

开发 H5 可使用明确的 Local API 代理，但代理目标必须是：

```text
http://127.0.0.1:32145
```

开发服务器不得成为独立数据服务，也不得重新启用 Dexie。

## 【当前流转】

```text
数据 / API 工程师
→ S6-A 静态托管补测
→ QA 轻量复验
→ 架构师 S6-A 封板

产品经理 / 设计师 / 架构师
→ 并行完成 S6-B HTTP Client 与阻断页方案评审
→ 冻结后才允许前端实现
```

S6-C 仍完全禁止。

## 【下一责任岗】

1. **数据 / API 工程师**：仅补 S6-A 静态托管定向测试。
2. **产品经理 + 设计师 + 架构师**：可开始 S6-B 方案评审，不能写前端业务代码。

## 【是否允许写代码】

**允许 S6-A 静态托管测试补强；不允许 S6-B 或 S6-C 实现。**
