#!/usr/bin/env sh
# Controlled, read-only evidence capture for the Schema 004 UAT deployment gate.
set -eu
umask 077

usage() {
  printf '%s\n' 'usage: scripts/uat-schema004-readonly-snapshot.sh <knowledge_base|knowledge_base_uat> <output-directory>' >&2
  exit 2
}

[ "$#" -eq 2 ] || usage

database=$1
output_argument=$2
case "$database" in
  knowledge_base|knowledge_base_uat) ;;
  *) printf '%s\n' 'snapshot target must be knowledge_base or knowledge_base_uat' >&2; exit 2 ;;
esac
[ -n "$output_argument" ] || { printf '%s\n' 'output directory is required' >&2; exit 2; }

project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
output_directory=$(realpath -m -- "$output_argument")
case "$output_directory" in
  "$project_root"|"$project_root"/*)
    printf '%s\n' 'output directory must be outside the project worktree' >&2
    exit 2
    ;;
esac

mkdir -p -- "$output_directory"
chmod 700 -- "$output_directory"
[ -d "$output_directory" ] || { printf '%s\n' 'output directory is unavailable' >&2; exit 1; }

schema_file="$output_directory/schema.tsv"
records_file="$output_directory/records.sql"
manifest_file="$output_directory/manifest.sha256"
work_directory=$(mktemp -d "$output_directory/.snapshot.XXXXXX")
cleanup() {
  rm -rf -- "$work_directory"
}
trap cleanup EXIT HUP INT TERM

# This wrapper only receives fixed mysql/mysqldump read commands below. The
# password exists only inside the container process environment and stderr is
# intentionally suppressed so no driver or SQL detail becomes an artifact.
inside_mysql() {
  (
    cd "$project_root"
    MSYS_NO_PATHCONV=1 docker compose exec -T mysql sh -ceu '
      MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
      export MYSQL_PWD
      exec "$@"
    ' sh "$@"
  ) 2>/dev/null
}

mysql_query() {
  inside_mysql mysql --protocol=SOCKET --socket=/var/run/mysqld/mysqld.sock -uroot \
    --batch --raw --skip-column-names "$database" -e "$1"
}

table_exists() {
  mysql_query "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = '$1'" | grep -qx '1'
}

safe_query_to_file() {
  label=$1
  query=$2
  destination=$3
  if ! mysql_query "$query" >"$destination"; then
    printf '%s\n' "read-only snapshot query failed: $label" >&2
    exit 1
  fi
}

: >"$schema_file"
printf '%s\n' 'section\tfield_1\tfield_2\tfield_3\tfield_4\tfield_5\tfield_6\tfield_7\tfield_8' >>"$schema_file"
safe_query_to_file migrations "SELECT 'schema_migrations', version, name, checksum, DATE_FORMAT(applied_at, '%Y-%m-%dT%H:%i:%s.%fZ') FROM schema_migrations ORDER BY version" "$work_directory/migrations.tsv"
sed 's/^/migration\t/' "$work_directory/migrations.tsv" >>"$schema_file"
safe_query_to_file columns "SELECT 'column', table_name, column_name, column_type, is_nullable, IFNULL(column_default, 'NULL'), extra, collation_name FROM information_schema.columns WHERE table_schema = DATABASE() AND ((table_name = 'exploration_tracks') OR (table_name = 'items' AND column_name = 'exploration_track_id')) ORDER BY table_name, ordinal_position" "$work_directory/columns.tsv"
cat "$work_directory/columns.tsv" >>"$schema_file"
safe_query_to_file indexes "SELECT 'index', table_name, index_name, non_unique, seq_in_index, column_name, collation, index_type FROM information_schema.statistics WHERE table_schema = DATABASE() AND table_name IN ('exploration_tracks', 'items') ORDER BY table_name, index_name, seq_in_index" "$work_directory/indexes.tsv"
cat "$work_directory/indexes.tsv" >>"$schema_file"
safe_query_to_file foreign_key "SELECT 'foreign_key', tc.table_name, tc.constraint_name, kcu.column_name, kcu.referenced_table_name, kcu.referenced_column_name, rc.update_rule, rc.delete_rule FROM information_schema.table_constraints tc JOIN information_schema.key_column_usage kcu ON tc.constraint_schema = kcu.constraint_schema AND tc.table_name = kcu.table_name AND tc.constraint_name = kcu.constraint_name JOIN information_schema.referential_constraints rc ON tc.constraint_schema = rc.constraint_schema AND tc.constraint_name = rc.constraint_name WHERE tc.constraint_schema = DATABASE() AND tc.table_name = 'items' AND tc.constraint_name = 'items_exploration_track_fk' AND tc.constraint_type = 'FOREIGN KEY' ORDER BY kcu.ordinal_position" "$work_directory/foreign-key.tsv"
cat "$work_directory/foreign-key.tsv" >>"$schema_file"

printf '%s\n' '-- Controlled read-only database snapshot; not a restore artifact.' >"$records_file"
tables='schema_migrations exploration_tracks items reviews methods method_versions method_evidence method_applications method_tombstones item_links item_status_events system_metadata'
: >"$work_directory/table-manifest.tsv"
for table in $tables; do
  dump_file="$work_directory/$table.sql"
  if table_exists "$table"; then
    if ! inside_mysql mysqldump --protocol=SOCKET --socket=/var/run/mysqld/mysqld.sock -uroot \
      --no-create-info --skip-comments --skip-dump-date --compact --skip-extended-insert \
      --order-by-primary --single-transaction --skip-add-locks --skip-lock-tables \
      --no-tablespaces "$database" "$table" >"$dump_file"; then
      printf '%s\n' 'read-only snapshot dump failed' >&2
      exit 1
    fi
    row_count=$(mysql_query "SELECT COUNT(*) FROM \`$table\`")
    printf '%s\n' "-- table: $table" >>"$records_file"
    cat "$dump_file" >>"$records_file"
  else
    : >"$dump_file"
    row_count=0
    printf '%s\n' "-- table: $table (absent)" >>"$records_file"
  fi
  table_hash=$(sha256sum "$dump_file" | awk '{print $1}')
  printf '%s\t%s\t%s\n' "$table" "$row_count" "$table_hash" >>"$work_directory/table-manifest.tsv"
done

schema_hash=$(sha256sum "$schema_file" | awk '{print $1}')
records_hash=$(sha256sum "$records_file" | awk '{print $1}')
{
  printf 'database\t%s\n' "$database"
  printf 'schema.tsv\t%s\n' "$schema_hash"
  printf 'records.sql\t%s\n' "$records_hash"
  cat "$work_directory/table-manifest.tsv"
} >"$manifest_file"

printf '%s\n' 'read-only snapshot completed'
