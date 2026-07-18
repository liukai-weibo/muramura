# Knowledge Base

KKK 个人系统可视化项目。

## 项目目标

将下面这条个人运行闭环做成可视化、可长期使用、可完整导出和恢复的应用：

```text
想法 → 执行 → 复盘 → 当前有效的方法 → 新想法
```

## 当前技术路线

```text
Taro + React + TypeScript
├── 第一阶段：H5 / Web 本地运行
├── 第二阶段：Docker 镜像部署 H5
└── 后续阶段：微信小程序 + CloudBase
```

第一阶段使用 IndexedDB 保存本地数据，并支持 Markdown + JSON + ZIP 导出恢复。

## 当前阶段

**Sprint 2 复盘与方法沉淀已完成。**

当前已具备 Taro H5 客户端、共享领域与应用用例包、IndexedDB Repository、自动化测试、H5 正式构建和 Docker/Nginx 部署配置。用户可以捕获想法、推动执行、完成结构化复盘，并从现实证据中提炼“当前有效的方法”。下一阶段将实现方法产生新想法与完整流转时间线。

## 开发与验证

### 环境要求

- Node.js 22
- Corepack
- Docker（仅镜像构建与容器运行需要）

### 安装依赖

```bash
corepack pnpm install
```

### 本地开发

```bash
corepack pnpm dev:h5
```

开发服务默认监听 `http://localhost:10086`。

### 类型检查与测试

```bash
corepack pnpm typecheck
corepack pnpm test
```

### H5 正式构建

```bash
corepack pnpm build:h5
```

构建产物位于 `apps/client/dist`。

### Docker 构建与运行

```bash
docker build -t kkk-personal-system:local .
docker run --rm -d --name kkk-personal-system-test -p 8080:80 kkk-personal-system:local
```

打开 `http://localhost:8080` 验证应用。停止测试容器：

```bash
docker stop kkk-personal-system-test
```

也可以使用 Compose：

```bash
docker compose up -d --build
docker compose down
```

## 文档入口

1. [`docs/product/功能清单-v1.md`](<docs/product/功能清单-v1.md>)：经过补充和分层的功能清单
2. [`docs/architecture/整体架构设计-v2.md`](<docs/architecture/整体架构设计-v2.md>)：当前有效技术架构
3. [`docs/development/开发流程-v1.md`](<docs/development/开发流程-v1.md>)：整体开发顺序
4. [`docs/development/Git与镜像约定.md`](<docs/development/Git与镜像约定.md>)：Git、隐私和 Docker 约定
5. [`docs/archive/整体架构设计-v1-已废弃.md`](<docs/archive/整体架构设计-v1-已废弃.md>)：早期 Next.js + SQLite 草案，仅保留决策历史

## MVP 完整演示

```text
新建想法
→ 开始执行
→ 执行结束
→ 进入待复盘
→ 完成复盘
→ 形成做事方法
→ 产生新想法
→ 查看完整时间线
→ 导出 Markdown + JSON
→ 从备份完整恢复
```

## 仓库边界

该仓库只保存：

- 项目代码
- 项目设计与开发文档
- 测试代码
- Docker 和构建配置

该仓库不保存：

- `KKK个人知识库`
- `kkk自我价值`
- `mikey猎人特性（2.0）`
- `朱宇思维`
- 运行数据、个人导出文件和密钥
