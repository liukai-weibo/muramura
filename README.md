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

**产品和架构设计阶段，尚未开始编码。**

初期先验证核心闭环，不同时开发年、月、周计划、AI、云同步和自由画布。

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
