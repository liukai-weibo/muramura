#!/usr/bin/env sh
set -eu

if [ ! -f .env.uat ]; then
  echo '缺少 .env.uat。请先复制 .env.uat.example 并填写本机 UAT MySQL 凭据。' >&2
  exit 1
fi

set -a
. ./.env.uat
set +a

corepack pnpm --filter @knowledge-base/api migrate
exec corepack pnpm --filter @knowledge-base/api start
