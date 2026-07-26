#!/usr/bin/env sh
set -eu

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
case "$project_root" in
  */Knowledge_Base) ;;
  *) echo '拒绝清理：脚本必须位于 Knowledge_Base/scripts。' >&2; exit 1 ;;
esac
cd "$project_root"

if [ ! -f .env.uat ] || [ ! -f .env ]; then
  echo '必须在包含 .env.uat 与 .env 的 Knowledge_Base 目录执行。' >&2
  exit 1
fi

set -a
. ./.env.uat
set +a

if [ "${MYSQL_HOST:-}" != '127.0.0.1' ] || [ "${MYSQL_PORT:-}" != '3306' ] || [ "${MYSQL_DATABASE:-}" != 'knowledge_base_uat' ]; then
  echo '拒绝清理：.env.uat 必须固定为 127.0.0.1:3306 / knowledge_base_uat。' >&2
  exit 1
fi

health=$(curl --fail --silent --show-error http://127.0.0.1:32146/health)
case "$health" in
  *'"database":"knowledge_base_uat"'*'"schemaVersion":4'*) ;;
  *) echo '拒绝清理：API /health 未确认 knowledge_base_uat 与 schemaVersion 4。' >&2; exit 1 ;;
esac

empty_backup='{"format":"knowledge-base-backup","version":3,"exportedAt":"2026-07-26T00:00:00.000Z","appVersion":"uat-reset","data":{"items":[],"reviews":[],"methods":[],"methodEvidence":[],"methodVersions":[],"methodApplications":[],"itemStatusEvents":[],"itemLinks":[],"methodTombstones":[],"explorationTracks":[]}}'
curl --fail --silent --show-error -X POST http://127.0.0.1:32146/api/v1/backup/restore -H 'content-type: application/json' --data "$empty_backup" >/dev/null

echo 'UAT 十个业务集合已通过 Backup V3 合法空文档恢复清空；system_metadata、schema_migrations、日常 knowledge_base 与 mysql-data 未被操作。'
