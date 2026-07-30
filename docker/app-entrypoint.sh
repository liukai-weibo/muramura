#!/bin/sh
set -eu

wait_for_mysql_tcp() {
  attempt=1
  max_attempts=30

  while ! mysql --protocol=tcp --host="$MYSQL_HOST" --port="${MYSQL_PORT:-3306}" \
    --connect-timeout=2 -uroot -p"${MYSQL_ROOT_PASSWORD}" -e 'SELECT 1' >/dev/null 2>&1
  do
    if [ "$attempt" -ge "$max_attempts" ]; then
      echo "MySQL TCP connection was not ready after ${max_attempts} seconds." >&2
      return 1
    fi
    echo "Waiting for MySQL TCP connection (${attempt}/${max_attempts})..." >&2
    attempt=$((attempt + 1))
    sleep 1
  done
}

if [ "${1:-}" = "migrate" ]; then
  wait_for_mysql_tcp
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
