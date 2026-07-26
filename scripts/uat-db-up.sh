#!/usr/bin/env sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
cd "$project_root"

if [ ! -f .env.uat ] || [ ! -f .env ]; then
  echo '缺少 .env 或 .env.uat。' >&2
  exit 1
fi

# 先校验 UAT API 的单一运行目标；管理凭据仅来自 .env。
set -a
. ./.env.uat
set +a

if [ "${MYSQL_HOST:-}" != '127.0.0.1' ] || [ "${MYSQL_PORT:-}" != '3306' ] || [ "${MYSQL_DATABASE:-}" != 'knowledge_base_uat' ]; then
  echo '拒绝启动：.env.uat 必须固定为 127.0.0.1:3306 / knowledge_base_uat。' >&2
  exit 1
fi

# Compose 管理凭据仅来自 .env。
set -a
. ./.env
set +a
if [ -z "${MYSQL_ROOT_PASSWORD:-}" ]; then
  echo '.env 必须提供 MySQL root 密码。' >&2
  exit 1
fi
docker compose --env-file .env up -d --wait mysql
docker compose --env-file .env exec -T mysql sh -c 'exec //usr/local/bin/reconcile-mysql-users'

# Migration 必须显式恢复 UAT 的单一 MYSQL_* 目标库。
set -a
. ./.env.uat
set +a
corepack pnpm --filter @knowledge-base/api migrate
