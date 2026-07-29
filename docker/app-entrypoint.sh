#!/bin/sh
set -eu

if [ "${1:-}" = "migrate" ]; then
  sed 's@mysql --protocol=socket --socket=/var/run/mysqld/mysqld.sock@mysql --protocol=tcp --host="$MYSQL_HOST" --port="${MYSQL_PORT:-3306}"@' /app/docker/reconcile-users.sh | sh
  exec node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/migrate.ts
fi

node apps/api/node_modules/tsx/dist/cli.mjs apps/api/src/main.ts &
api_pid=$!

stop_children() {
  kill -TERM "$api_pid" 2>/dev/null || true
  wait "$api_pid" 2>/dev/null || true
}

trap 'stop_children; exit 0' INT TERM

nginx -g 'daemon off;' &
nginx_pid=$!
if wait "$nginx_pid"; then
  status=0
else
  status=$?
fi
stop_children
exit "$status"
