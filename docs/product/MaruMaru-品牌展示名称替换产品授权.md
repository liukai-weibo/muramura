# MaruMaru 品牌展示名称替换产品授权

日期：2026-07-29

## 结论

授权实施用户可见品牌替换：英文名称为 `MaruMaru`，中文名称为“圈圈”。这是一项纯展示与文档命名调整，不改变任何业务能力或运行身份。

## 授权范围

- H5 浏览器标题、导航标题及页面内现有产品名称文案。
- `README.md` 中的项目展示标题与产品介绍。
- 直接视觉或文案回归测试、必要 QA / 产品记录及当天贡献记录。

## 必须保持

- 所有内部技术标识继续使用既有值：`knowledge-base`、`@knowledge-base/*`、`knowledge_base`、`knowledge_base_uat`、Docker Compose 项目/volume 名称、镜像仓库路径与端口。
- 不修改 API、DTO、Application、Repository、Contracts、Migration、Backup、数据库、配置实值、Docker、启动脚本、路由、状态机或业务语义。

## 验收标准

- 用户可见的产品标题统一为 `MaruMaru` 或“圈圈”，不再出现旧产品展示名称。
- 日常与 Docker 启动方式、health 返回、数据库与镜像引用保持不变。
- 完成直接回归、`typecheck`、`build:h5` 与 `git diff --check` 后转 QA。
