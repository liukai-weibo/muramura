# 云服务器部署

本目录保存云服务器自动部署所需的脚本与环境配置模板。GitHub Actions 工作流
`.github/workflows/docker-image.yml` 在镜像构建推送成功后，通过 SSH 登录服务器执行
`./start.sh --ci` 完成滚动更新。

## 服务器目录布局

`start.sh` 通过 `BASH_SOURCE` 推断自身所在目录，因此不依赖固定绝对路径，
但以下三个文件**必须位于同一目录**：

```text
/root/
├── start.sh            # 由本仓库 deploy/start.sh 同步
├── docker-compose.yml  # 由本仓库根目录同步
└── .env                # 私有配置，仅存在于服务器，不进入 Git
```

## 首次部署到新服务器

1. 安装 Docker 与 Docker Compose v2。

2. 放置文件：

   ```bash
   cp deploy/start.sh /root/start.sh
   chmod +x /root/start.sh
   cp docker-compose.yml /root/docker-compose.yml
   cp deploy/.env.example /root/.env   # 然后填入真实值
   ```

3. 登录镜像仓库（**该步骤不在 CI 流程内，遗漏会导致 pull 失败**）：

   ```bash
   docker login crpi-v8ex1zrhoe87bb3d.cn-hangzhou.personal.cr.aliyuncs.com
   ```

4. 首次启动**手动执行**，不要加 `--ci`，以便在检测到既有数据卷时获得确认提示：

   ```bash
   cd /root && ./start.sh
   ```

5. 确认无误后，在 GitHub 仓库 `Settings → Secrets and variables → Actions` 配置：

   | Secret | 说明 |
   | --- | --- |
   | `DEPLOY_HOST` | 云服务器地址 |
   | `DEPLOY_USER` | SSH 用户名 |
   | `DEPLOY_PASSWORD` | SSH 密码 |
   | `DEPLOY_PORT` | SSH 端口，不填时使用 `22` |

## 迁移旧服务器数据

必须备份以下内容。前三项**只存在于服务器**，Git 中没有任何副本：

| 内容 | 位置 | 说明 |
| --- | --- | --- |
| `start.sh` | `/root/start.sh` | 本仓库已纳管，可重新同步 |
| `.env` | `/root/.env` | **最重要**，无 Git 副本，丢失需重填全部凭据 |
| `docker-compose.yml` | `/root/docker-compose.yml` | 与仓库版本一致，可重新同步 |
| MySQL 数据卷 | `knowledge_base_mysql_data` | 全部业务数据 |
| AI 密钥卷 | `knowledge_base_ai_secrets` | `ai-config.json`，AI 配置 |
| 宿主 nginx / 证书 | 视接入方式 | 若单独配置过 HTTPS |
| `crontab -l` / systemd | 若有 | 定时任务与自启服务 |

数据卷打包（整机迁移用）：

```bash
cd /root
docker compose stop            # 严禁使用 down -v，会删除数据卷
docker run --rm \
  -v knowledge_base_mysql_data:/data \
  -v knowledge_base_ai_secrets:/secrets \
  -v /root/backup:/backup \
  alpine tar czf /backup/volumes.tar.gz -C / data secrets
docker compose start
```

逻辑备份（可与上面互为补充）：

```bash
set -a; . /root/.env; set +a
docker exec knowledge-base-mysql-1 \
  mysqldump -uroot -p"$MYSQL_ROOT_PASSWORD" \
  --single-transaction --routines --triggers --events knowledge_base \
  | gzip > /root/backup/knowledge_base.sql.gz
```

> 备份产物包含明文凭据，**不得进入 Git，也不得通过公开渠道传输**。

恢复后必须通过 `/health` 确认实际数据库与 Schema 版本，再进行流量切换。

## 脚本行为说明

- `IMAGE_TAG` 硬编码为 `latest`，并 `export` 覆盖 `.env` 中的同名值。
  因此 `start.sh` 始终部署 `latest`；回滚版本需修改该常量，而非改 `.env`。
- 检测到既有 `knowledge_base_mysql_data` 卷时，交互模式要求输入 `DEPLOY` 确认；
  `--ci` 模式跳过该确认，供 CI 使用。
- 启动后轮询 `http://127.0.0.1:${KB_H5_HOST_PORT}/health`，最多 30 次；
  失败时输出 `app` 容器日志并以非零码退出。
- migrate 容器退出码非 0 时输出其日志并终止部署。

## 注意事项

- 停止服务只允许 `docker compose stop`，**严禁 `docker compose down -v`**。
- `.env` 必须保持 `KEY=value` 格式：`start.sh` 用 `awk -F=` 解析
  `KB_H5_HOST_PORT`，键名与等号之间不能有空格，值不能加引号。
- 三类入口默认仅绑定 `127.0.0.1`，公网访问需另行经 SSH 隧道或反向代理暴露。
