# Docker migrate 首次启动等待修复产品授权

日期：2026-07-29

## 结论

授权修复新 Docker 宿主机首次执行 `docker compose up -d` 时，`migrate` 容器可能早于 MySQL 经 Docker 网络完全可连接而退出的部署可靠性问题。

## 授权范围

- `docker/app-entrypoint.sh`
- 直接脚本测试、必要 QA / 产品记录及当天贡献记录

## 冻结规则

- 仅在 `migrate` 启动路径中，以既有 `MYSQL_HOST`、`MYSQL_PORT`、root 连接信息轮询 MySQL TCP 查询就绪状态。
- 每次等待间隔固定 1 秒，最多等待 30 秒；成功后执行既有账号收敛与既有 migration，超时以明确错误退出。
- 不修改 `docker-compose.yml`、Dockerfile、MySQL 镜像、migration 内容、账号权限语义、数据库、备份、API、H5 或业务代码。
- 不自动重建、删除或清空 volume；不改变 app 依赖 migrate 成功完成的既有边界。

## 验收标准

- 空 named volume 的首次 `docker compose up -d` 不再因短暂的 MySQL TCP 未就绪而要求人工重跑 migrate。
- MySQL 始终不可用时，在 30 秒内明确失败，不进入账号收敛或 migration。
- 既有成功路径、health 与数据卷保留语义不变。
