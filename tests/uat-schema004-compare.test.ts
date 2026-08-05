import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const roots: string[] = []
const checksum = '6703b3ec3a0125b867a4077d4eab350bf6df8dfe75a9f061660344696a9f8a9f'
const script = resolve(process.cwd(), 'scripts/uat-schema004-compare.sh')
const stableTables = ['reviews', 'methods', 'method_versions', 'method_evidence', 'method_applications', 'method_tombstones', 'item_links', 'item_status_events', 'system_metadata']

afterEach(() => {
  while (roots.length) rmSync(roots.pop()!, { recursive: true, force: true })
})

function schema(version: 3 | 4, options: {
  preObject?: boolean
  missingPostObject?: boolean
  invalidPostObject?: boolean
  extraTrackColumn?: boolean
  missingTrackPrimaryKey?: boolean
  differentTrackPrimaryKey?: boolean
  compositeTrackPrimaryKey?: boolean
  name?: string
  hash?: string
  extraVersion?: boolean
} = {}) {
  const rows = ['section\tfield_1\tfield_2\tfield_3\tfield_4\tfield_5\tfield_6\tfield_7\tfield_8']
  for (const migration of [1, 2, 3]) rows.push(`migration\tschema_migrations\t${migration}\t00${migration}_migration.sql\thash-${migration}\tdate`)
  if (version === 4) rows.push(`migration\tschema_migrations\t4\t${options.name ?? '004_add_exploration_tracks.sql'}\t${options.hash ?? checksum}\tdate`)
  const objectRows = [
    'column\texploration_tracks\tid\tvarchar(128)\tNO\tNULL\t\tutf8mb4',
    'column\texploration_tracks\tname\tvarchar(80)\tNO\tNULL\t\tutf8mb4',
    'column\texploration_tracks\tnormalized_name\tvarchar(80)\tNO\tNULL\t\tutf8mb4',
    'column\texploration_tracks\tcreated_at\tdatetime(3)\tNO\tNULL\t\tNULL',
    'column\texploration_tracks\tupdated_at\tdatetime(3)\tNO\tNULL\t\tNULL',
    'column\texploration_tracks\tdeleted_at\tdatetime(3)\tYES\tNULL\t\tNULL',
    ...(options.extraTrackColumn ? ['column\texploration_tracks\tunfrozen_extra\tvarchar(16)\tYES\tNULL\t\tutf8mb4'] : []),
    `column\titems\texploration_track_id\t${options.invalidPostObject ? 'varchar(64)' : 'varchar(128)'}\tYES\tNULL\t\tutf8mb4`,
    ...(options.missingTrackPrimaryKey
      ? []
      : options.differentTrackPrimaryKey
        ? ['index\texploration_tracks\tPRIMARY\t0\t1\tname\tA\tBTREE']
        : options.compositeTrackPrimaryKey
          ? ['index\texploration_tracks\tPRIMARY\t0\t1\tid\tA\tBTREE', 'index\texploration_tracks\tPRIMARY\t0\t2\tname\tA\tBTREE']
          : ['index\texploration_tracks\tPRIMARY\t0\t1\tid\tA\tBTREE']),
    'index\texploration_tracks\texploration_tracks_normalized_name_unique\t0\t1\tnormalized_name\tA\tBTREE',
    'index\texploration_tracks\texploration_tracks_active_updated_idx\t1\t1\tdeleted_at\tA\tBTREE',
    'index\texploration_tracks\texploration_tracks_active_updated_idx\t1\t2\tupdated_at\tD\tBTREE',
    'index\titems\titems_exploration_track_created_idx\t1\t1\texploration_track_id\tA\tBTREE',
    'index\titems\titems_exploration_track_created_idx\t1\t2\tcreated_at\tD\tBTREE',
    'foreign_key\titems\titems_exploration_track_fk\texploration_track_id\texploration_tracks\tid\tNO ACTION\tNO ACTION',
  ]
  if ((version === 4 && !options.missingPostObject) || options.preObject) rows.push(...objectRows)
  if (options.extraVersion) rows.push('migration\tschema_migrations\t5\t005_unapproved.sql\thash-5\tdate')
  return `${rows.join('\n')}\n`
}

function records(width: 8 | 9, options: { changedItem?: boolean; nonNullTrack?: boolean } = {}) {
  const lines = ['-- table: items']
  for (let index = 1; index <= 20; index += 1) {
    const title = options.changedItem && index === 1 ? 'changed' : 'title'
    const values = [`'item-${index}'`, `'${title}'`, "'content'", "'doing'", "'start'", "'2026-07-24 00:00:00.000'", "'2026-07-24 00:00:00.000'", 'NULL']
    if (width === 9) values.push(options.nonNullTrack && index === 1 ? "'track-1'" : 'NULL')
    lines.push(`INSERT INTO \`items\` VALUES (${values.join(',')});`)
  }
  return `${lines.join('\n')}\n`
}

function manifest(database: string, version: 3 | 4, options: { changedStable?: boolean; nonEmptyTracks?: boolean } = {}) {
  const rows = [`database\t${database}`, 'schema.tsv\tschema', 'records.sql\trecords', `schema_migrations\t${version}\tmigrations-${version}`, `exploration_tracks\t${options.nonEmptyTracks ? 1 : 0}\ttracks`]
  rows.push('items\t20\titems')
  for (const table of stableTables) rows.push(`${table}\t0\t${options.changedStable && table === 'reviews' ? 'changed' : table}`)
  return `${rows.join('\n')}\n`
}

function writeSnapshot(directory: string, version: 3 | 4, options: Parameters<typeof schema>[1] & { database?: string; changedItem?: boolean; nonNullTrack?: boolean; changedStable?: boolean; nonEmptyTracks?: boolean } = {}) {
  writeFileSync(join(directory, 'schema.tsv'), schema(version, options))
  writeFileSync(join(directory, 'records.sql'), records(version === 3 ? 8 : 9, options))
  writeFileSync(join(directory, 'manifest.sha256'), manifest(options.database ?? 'knowledge_base_uat', version, options))
}

function run(options: { pre?: Parameters<typeof writeSnapshot>[2]; post?: Parameters<typeof writeSnapshot>[2]; preVersion?: 3 | 4; postVersion?: 3 | 4 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'kb-schema004-profile-'))
  roots.push(root)
  const pre = join(root, 'pre'); const post = join(root, 'post'); const output = join(root, 'output')
  require('node:fs').mkdirSync(pre); require('node:fs').mkdirSync(post)
  writeSnapshot(pre, options.preVersion ?? 3, options.pre)
  writeSnapshot(post, options.postVersion ?? 4, options.post)
  const shell = process.platform === 'win32' ? 'C:\\Program Files\\Git\\bin\\bash.exe' : 'sh'
  const result = spawnSync(shell, [script, pre, post, output], { encoding: 'utf8' })
  return { result, output }
}

describe('uat schema 004 comparison profile', () => {
  it('accepts only the frozen UAT v3 to v4 Schema 004 profile', () => {
    const { result, output } = run()
    expect(result.status, `${result.stdout}\n${result.stderr}\n${readFileSync(join(output, 'comparison-manifest.tsv'), 'utf8')}`).toBe(0)
    const manifest = readFileSync(join(output, 'comparison-manifest.tsv'), 'utf8')
    expect(manifest).toContain('profileEligibilityResult\tPASS')
    expect(manifest).toContain('comparisonResult\tPASS')
    expect(manifest).toContain('expected-schema-representation-change')
  })

  const ineligibleCases: Array<[string, Parameters<typeof run>[0]]> = [
    ['same v3 snapshots', { post: { missingPostObject: true, name: '003_migration.sql' } }],
    ['pre v4', { preVersion: 4 }],
    ['wrong 004 name', { post: { name: '004_wrong.sql' } }],
    ['wrong 004 checksum', { post: { hash: 'wrong' } }],
    ['extra migration version', { post: { extraVersion: true } }],
    ['pre existing 004 object', { pre: { preObject: true } }],
    ['missing post object', { post: { missingPostObject: true } }],
    ['invalid post object definition', { post: { invalidPostObject: true } }],
    ['post Track extra column', { post: { extraTrackColumn: true } }],
    ['post Track missing primary key', { post: { missingTrackPrimaryKey: true } }],
    ['post Track different primary key', { post: { differentTrackPrimaryKey: true } }],
    ['post Track composite primary key', { post: { compositeTrackPrimaryKey: true } }],
    ['wrong database', { pre: { database: 'knowledge_base' } }],
    ['different database identity', { post: { database: 'other_uat' } }],
  ]

  it.each(ineligibleCases)('rejects profile ineligible %s snapshots', (_name, options) => {
    const { result, output } = run(options)
    expect(result.status).not.toBe(0)
    const manifest = readFileSync(join(output, 'comparison-manifest.tsv'), 'utf8')
    expect(manifest).toContain('profileEligibilityResult\tFAIL')
    expect(manifest).not.toContain('comparisonResult\tPASS')
    expect(manifest).not.toContain('expected-schema-representation-change')
  })

  it.each([
    ['changed legacy Item field', { post: { changedItem: true } }],
    ['non-null new Item column', { post: { nonNullTrack: true } }],
    ['non-empty Track table', { post: { nonEmptyTracks: true } }],
    ['changed existing collection hash', { post: { changedStable: true } }],
  ])('rejects eligible profiles with %s', (_name, options) => {
    const { result, output } = run(options)
    expect(result.status).not.toBe(0)
    const manifest = readFileSync(join(output, 'comparison-manifest.tsv'), 'utf8')
    expect(manifest).toContain('profileEligibilityResult\tPASS')
    expect(manifest).toContain('comparisonResult\tFAIL')
  })
})
