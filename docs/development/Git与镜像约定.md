# Git 与镜像使用约定

## 仓库

远程仓库：

```text
https://gitee.com/liukai1304/my-notebook.git
```

只有 `mikey/Knowledge_Base` 是 Git 仓库。它与 `KKK个人知识库`、`kkk自我价值`、`mikey猎人特性（2.0）`、`朱宇思维` 等个人资料目录并列，后者不属于仓库。

## 隐私检查

此仓库只保存项目代码和设计文档，不保存现有个人知识资料。未来应用产生的运行数据仍可能高度私密，严禁提交。

每次提交前检查：

```bash
git status
git diff --cached
```

严禁提交：

- `.env` 和密钥
- 数据库文件
- 导出包与恢复备份
- 日志
- `node_modules`
- 构建产物
- Docker 构建上下文中的个人运行数据

## 推荐分支

```text
main                 可运行的稳定版本
feature/功能名称      新功能
fix/问题名称          修复
```

初期不需要复杂 Git Flow。保持小分支、小提交和可运行主分支。

## 提交前检查

未来代码项目建立后，至少运行：

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build:h5
```

涉及容器时再运行：

```bash
docker build -t kkk-personal-system:local .
docker run --rm -p 8080:80 kkk-personal-system:local
```

## 镜像原则

Docker 镜像只包含 H5 静态构建产物和 Nginx 配置，不包含：

- 个人 Markdown 资料
- IndexedDB 数据
- JSON 或 ZIP 备份
- Git 凭据
- 云开发密钥

建议版本标签：

```text
kkk-personal-system:dev
kkk-personal-system:0.1.0
kkk-personal-system:latest
```

## 发布节奏

1. 本地开发和测试
2. 构建 H5
3. 本地预览正式产物
4. 构建 Docker 镜像
5. 本机容器验证
6. 打 Git 版本标签
7. 后续需要时再建立 Gitee 流水线
