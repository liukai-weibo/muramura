#!/usr/bin/env bash
set -euo pipefail

# 备份 knowledge_base 数据库与 AI 密钥卷。
# 前置条件：本脚本与 docker-compose.yml、私有 .env 位于同一目录，且服务已启动。
#
# 用法：
#   ./backup-db.sh                仅备份
#   ./backup-db.sh --verify       额外恢复到临时库校验（需要额外磁盘空间，用完自动删除）
#   ./backup-db.sh --keep 14      保留最近 14 份，默认 7
#
# 安全说明：数据库口令取自 mysql 容器自身的环境变量，不会出现在宿主机命令行、
# 进程列表或日志中；备份产物含真实业务数据与凭据，切勿提交到 Git 或公开传播。

readonly PRIMARY_DB='knowledge_base'
readonly UAT_DB='knowledge_base_uat'
readonly AI_VOLUME='knowledge_base_ai_secrets'
readonly AI_MOUNT_PATH='/var/lib/knowledge-base/secrets'

verify_mode='false'
keep_count='7'

usage() {
  printf '用法：%s [--verify] [--keep N]\n' "${BASH_SOURCE[0]}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --verify) verify_mode='true'; shift ;;
    --keep)
      [ $# -ge 2 ] || { printf '错误：--keep 需要参数。\n' >&2; usage >&2; exit 2; }
      keep_count="$2"; shift 2
      ;;
    -h|--help) usage; exit 0 ;;
    *) printf '错误：未知参数 %s\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

case "$keep_count" in
  ''|*[!0-9]*) printf '错误：--keep 必须是非负整数。\n' >&2; exit 2 ;;
esac

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
cd "$script_dir"

fail() {
  printf '错误：%s\n' "$*" >&2
  # 清理校验用的临时文件，避免失败时在备份目录留下半成品。
  rm -f "${table_sums_file:-}" "${table_sums_verify_file:-}" 2>/dev/null || true
  exit 1
}

warn() {
  printf '警告：%s\n' "$*" >&2
}

command -v docker >/dev/null 2>&1 || fail '未安装 Docker。'
docker compose version >/dev/null 2>&1 || fail '未安装 Docker Compose v2。'
[ -f docker-compose.yml ] || fail '当前目录缺少 docker-compose.yml。'
[ -f .env ] || fail '当前目录缺少私有 .env。'

mysql_id="$(docker compose --env-file .env ps -q mysql 2>/dev/null || true)"
[ -n "$mysql_id" ] || fail '未找到运行中的 mysql 容器，请先执行 ./start.sh 启动服务。'

# 在容器内执行 SQL：口令来自容器自身环境，查询语句作为参数传入。
mysql_query() {
  docker exec "$mysql_id" sh -c \
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot -N -B --default-character-set=utf8mb4 -e "$1"' \
    sh "$1"
}

# 判断数据库是否存在。
db_exists() {
  local found
  found="$(mysql_query "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME='$1'")"
  [ -n "$found" ]
}

# 精确统计库内所有基础表的行数总和。
# 用 information_schema 动态拼出求和形式的 COUNT(*)，
# 避免依赖 InnoDB 近似值 TABLE_ROWS（该值不准确，不能作为备份证据）。
# 表名必须带上库名前缀：mysql_query 未指定默认库，裸表名会以
# "No database selected" 失败并返回空值，从而把行数误判为 0。
count_all_rows() {
  local db="$1" generator total
  generator="$(mysql_query "SET SESSION group_concat_max_len=1048576; SELECT CONCAT('SELECT ', GROUP_CONCAT(CONCAT('(SELECT COUNT(*) FROM \`$db\`.\`', TABLE_NAME, '\`)') SEPARATOR '+'), ' AS total') FROM information_schema.TABLES WHERE TABLE_SCHEMA='$db' AND TABLE_TYPE='BASE TABLE'")"
  if [ -z "$generator" ]; then
    fail "无法生成 $db 的行数统计语句，备份校验不可信。"
  fi
  total="$(mysql_query "$generator")"
  case "$total" in
    ''|*[!0-9]*) fail "统计 $db 行数失败（返回值：${total:-空}），备份校验不可信。" ;;
  esac
  printf '%s' "$total"
}

# 统计导出文件中的 INSERT 语句条数，作为“数据确实写入备份”的直接证据。
count_dump_inserts() {
  local n
  n="$(gzip -dc "$1" | grep -c '^INSERT INTO' || true)"
  printf '%s' "${n:-0}"
}

# 导出单个数据库。
# 不使用 --databases，因此导出内容不含 CREATE DATABASE / USE 语句，
# 恢复时必须显式指定目标库，避免误写入生产库。
dump_db() {
  local db="$1" out="$2"
  printf '导出 %s ...\n' "$db"
  if ! docker exec "$mysql_id" sh -c \
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysqldump -uroot \
        --single-transaction --routines --triggers --events \
        --default-character-set=utf8mb4 "$1"' \
      sh "$db" 2>"${out}.err" | gzip -9 >"$out"; then
    printf 'mysqldump 失败，错误输出：\n' >&2
    cat "${out}.err" >&2 || true
    rm -f "$out" "${out}.err"
    fail "导出 $db 失败。"
  fi
  rm -f "${out}.err"

  [ -s "$out" ] || fail "$db 导出结果为空文件。"
  gzip -t "$out" 2>/dev/null || fail "$db 导出文件 gzip 校验失败。"
}

backup_dir="$script_dir/backups"
mkdir -p "$backup_dir"
chmod 700 "$backup_dir"

stamp="$(date +%Y%m%d_%H%M%S)"
printf '备份目录：%s\n' "$backup_dir"
printf '宿主机磁盘余量：\n'
df -h "$backup_dir" || true
printf '\n'

# ---- 1. 主业务库 ----
primary_dump="$backup_dir/${PRIMARY_DB}_${stamp}.sql.gz"
dump_db "$PRIMARY_DB" "$primary_dump"

primary_bytes="$(stat -c '%s' "$primary_dump" 2>/dev/null || echo 0)"
primary_tables="$(mysql_query "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$PRIMARY_DB' AND TABLE_TYPE='BASE TABLE'")"
primary_create="$(gzip -dc "$primary_dump" | grep -c 'CREATE TABLE' || true)"
primary_schema="$(mysql_query "SELECT COALESCE(MAX(version), 0) FROM \`$PRIMARY_DB\`.schema_migrations" 2>/dev/null || echo 'unknown')"
primary_rows="$(count_all_rows "$PRIMARY_DB")"
primary_inserts="$(count_dump_inserts "$primary_dump")"

printf '  %s：表数 %s，Schema 版本 %s，总行数 %s，导出 INSERT 数 %s，压缩后 %s 字节\n' \
  "$PRIMARY_DB" "$primary_tables" "$primary_schema" "$primary_rows" "$primary_inserts" "$primary_bytes"

if [ "$primary_create" -lt 1 ]; then
  fail '导出内容中未发现任何建表语句，备份不可信。'
fi

# 仅当源库确实有数据却导出不到 INSERT 时才算异常，避免把空库误判为失败。
if [ "$primary_rows" -gt 0 ] && [ "$primary_inserts" -lt 1 ]; then
  fail "源库有 $primary_rows 行数据，但导出文件中没有任何 INSERT 语句，备份不可信。"
fi

# 记录主库表结构校验和，用于恢复后逐表比对。
table_sums_file="$backup_dir/.tablesums_$stamp"
mysql_query "SELECT TABLE_NAME, COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$PRIMARY_DB' GROUP BY TABLE_NAME ORDER BY TABLE_NAME" >"$table_sums_file"

# ---- 2. UAT 库（存在才导出）----
uat_dump=''
if db_exists "$UAT_DB"; then
  uat_dump="$backup_dir/${UAT_DB}_${stamp}.sql.gz"
  dump_db "$UAT_DB" "$uat_dump"
  uat_create="$(gzip -dc "$uat_dump" | grep -c 'CREATE TABLE' || true)"
  printf '  %s：导出 CREATE TABLE 数 %s\n' "$UAT_DB" "$uat_create"
else
  printf '  跳过 %s（该库不存在）\n' "$UAT_DB"
fi

# ---- 3. AI 密钥卷 ----
ai_archive=''
# 该命令在缺少 app 服务时会以非零码退出，用 || true 兜底以免 set -e 中断整个备份。
app_id="$(docker compose --env-file .env ps -q app 2>/dev/null || true)"
if [ -n "$app_id" ]; then
  ai_archive="$backup_dir/ai_secrets_${stamp}.tar.gz"
  staging="$backup_dir/.ai_staging_$stamp"
  if mkdir -p "$staging" \
    && docker cp "$app_id:${AI_MOUNT_PATH}/." "$staging/" 2>/dev/null; then
    if tar czf "$ai_archive" -C "$staging" . 2>/dev/null; then
      printf '  %s：已导出\n' "$AI_VOLUME"
    else
      warn "$AI_VOLUME 打包失败，已跳过。"
      ai_archive=''
    fi
  else
    warn "无法从 app 容器读取 $AI_VOLUME（可能为空），已跳过。"
    ai_archive=''
  fi
  rm -rf "$staging"
else
  warn 'app 容器未运行，跳过 AI 密钥卷备份。'
fi

# ---- 4. 校验和与元数据 ----
files=("$primary_dump")
[ -n "$uat_dump" ] && files+=("$uat_dump")
[ -n "$ai_archive" ] && files+=("$ai_archive")

printf '\n生成校验和...\n'
for f in "${files[@]}"; do
  sha256sum "$f" >"${f}.sha256"
  printf '  %s  %s\n' "$(cut -d' ' -f1 <"${f}.sha256")" "$(basename "$f")"
done

meta="$backup_dir/backup_${stamp}.meta"
{
  printf '备份时间: %s\n' "$(date -Is)"
  printf '主机: %s\n' "$(hostname)"
  printf '数据库: %s\n' "$PRIMARY_DB"
  printf 'Schema版本: %s\n' "$primary_schema"
  printf '容器内表数: %s\n' "$primary_tables"
  printf '导出建表数: %s\n' "$primary_create"
  printf '压缩字节: %s\n' "$primary_bytes"
  printf '镜像标签: %s\n' "$(docker inspect --format '{{.Config.Image}}' "$mysql_id")"
} >"$meta"
printf '元数据: %s\n' "$(basename "$meta")"

# ---- 5. 可选：恢复到临时库校验 ----
if [ "$verify_mode" = 'true' ]; then
  verify_db="kb_verify_${stamp}"
  printf '\n恢复到临时库 %s 进行校验...\n' "$verify_db"
  printf '提示：该步骤会临时占用约等于数据量的额外磁盘空间。\n'
  mysql_query "DROP DATABASE IF EXISTS \`$verify_db\`"
  mysql_query "CREATE DATABASE \`$verify_db\` CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci"

  cleanup_verify() {
    mysql_query "DROP DATABASE IF EXISTS \`$verify_db\`" >/dev/null 2>&1 || true
  }
  trap cleanup_verify EXIT

  if ! gzip -dc "$primary_dump" | docker exec -i "$mysql_id" sh -c \
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" mysql -uroot --default-character-set=utf8mb4 "$1"' \
      sh "$verify_db"; then
    fail '恢复校验失败，导出文件可能不可用。'
  fi

  verify_tables="$(mysql_query "SELECT COUNT(*) FROM information_schema.TABLES WHERE TABLE_SCHEMA='$verify_db' AND TABLE_TYPE='BASE TABLE'")"
  verify_schema="$(mysql_query "SELECT COALESCE(MAX(version), 0) FROM \`$verify_db\`.schema_migrations" 2>/dev/null || echo 'unknown')"
  verify_rows="$(count_all_rows "$verify_db")"
  printf '  恢复后表数 %s（源 %s），Schema 版本 %s（源 %s），总行数 %s（源 %s）\n' \
    "$verify_tables" "$primary_tables" "$verify_schema" "$primary_schema" "$verify_rows" "$primary_rows"

  [ "$verify_tables" = "$primary_tables" ] || fail '恢复校验表数不一致，备份不可信。'
  [ "$verify_schema" = "$primary_schema" ] || fail '恢复校验 Schema 版本不一致，备份不可信。'
  [ "$verify_rows" = "$primary_rows" ] || fail "恢复校验行数不一致（源 $primary_rows，恢复 $verify_rows），备份不可信。"

  # 逐表比对列数，防止表结构在导出中丢失。
  table_sums_verify_file="$backup_dir/.tablesums_verify_$stamp"
  mysql_query "SELECT TABLE_NAME, COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='$verify_db' GROUP BY TABLE_NAME ORDER BY TABLE_NAME" >"$table_sums_verify_file"
  if ! diff -q "$table_sums_file" "$table_sums_verify_file" >/dev/null 2>&1; then
    printf '表结构差异（源 vs 恢复）：\n' >&2
    diff "$table_sums_file" "$table_sums_verify_file" >&2 || true
    fail '恢复校验表结构不一致，备份不可信。'
  fi
  rm -f "$table_sums_verify_file"
  table_sums_verify_file=''
  printf '  表结构逐表比对一致（%s 张表）。\n' "$verify_tables"

  cleanup_verify
  trap - EXIT
  printf '恢复校验通过，临时库已删除。\n'
fi

# ---- 6. 保留最近 N 份 ----
if [ "$keep_count" -gt 0 ]; then
  printf '\n清理历史备份，保留最近 %s 份...\n' "$keep_count"
  mapfile -t old_dumps < <(
    find "$backup_dir" -maxdepth 1 -type f -name "${PRIMARY_DB}_*.sql.gz" -printf '%T@ %p\n' 2>/dev/null \
      | sort -rn | awk 'NR>'"$keep_count"' {print $2}'
  )
  for old in "${old_dumps[@]:-}"; do
    [ -n "$old" ] || continue
    old_stamp="$(basename "$old" | sed -E "s/^${PRIMARY_DB}_//; s/\.sql\.gz$//")"
    rm -f "$old" "${old}.sha256" \
          "$backup_dir/${UAT_DB}_${old_stamp}.sql.gz" "$backup_dir/${UAT_DB}_${old_stamp}.sql.gz.sha256" \
          "$backup_dir/ai_secrets_${old_stamp}.tar.gz" "$backup_dir/ai_secrets_${old_stamp}.tar.gz.sha256" \
          "$backup_dir/backup_${old_stamp}.meta"
    printf '  已删除 %s\n' "$old_stamp"
  done
fi

# ---- 7. 汇总 ----
rm -f "$table_sums_file"
table_sums_file=''

printf '\n备份完成。\n'
for f in "${files[@]}"; do
  printf '  %s  (%s)\n' "$(basename "$f")" "$(du -h "$f" | cut -f1)"
done
printf '\n下一步：把备份下载到本地妥善保存。在本地机器执行（注意用绝对路径）：\n'
printf '  scp root@<服务器IP>:%s/*%s* ./kb-backup-%s/\n' "$backup_dir" "$stamp" "$stamp"
printf '下载后核对校验和：sha256sum -c *.sha256\n'
printf '\n注意：备份含全部业务数据，切勿提交到 Git 或通过公开渠道传输。\n'
