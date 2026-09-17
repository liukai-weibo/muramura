#!/usr/bin/env bash
set -euo pipefail

# 前置条件：本脚本、docker-compose.yml 与私有 .env 位于同一目录。
# 固定使用已经发布的不可变镜像标签；不修改 .env，也不会输出其中的值。
readonly IMAGE_TAG='latest'
readonly REGISTRY='crpi-v8ex1zrhoe87bb3d.cn-hangzhou.personal.cr.aliyuncs.com'
readonly DATA_VOLUME='knowledge_base_mysql_data'

ci_mode='false'
case "${1:-}" in
  '') ;;
  --ci) ci_mode='true' ;;
  *) printf '用法：%s [--ci]\n' "${BASH_SOURCE[0]}" >&2; exit 2 ;;
esac

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

fail() {
  printf '错误：%s\n' "$*" >&2
  exit 1
}

command -v docker >/dev/null 2>&1 || fail '未安装 Docker。'
docker compose version >/dev/null 2>&1 || fail '未安装 Docker Compose v2。'
[ -f docker-compose.yml ] || fail '当前目录缺少 docker-compose.yml。'
[ -f .env ] || fail '当前目录缺少私有 .env。'

# 在已有数据卷上运行会沿用 Compose 的账号收敛与 Migration 行为，必须明确确认。
if docker volume inspect "$DATA_VOLUME" >/dev/null 2>&1; then
  printf '检测到既有 Docker 数据卷 %s。\n' "$DATA_VOLUME"
  printf '继续会按 docker-compose.yml 执行账号权限收敛与 Migration。\n'
  if [ "$ci_mode" = 'true' ]; then
    printf '检测到 CI 自动部署模式，使用 --ci 继续。\n'
  else
    read -r -p '确认继续请输入 DEPLOY：' confirmation
    [ "$confirmation" = 'DEPLOY' ] || fail '已取消，未进行任何部署操作。'
  fi
fi

export KB_APP_IMAGE_TAG="$IMAGE_TAG"

printf '校验 Compose 与私有环境配置...\n'
docker compose --env-file .env config --quiet

printf '拉取 %s...\n' "$IMAGE_TAG"
if ! docker compose --env-file .env pull; then
  printf '拉取失败。请先执行：docker login %s\n' "$REGISTRY" >&2
  exit 1
fi

printf '启动服务...\n'
docker compose --env-file .env up -d

migrate_id="$(docker compose --env-file .env ps --all -q migrate)"
[ -n "$migrate_id" ] || fail '未找到 migrate 容器。'
migrate_exit="$(docker inspect --format '{{.State.ExitCode}}' "$migrate_id")"
if [ "$migrate_exit" != '0' ]; then
  docker compose --env-file .env logs --tail=120 migrate >&2 || true
  fail "Migration 失败，退出码：$migrate_exit。"
fi

h5_port="$(awk -F= '$1 == "KB_H5_HOST_PORT" { value=$2 } END { print value }' .env | tr -d '\r')"
h5_port="${h5_port:-10086}"

printf '检查 H5 /health...\n'
health_ok='false'
for attempt in $(seq 1 30); do
  if curl --fail --silent --show-error "http://127.0.0.1:${h5_port}/health" >/dev/null; then
    health_ok='true'
    break
  fi
  printf 'H5 /health 尚未就绪（%s/30），1 秒后重试...\n' "$attempt" >&2
  sleep 1
done
if [ "$health_ok" != 'true' ]; then
  printf 'H5 /health 检查失败，输出 app 日志：\n' >&2
  docker compose --env-file .env logs --tail=120 app >&2 || true
  fail 'H5 /health 检查失败，请根据 app 日志排查 API 启动状态。'
fi

printf '\n启动完成：镜像标签 %s。\n' "$IMAGE_TAG"
printf '本机测试入口：http://127.0.0.1:%s\n' "$h5_port"
printf '远程查看请使用 SSH 隧道：ssh -L %s:127.0.0.1:%s root@<服务器IP>\n' "$h5_port" "$h5_port"
printf '首次注册的网页用户仅有 member；管理员必须另行受控授予。\n'
