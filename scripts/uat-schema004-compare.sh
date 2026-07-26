#!/usr/bin/env sh
# Fixed, offline comparison profile for the one-time Schema 004 v3 -> v4 UAT deployment.
set -eu
umask 077

usage() {
  printf '%s\n' 'usage: scripts/uat-schema004-compare.sh <pre-snapshot-directory> <post-snapshot-directory> <output-directory>' >&2
  exit 2
}

[ "$#" -eq 3 ] || usage
pre_directory=$(realpath -m -- "$1")
post_directory=$(realpath -m -- "$2")
output_argument=$3
[ -n "$output_argument" ] || { printf '%s\n' 'output directory is required' >&2; exit 2; }
project_root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
output_directory=$(realpath -m -- "$output_argument")
for directory in "$pre_directory" "$post_directory" "$output_directory"; do
  case "$directory" in
    "$project_root"|"$project_root"/*)
      printf '%s\n' 'snapshot and output directories must be outside the project worktree' >&2
      exit 2
      ;;
  esac
done
for file in "$pre_directory/schema.tsv" "$pre_directory/records.sql" "$pre_directory/manifest.sha256" "$post_directory/schema.tsv" "$post_directory/records.sql" "$post_directory/manifest.sha256"; do
  [ -f "$file" ] || { printf '%s\n' 'required snapshot artifact is unavailable' >&2; exit 2; }
done
mkdir -p -- "$output_directory"
chmod 700 -- "$output_directory"

comparison_file="$output_directory/comparison-manifest.tsv"
difference_file="$output_directory/items-legacy-projection-differences.tsv"

set +e
node - "$pre_directory/schema.tsv" "$pre_directory/records.sql" "$pre_directory/manifest.sha256" "$post_directory/schema.tsv" "$post_directory/records.sql" "$post_directory/manifest.sha256" "$comparison_file" "$difference_file" <<'NODE'
const fs = require('node:fs')
const [preSchemaPath, preRecordsPath, preManifestPath, postSchemaPath, postRecordsPath, postManifestPath, comparisonPath, differencePath] = process.argv.slice(2)
const expectedChecksum = '6703b3ec3a0125b867a4077d4eab350bf6df8dfe75a9f061660344696a9f8a9f'
const legacyColumns = ['id', 'title', 'content', 'status', 'start_action', 'created_at', 'updated_at', 'deleted_at']
const stableTables = ['reviews', 'methods', 'method_versions', 'method_evidence', 'method_applications', 'method_tombstones', 'item_links', 'item_status_events', 'system_metadata']
const itemPrefix = 'INSERT INTO `items` VALUES ('

function fixedFailure(reason) {
  fs.writeFileSync(comparisonPath, [
    'profileEligibility\tschema-004-v3-to-v4-uat',
    'profileEligibilityResult\tFAIL',
    `profileEligibilityFailure\t${reason}`,
    'comparisonResult\tNOT_RUN',
  ].join('\n') + '\n')
  fs.writeFileSync(differencePath, 'item_id\tfield\tresult\n')
  console.error('schema-004 profile eligibility failed')
  process.exit(1)
}
function parseManifest(content) {
  const values = new Map()
  for (const line of content.trim().split(/\r?\n/)) {
    const [key, ...rest] = line.split('\t')
    values.set(key, rest)
  }
  return values
}
function parseSchema(content) {
  const records = content.split(/\r?\n/).filter(Boolean).map(line => line.split('\t'))
  const migrations = records.filter(row => row[0] === 'migration').map(row => ({ version: row[2], name: row[3], checksum: row[4] }))
  const columns = records.filter(row => row[0] === 'column')
  const indexes = records.filter(row => row[0] === 'index')
  const foreignKeys = records.filter(row => row[0] === 'foreign_key')
  return { migrations, columns, indexes, foreignKeys }
}
function exactVersions(schema, versions) {
  return schema.migrations.map(record => record.version).join(',') === versions.join(',')
}
function hasColumn(schema, table, column, type, nullable) {
  return schema.columns.some(row => row[1] === table && row[2] === column && row[3] === type && row[4] === nullable)
}
function exactColumns(schema, table, expected) {
  const rows = schema.columns.filter(row => row[1] === table)
  return rows.length === expected.length
    && expected.every(([column, type, nullable]) => rows.filter(row => row[2] === column && row[3] === type && row[4] === nullable).length === 1)
}
function hasIndex(schema, table, name, unique, columns) {
  const rows = schema.indexes.filter(row => row[1] === table && row[2] === name)
  return rows.length === columns.length && rows.every((row, index) => row[3] === unique && row[4] === String(index + 1) && row[5] === columns[index])
}
function hasForeignKey(schema) {
  return schema.foreignKeys.some(row => row[1] === 'items' && row[2] === 'items_exploration_track_fk' && row[3] === 'exploration_track_id' && row[4] === 'exploration_tracks' && row[5] === 'id')
}
function hasAny004Object(schema) {
  return schema.columns.some(row => row[1] === 'exploration_tracks' || (row[1] === 'items' && row[2] === 'exploration_track_id'))
    || schema.indexes.some(row => ['exploration_tracks_normalized_name_unique', 'exploration_tracks_active_updated_idx', 'items_exploration_track_created_idx'].includes(row[2]))
    || schema.foreignKeys.some(row => row[2] === 'items_exploration_track_fk')
}
function postSchemaMatches(schema) {
  const requiredTrackColumns = [
    ['id', 'varchar(128)', 'NO'], ['name', 'varchar(80)', 'NO'], ['normalized_name', 'varchar(80)', 'NO'],
    ['created_at', 'datetime(3)', 'NO'], ['updated_at', 'datetime(3)', 'NO'], ['deleted_at', 'datetime(3)', 'YES'],
  ]
  return exactColumns(schema, 'exploration_tracks', requiredTrackColumns)
    && hasIndex(schema, 'exploration_tracks', 'PRIMARY', '0', ['id'])
    && hasColumn(schema, 'items', 'exploration_track_id', 'varchar(128)', 'YES')
    && hasIndex(schema, 'exploration_tracks', 'exploration_tracks_normalized_name_unique', '0', ['normalized_name'])
    && hasIndex(schema, 'exploration_tracks', 'exploration_tracks_active_updated_idx', '1', ['deleted_at', 'updated_at'])
    && hasIndex(schema, 'items', 'items_exploration_track_created_idx', '1', ['exploration_track_id', 'created_at'])
    && hasForeignKey(schema)
}
function itemRows(content) {
  return content.split(/\r?\n/).filter(line => line.startsWith(itemPrefix)).map(line => {
    const values = line.slice(itemPrefix.length, -2)
    const result = []
    let start = 0; let quoted = false; let escaped = false
    for (let index = 0; index < values.length; index += 1) {
      const character = values[index]
      if (quoted) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === "'") quoted = false
      } else if (character === "'") quoted = true
      else if (character === ',') { result.push(values.slice(start, index)); start = index + 1 }
    }
    result.push(values.slice(start))
    return result
  })
}
function decodeLiteral(value) {
  if (value === 'NULL') return null
  if (!(value.startsWith("'") && value.endsWith("'"))) throw new Error('unexpected mysqldump literal')
  let result = ''; const source = value.slice(1, -1)
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== '\\') { result += source[index]; continue }
    index += 1
    const escaped = source[index]
    result += ({ '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' }[escaped] ?? escaped)
  }
  return result
}
function rowsById(rows, width) {
  const result = new Map()
  for (const row of rows) {
    if (row.length !== width) throw new Error(`unexpected items width: ${row.length}`)
    const id = decodeLiteral(row[0])
    if (result.has(id)) throw new Error(`duplicate item id: ${id}`)
    result.set(id, row)
  }
  return result
}
function rowCount(manifest, table) { return manifest.get(table)?.[0] }
function tableHash(manifest, table) { return manifest.get(table)?.[1] }

try {
  const preManifest = parseManifest(fs.readFileSync(preManifestPath, 'utf8'))
  const postManifest = parseManifest(fs.readFileSync(postManifestPath, 'utf8'))
  const preSchema = parseSchema(fs.readFileSync(preSchemaPath, 'utf8'))
  const postSchema = parseSchema(fs.readFileSync(postSchemaPath, 'utf8'))
  if (preManifest.get('database')?.[0] !== 'knowledge_base_uat' || postManifest.get('database')?.[0] !== 'knowledge_base_uat') fixedFailure('snapshot-database-must-be-knowledge_base_uat')
  if (!exactVersions(preSchema, ['1', '2', '3'])) fixedFailure('pre-migrations-must-be-exactly-001-002-003')
  if (!exactVersions(postSchema, ['1', '2', '3', '4'])) fixedFailure('post-migrations-must-be-exactly-001-002-003-004')
  const migration004 = postSchema.migrations.find(record => record.version === '4')
  if (!migration004 || migration004.name !== '004_add_exploration_tracks.sql') fixedFailure('post-004-name-mismatch')
  if (migration004.checksum !== expectedChecksum) fixedFailure('post-004-checksum-mismatch')
  if (hasAny004Object(preSchema)) fixedFailure('pre-schema-must-not-contain-004-objects')
  if (!postSchemaMatches(postSchema)) fixedFailure('post-schema-must-match-004-objects')

  const beforeRows = rowsById(itemRows(fs.readFileSync(preRecordsPath, 'utf8')), 8)
  const afterRows = rowsById(itemRows(fs.readFileSync(postRecordsPath, 'utf8')), 9)
  const differences = []
  for (const [id, before] of beforeRows) {
    const after = afterRows.get(id)
    if (!after) { differences.push([id, '__row__', 'missing-after']); continue }
    for (let index = 0; index < legacyColumns.length; index += 1) if (before[index] !== after[index]) differences.push([id, legacyColumns[index], 'different'])
    if (after[8] !== 'NULL') differences.push([id, 'exploration_track_id', 'not-null'])
  }
  for (const id of afterRows.keys()) if (!beforeRows.has(id)) differences.push([id, '__row__', 'unexpected-after'])
  const unchangedTables = stableTables.filter(table => rowCount(preManifest, table) === rowCount(postManifest, table) && tableHash(preManifest, table) === tableHash(postManifest, table))
  const changedTables = stableTables.filter(table => !unchangedTables.includes(table))
  const itemCountValid = beforeRows.size === 20 && afterRows.size === 20 && rowCount(preManifest, 'items') === '20' && rowCount(postManifest, 'items') === '20'
  const tracksEmpty = rowCount(postManifest, 'exploration_tracks') === '0'
  const result = itemCountValid && tracksEmpty && differences.length === 0 && changedTables.length === 0
  fs.writeFileSync(differencePath, ['item_id\tfield\tresult', ...differences.map(row => row.join('\t'))].join('\n') + '\n')
  fs.writeFileSync(comparisonPath, [
    'comparisonProfile\tschema-004-add-nullable-item-track',
    'profileEligibility\tschema-004-v3-to-v4-uat',
    'profileEligibilityResult\tPASS',
    'profileEligibilityFailure\tnone',
    `itemsLegacyProjectionColumns\t${legacyColumns.join(', ')}`,
    `itemsLegacyProjectionRowCountBefore\t${beforeRows.size}`,
    `itemsLegacyProjectionRowCountAfter\t${afterRows.size}`,
    `itemsNewColumnInvariant\texploration_track_id IS NULL, count = ${differences.filter(row => row[1] === 'exploration_track_id').length}`,
    `explorationTracksInvariant\tcount = ${rowCount(postManifest, 'exploration_tracks')}`,
    `itemsLegacyProjectionDifferences\t${differences.length}`,
    `otherExistingCollectionsUnchanged\t${changedTables.length === 0 ? 'true' : 'false'}`,
    `otherExistingCollectionsChanged\t${changedTables.join(',') || 'none'}`,
    'itemsCompleteDump\texpected-schema-representation-change: items 新增 exploration_track_id，历史行导出新增 NULL',
    `comparisonResult\t${result ? 'PASS' : 'FAIL'}`,
  ].join('\n') + '\n')
  process.exitCode = result ? 0 : 1
} catch {
  fixedFailure('snapshot-artifact-format-invalid')
}
NODE
status=$?
set -e
[ "$status" -eq 0 ] || exit "$status"
printf '%s\n' 'schema-004 comparison completed'
