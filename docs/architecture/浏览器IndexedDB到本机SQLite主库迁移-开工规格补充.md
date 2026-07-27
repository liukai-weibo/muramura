# 娴忚鍣?IndexedDB 鈫?鏈満 SQLite 涓诲簱杩佺Щ 鈥?寮€宸ヨ鏍艰ˉ鍏?

> 鐘舵€侊細**鏋舵瀯鍐荤粨瀹屾垚銆傛巿鏉冭寖鍥翠粎闄?Phase 1锛歋QLite 鏁版嵁灞備笌鑷姩鍖栨祴璇曪紱灏氫笉鎺堟潈 Local API銆佹祻瑙堝櫒椤甸潰鎴栨棫鏁版嵁鐪熷疄杩佺Щ瀹炴柦銆?*
> 涓讳换鍔′功锛歚docs/architecture/娴忚鍣↖ndexedDB鍒版湰鏈篠QLite涓诲簱杩佺Щ-姝ｅ紡瀹炴柦浠诲姟涔?md`銆?
> 鏈枃瑙ｅ喅锛歋QLite DDL銆丆ontract 鏄犲皠銆丄PI DTO銆佸鍏?鎭㈠涓€鑷存€ф牳楠屻€侀樆鏂〉鐘舵€佷笌 Phase 1 娴嬭瘯銆?

## 銆愭妧鏈粨璁猴細鍙銆?

鐜版湁涓氬姟妯″瀷鍙棤鎹熸槧灏勫埌 SQLite銆傚疄鏂藉繀椤讳繚鎸佺幇鏈?Contracts 鐨勫紓姝ユ帴鍙ｄ笌涓氬姟璇箟锛汼QLite 浠呮浛鎹㈡寔涔呭寲浠嬭川锛屼笉寰楁垚涓虹姸鎬佹満銆佸浠芥牎楠屾垨鍏宠仈鎺ㄦ柇鐨勬柊鏉ユ簮銆?

鏈鏍煎皢瀹炴柦鎷嗕负涓ユ牸椤哄簭锛?

```text
Phase 1锛歴torage-sqlite + Repository 鑷姩鍖?
鈫?鏋舵瀯瀹￠槄 / QA 鏁版嵁灞傞獙鏀?
鈫?Phase 2锛歀ocal API銆丣SON 杩佺Щ銆佹仮澶嶇偣
鈫?QA 杩佺Щ楠屾敹
鈫?Phase 3锛氬墠绔?client銆侀樆鏂〉鍜屽伐浣滃彴鍒囨崲
```

## 銆愪竴銆丳hase 1 鎺堟潈鑼冨洿銆?

鍏佽淇敼锛?

```text
packages/storage-sqlite/**
packages/contracts/src/index.ts锛堜粎鏈鏍间腑鏄庣‘鐨勫叡浜熀纭€璁炬柦绫诲瀷锛?
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
.gitignore
tests/**
docs/architecture/**
```

鏈樁娈电姝慨鏀癸細

```text
apps/client/**
apps/local-api/**
packages/local-api-client/**
packages/application/** 鐨勪笟鍔℃湇鍔¤涔?
packages/storage-indexeddb/** 鐨勭幇鏈夌敓浜у疄鐜?
BackupDocument 鐗堟湰 / BackupData 缁撴瀯
ItemStatus 涓庣姸鎬佹満
浠讳綍涓氬姟椤甸潰銆佹寜閽€佽縼绉诲悜瀵兼垨 API 璺敱
```

Phase 1 缁撴潫鐨勫敮涓€鐩爣锛?

```text
缁欏畾涓存椂 SQLite 鏂囦欢
鈫?鐜版湁鍏ㄩ儴 Repository Contracts 鍙敱 SQLite 瀹炵幇
鈫?鑷姩鍖栬瘉鏄庝笌褰撳墠 IndexedDB 璇箟绛変环
鈫?涓嶅奖鍝嶇幇鏈夋祻瑙堝櫒宸ヤ綔鍙?
```

## 銆愪簩銆丼QLite 鏁版嵁搴撴墦寮€涓?DDL 瀹炴柦瑙勬牸銆?

### 1. `openKnowledgeDatabase()` 鍩虹璁炬柦鎺ュ彛

`packages/storage-sqlite/src/database.ts` 搴旀彁渚涘唴閮ㄥ熀纭€璁炬柦宸ュ巶锛屽缓璁細

```ts
export interface OpenKnowledgeDatabaseOptions {
  databasePath: string
  readonly?: boolean
}

export interface SqliteKnowledgeDatabase {
  readonly databasePath: string
  close(): void
  runInTransaction<T>(work: () => T): T
  runInReadTransaction<T>(work: () => T): T
}

export function openKnowledgeDatabase(
  options: OpenKnowledgeDatabaseOptions,
): SqliteKnowledgeDatabase
```

绾︽潫锛?

```text
Repository 涓嶈嚜琛?new Database()銆?
Repository 鍙兘閫氳繃 SqliteKnowledgeDatabase 鎵ц鍙傛暟鍖?SQL 涓?transaction銆?
杩愯鏃?Local API 璐熻矗鍐冲畾鐪熷疄鏁版嵁搴撹矾寰勶紱娴嬭瘯浼犲叆涓存椂鏂囦欢璺緞銆?
```

### 2. 鎵撳紑椤哄簭涓?PRAGMA

```text
mkdir(path.dirname(databasePath), recursive)
鈫?new Database(databasePath)
鈫?PRAGMA foreign_keys = ON
鈫?PRAGMA journal_mode = WAL
鈫?PRAGMA synchronous = FULL
鈫?PRAGMA busy_timeout = 5000
鈫?applySchemaMigrations()
鈫?PRAGMA quick_check
鈫?杩斿洖 database handle
```

`PRAGMA quick_check` 瑙勫垯锛?

```text
缁撴灉蹇呴』鎭颁负涓€琛屻€佷竴鍒椼€佸€间负 "ok"
鈫?鎴愬姛

鍏朵粬浠绘剰缁撴灉鎴栨煡璇㈠け璐?
鈫?close handle
鈫?鎶涘嚭 SqliteStorageOpenError(code = "integrity-check-failed")
```

`database.ts` 涓嶅緱锛?

```text
鎹曡幏妫€鏌ラ敊璇悗鍒涘缓鏂扮┖搴?
鍒犻櫎銆侀噸鍛藉悕鎴栬鐩栧師鏂囦欢
鑷鐩戝惉 HTTP
浣跨敤椤圭洰宸ヤ綔鐩綍浣滀负鐪熷疄鐢ㄦ埛鏁版嵁搴?fallback
```

### 3. Schema migration 鎵ц鏂瑰紡

鏂板锛?

```text
packages/storage-sqlite/src/schema.ts
```

鏆撮湶锛?

```ts
export const SQLITE_SCHEMA_VERSION = 1
export function applySchemaMigrations(database: Database.Database): void
```

姣忔杩佺Щ锛?

```text
BEGIN IMMEDIATE
鈫?璇诲彇 schema_migrations 鏈€鏂?version
鈫?鎵ц璇ョ増鏈?DDL / 鏁版嵁杩佺Щ
鈫?INSERT schema_migrations(version, applied_at)
鈫?COMMIT

澶辫触
鈫?ROLLBACK
鈫?鎶涘嚭
```

绂佹閫氳繃 `CREATE TABLE IF NOT EXISTS` 鍚庣洿鎺ュ亣瀹?schema 瀹屾暣銆俙IF NOT EXISTS` 鍙兘鐢ㄤ簬棣栨寤鸿〃 DDL锛涚増鏈褰曟墠鏄敮涓€鍗囩骇渚濇嵁銆?

### 4. Schema v1 绮剧‘ DDL

浠ヤ笅 DDL 鏄?Phase 1 鐨勫敮涓€涓氬姟琛ㄨ璁°€傚懡鍚嶅彲淇濇寔 snake_case锛汥TO 鏄犲皠鍦?Repository 鍐呮樉寮忓畬鎴愩€?

```sql
CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'idea_to_try',
    'idea_later',
    'doing',
    'paused',
    'waiting_review',
    'reviewed',
    'archived_no_review',
    'abandoned'
  )),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  start_action TEXT
);
CREATE INDEX idx_items_active_status_updated
  ON items(status, updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_items_deleted_at ON items(deleted_at);

CREATE TABLE item_status_events (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL,
  from_status TEXT,
  to_status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
);
CREATE INDEX idx_item_status_events_item_created
  ON item_status_events(item_id, created_at);

CREATE TABLE reviews (
  id TEXT PRIMARY KEY,
  item_id TEXT NOT NULL UNIQUE,
  actual_action TEXT NOT NULL,
  result TEXT NOT NULL,
  effective TEXT NOT NULL,
  incompatible TEXT NOT NULL,
  reason TEXT NOT NULL,
  adjustment TEXT NOT NULL,
  new_ideas TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
);

CREATE TABLE methods (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  applicable TEXT NOT NULL,
  unsuitable TEXT NOT NULL,
  steps TEXT NOT NULL,
  validation_count INTEGER NOT NULL,
  version INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);
CREATE INDEX idx_methods_active_updated
  ON methods(updated_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX idx_methods_deleted_at ON methods(deleted_at);

CREATE TABLE method_versions (
  id TEXT PRIMARY KEY,
  method_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  title TEXT NOT NULL,
  applicable TEXT NOT NULL,
  unsuitable TEXT NOT NULL,
  steps TEXT NOT NULL,
  source_review_id TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(method_id, version)
);
CREATE INDEX idx_method_versions_source_review
  ON method_versions(source_review_id);

CREATE TABLE method_evidence (
  id TEXT PRIMARY KEY,
  method_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  relation TEXT CHECK (relation IN (
    'formation', 'validation', 'revision', 'unknown'
  )),
  method_version INTEGER
);
CREATE UNIQUE INDEX idx_method_evidence_method_review
  ON method_evidence(method_id, review_id);
CREATE INDEX idx_method_evidence_method ON method_evidence(method_id);
CREATE INDEX idx_method_evidence_review ON method_evidence(review_id);

CREATE TABLE method_applications (
  id TEXT PRIMARY KEY,
  method_id TEXT NOT NULL,
  method_version INTEGER NOT NULL,
  item_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE RESTRICT
);
CREATE INDEX idx_method_applications_method_version
  ON method_applications(method_id, method_version);

CREATE TABLE method_tombstones (
  method_id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  permanently_deleted_at TEXT NOT NULL,
  versions_json TEXT NOT NULL
);

CREATE TABLE item_links (
  id TEXT PRIMARY KEY,
  source_review_id TEXT NOT NULL,
  target_item_id TEXT NOT NULL,
  type TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (source_review_id) REFERENCES reviews(id) ON DELETE RESTRICT,
  FOREIGN KEY (target_item_id) REFERENCES items(id) ON DELETE RESTRICT
);
CREATE INDEX idx_item_links_source_review ON item_links(source_review_id);
CREATE INDEX idx_item_links_target_item ON item_links(target_item_id);

CREATE TABLE system_metadata (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

### 5. 澶栭敭涓庝笟鍔″叧绯荤殑鏄庣‘鐣岀嚎

鍏佽纭閿細

```text
item_status_events.item_id 鈫?items.id
reviews.item_id 鈫?items.id
method_applications.item_id 鈫?items.id
item_links.source_review_id 鈫?reviews.id
item_links.target_item_id 鈫?items.id
```

涓嶅厑璁哥‖澶栭敭锛?

```text
method_versions.method_id 鈫?methods.id
method_evidence.method_id 鈫?methods.id
method_evidence.review_id 鈫?reviews.id
method_applications.method_id 鈫?methods.id
```

鍘熷洜涓嶆槸鏀炬澗鍙俊鎬э紝鑰屾槸鐜版湁姘镐箙娓呯悊璇箟鏄庣‘鍏佽锛?

```text
鏂规硶鏈綋 / 鐗堟湰姝ｆ枃姘镐箙娓呯悊
鈫?MethodEvidence / MethodApplication 缁х画瀛樺湪
鈫?MethodTombstone 瑙ｉ噴鍘嗗彶鍏宠仈
```

杩欎簺鍏崇郴鐨勫彲淇℃€х户缁敱锛?

```text
Application 涓氬姟璇箟
Repository 浜嬪姟
BackupApplicationService.parseAndValidate()
SQLite 瀵煎叆 / 鎭㈠鍚庣殑缁撴瀯鍖栧畬鏁存€ф鏌?
```

鍏卞悓淇濊瘉銆備笉寰楃敤 SQL cascade 鏇夸唬褰撳墠鏄庣‘鐨?Item / 鏂规硶姘镐箙娓呯悊缂栨帓銆?

## 銆愪笁銆丼QLite Repository Contract 鏄犲皠銆?

### 1. 宸ュ巶涓庣粍鍚堟牴

`packages/storage-sqlite/src/index.ts` 搴斿鍑猴細

```ts
export interface SqliteRepositoryBundle {
  database: SqliteKnowledgeDatabase
  repository: ItemRepository
  reviewRepository: ReviewRepository
  methodRepository: MethodRepository
  methodApplicationRepository: MethodApplicationRepository
  reviewWorkflowRepository: ReviewWorkflowRepository
  backupRepository: BackupRepository
  searchRepository: SearchRepository
  dashboardRepository: DashboardRepository
}

export function createSqliteRepository(
  databasePath: string,
): SqliteRepositoryBundle
```

瀹冩槸鏈嶅姟绔粍鍚堟牴銆備笉寰椾粠娴忚鍣?bundle 瀵煎叆鎴栬皟鐢ㄣ€?

### 2. Contract 鏄犲皠琛?

| Contract | SQLite 瀹炵幇 | 鏍稿績绾︽潫 |
|---|---|---|
| `ItemRepository.create` | `SqliteItemRepository.create` | Item 涓庡垵濮嬬姸鎬佷簨浠跺悓涓€ `BEGIN IMMEDIATE` |
| `getById` / `list` / `listDeleted` / `listStatusEvents` | `SqliteItemRepository` | DTO 鏄犲皠鎭㈠ camelCase锛沴ist 鎺掑簭蹇呴』涓庣幇鏈?Application 璇箟鍏煎 |
| `changeStatus` | `SqliteItemRepository.changeStatus` | 浜嬪姟鍐呴噸璇汇€乣assertTransition()`銆両tem 涓?event 鍘熷瓙 |
| `startExecution` | `SqliteItemRepository.startExecution` | 闈炵┖ `startAction` + `doing` + event 鍘熷瓙锛涗粎 `idea_to_try`锛涗笉鍙噸鍐?|
| `updateContent` | `SqliteItemRepository.updateContent` | 浜嬪姟鍐呴噸璇伙紝浠?`content` / `updatedAt` |
| `delete` / `restore` / `purgeDeletedBefore` | `SqliteItemRepository` | 缁х画淇濈暀 Item P0 鐨勫彈鎺т氦閿欒涔変笌鏄惧紡鍏宠仈娓呯悊 |
| `ReviewRepository` | `SqliteReviewRepository` | 涓€浜嬮」涓€ Review锛涗笉鏀?Review 浜嬪疄 |
| `MethodRepository` | `SqliteMethodRepository` | 褰㈡垚銆侀獙璇併€佷慨璁€佺増鏈€佽瘉鎹€佺敓鍛藉懆鏈熷拰澧撶璇箟涓嶅彉 |
| `MethodApplicationRepository` | `SqliteMethodApplicationRepository` | `itemId` 鍞竴锛屽喕缁撶増鏈紱澶嶇敤鐜版湁涓婁笅鏂囧拰鎵归噺鏉ユ簮璇绘ā鍨?Contract |
| `ReviewWorkflowRepository.complete` | `SqliteReviewWorkflowRepository` | Review銆両tem 鐘舵€併€佷簨浠躲€佹柟娉?/ 璇佹嵁 / 鏂版兂娉?/ ItemLink 鍏ㄦ湁鎴栧叏鏃?|
| `BackupRepository` | `SqliteBackupRepository` | 涓€鑷存€ц蹇収锛涘叏閲忔浛鎹粎鍗曚簨鍔?|
| `SearchRepository` | `SqliteSearchRepository` | 鍙鍒荤幇鏈夊瓧娈靛尮閰嶈涔夛紱涓嶅紩鍏?FTS 鎴栨帹鏂?|
| `DashboardRepository` | `SqliteDashboardRepository` | 杩斿洖涓庣幇鏈?`DashboardSnapshot` 鍚屽舰鏁版嵁 |

### 3. 蹇呴』鎶藉彇鐨勭鏈?SQL 杈呭姪

浠ヤ笅浠呬负 `storage-sqlite` 鍐呴儴鍑芥暟锛屼笉鑳芥垚涓烘柊鐨勫叕鍏变笟鍔?API锛?

```ts
mapItemRow(row): Item
mapReviewRow(row): Review
mapMethodRow(row): Method
mapMethodVersionRow(row): MethodVersion
mapMethodEvidenceRow(row): MethodEvidence
mapMethodApplicationRow(row): MethodApplication
mapMethodTombstoneRow(row): MethodTombstone
mapItemLinkRow(row): ItemLink
mapItemStatusEventRow(row): ItemStatusEvent

getItemInTransaction(id)
requireActiveItemInTransaction(id)
replaceBackupDataInTransaction(data)
assertSqliteBackupDataIntegrityInTransaction(data)
```

- `versions_json` 鐨勮В鏋愬け璐ュ繀椤讳娇璇诲彇 / 鍚姩澶辫触鏄惧紡鎶ヤ负 storage corruption锛屼笉寰楄繑鍥炵┖鐗堟湰鏄犲皠锛?
- SQL 瀛楁鍒?Contract DTO 鐨勫彉鎹㈡槸鍞竴鍏佽鐨勫瓨鍌ㄩ€傞厤锛?
- 涓嶅緱鍦ㄦ槧灏勬椂鐢ㄦ爣棰樸€佹椂闂存垨鐗堟湰鍙风寽娴嬬己澶卞叧绯汇€?

### 4. 浜嬪姟鍏蜂綋绾︽潫

`better-sqlite3` 涓哄悓姝ラ┍鍔ㄣ€俁epository 鍙悜涓婅繑鍥?`Promise.resolve(...)`锛屼絾浜嬪姟鍐呬笉鑳芥妸寮傛 Promise 浼犲叆 `database.transaction()` 鍥炶皟銆?

鎵€鏈夊璇彞鍐欏叆閫氳繃缁熶竴锛?

```ts
const write = database.transaction(() => {
  // transaction 鍐呴噸鏂拌鍙栥€佹柇瑷€銆佸啓鍏?
})
return Promise.resolve(write())
```

`BEGIN IMMEDIATE` 绛変环绛栫暐蹇呴』淇濊瘉锛?

```text
澶氬啓鍏ヤ笉浼氫氦閿欎负鍗婄姸鎬?
璇诲彇鍚庡啓鍏ュ墠涓嶄細浠ユ棫 Item 瑕嗙洊鏈€鏂?status / content / deletedAt
澶辫触鍙?rollback
```

`busy_timeout` 鍒版湡鐨?`SQLITE_BUSY` 蹇呴』涓婃姏涓哄彲鍒嗙被鐨勫熀纭€璁炬柦閿欒锛涗笉鍏佽 Repository 闈欓粯閲嶈瘯鎴栧湪椤甸潰灞傚嚟鏃堕棿閲嶈瘯銆?

## 銆愬洓銆丼QLite 瀹屾暣鎬ф鏌ヨ鑼冦€?

### 1. 鍚姩 `quick_check` 涓嶆槸涓氬姟瀹屾暣鎬ф鏌?

鍚姩闃舵锛?

```text
PRAGMA quick_check
鈫?浠呯‘璁?SQLite 鏂囦欢椤?/ 缁撴瀯灞傚畬鏁存€?
```

瀹冧笉鑳芥浛浠ｄ笟鍔″紩鐢ㄤ笌澧撶瑙勫垯銆傚洜姝ゆ柊澧炲彧璇绘鏌ワ細

```ts
assertSqliteBusinessIntegrity(): void
```

璇ユ鏌ュ湪浠ヤ笅鏃舵満杩愯锛?

```text
棣栨 IndexedDB JSON 瀵煎叆 transaction 鍐呫€佸啓鍏ュ悗銆佹彁浜ゅ墠
JSON restore transaction 鍐呫€佸啓鍏ュ悗銆佹彁浜ゅ墠
娴嬭瘯涓樉寮忛獙璇?
```

鏃ュ父姣忔 API 鍚姩涓嶆壂鎻忓叏閲忎笟鍔″叧绯伙紱鍚姩鍙仛 `quick_check`銆備笟鍔″畬鏁存€у凡鍦ㄦ墍鏈夊彲淇″啓鍏ヤ笌澶囦唤鎭㈠鍏ュ彛淇濊瘉銆傝嫢鏈潵鏈夊閮ㄦ墜宸ョ鏀?SQLite 鐨勬敮鎸佸満鏅紝鍙﹁绔嬮」鎻愪緵璇婃柇鍛戒护銆?

### 2. 涓氬姟瀹屾暣鎬ф鏌ラ」

蹇呴』纭锛?

```text
1. 姣忎釜 Review.itemId 瀛樺湪 Item銆?
2. 姣忎釜 ItemStatusEvent.itemId 瀛樺湪 Item銆?
3. 姣忎釜 MethodApplication.itemId 瀛樺湪 Item銆?
4. 姣忎釜 ItemLink.sourceReviewId 瀛樺湪 Review銆?
5. 姣忎釜 ItemLink.targetItemId 瀛樺湪 Item銆?
6. 姣忎釜 MethodApplication.itemId 鏈€澶氫竴鏉°€?
7. 姣忎釜 Review.itemId 鏈€澶氫竴鏉°€?
8. 姣忎釜 MethodVersion 鐨?(methodId, version) 鍞竴銆?
9. 鍚?methodId 涓嶅緱鍚屾椂瀛樺湪 Method 涓?MethodTombstone銆?
10. 姣忔潯 MethodEvidence锛?
    methodId 蹇呴』瀛樺湪浜?Method 鎴?MethodTombstone锛況eviewId 蹇呴』瀛樺湪銆?
11. 姣忔潯 MethodApplication锛?
    methodId 蹇呴』瀛樺湪浜?Method 鎴?MethodTombstone锛?
    鍏?frozen methodVersion 蹇呴』鍦ㄧ幇瀛?MethodVersion 鎴?Tombstone.versions 涓瓨鍦ㄣ€?
12. 姣忔潯鐜板瓨 MethodVersion.sourceReviewId锛?
    鑻ユ湁鍊硷紝Review 蹇呴』瀛樺湪銆?
13. Item.status銆丮ethodEvidence.relation 鍧囦负鍐荤粨鏋氫妇鍊笺€?
14. startAction 鑻ラ潪 NULL锛屽繀椤绘槸鏂囨湰锛汼QLite TEXT 璇诲彇鍒伴潪鏂囨湰瑙嗕负涓嶅彲淇℃暟鎹€?
15. method_tombstones.versions_json 鍙В鏋愪负锛?
    闈炵┖鎴栫┖鏁扮粍鍧囧悎娉曠殑 MethodTombstoneVersion[]锛涙瘡涓?version 涓烘暣鏁般€?
```

涓氬姟瀹屾暣鎬уけ璐ョ殑閿欒蹇呴』鍖呭惈绋冲畾鐨勬満鍣ㄧ爜锛屼緥濡傦細

```text
integrity-review-item-reference
integrity-method-application-version-reference
integrity-method-tombstone-conflict
integrity-tombstone-versions-json
```

娴忚鍣ㄥ彧鏀跺埌閫氱敤 `storage-unavailable`锛涙湇鍔＄鏃ュ織鍙繚鐣欒鏈哄櫒鐮併€?

## 銆愪簲銆丣SON 杩佺Щ涓庢仮澶嶇殑涓€鑷存€ф牳楠岀畻娉曘€?

### 1. 绂佹鐢?JSON 瀛楃涓茬洿鎺ユ瘮杈?

鐩存帴 `JSON.stringify()` 姣旇緝涓嶅彲淇★紝鍥犱负锛?

```text
闆嗗悎杩斿洖椤哄簭鍙兘涓嶅悓
瀵硅薄 key 椤哄簭鍙兘涓嶅悓
SQLite 琛屽瓨鍌ㄤ笉淇濊瘉 JSON 鏁扮粍鍘熼『搴?
```

蹇呴』姣旇緝**瑙勮寖鍖?BackupData**銆?

### 2. 瑙勮寖鍖栫畻娉?

鏂板鏈嶅姟绔唴閮ㄧ函鍑芥暟锛?

```ts
normalizeBackupDataForComparison(data: BackupData): CanonicalBackupData
```

瑙勫垯锛?

```text
- 姣忎釜闆嗗悎鎸夌ǔ瀹氫富閿崌搴忔帓搴忥紱
- 瀵瑰璞″彧淇濈暀 Contract 宸插畾涔夊瓧娈碉紱
- 鍙€夊瓧娈电己澶变笌 undefined 鍚屼箟锛?
- 涓嶅皢 undefined 杞负绌哄瓧绗︿覆銆乶ull 鎴栫寽娴嬪€硷紱
- MethodTombstone.versions 鎸?version 鍗囧簭锛?
- 涓嶆敼鍙樹换涓€瀛楃涓插唴瀹广€佹椂闂淬€両D銆佺姸鎬併€佺増鏈彿鎴栧叧绯汇€?
```

鍚勯泦鍚堟帓搴忛敭锛?

| 闆嗗悎 | 鎺掑簭閿?|
|---|---|
| `items` | `id` |
| `reviews` | `id` |
| `methods` | `id` |
| `methodEvidence` | `id` |
| `methodVersions` | `id` |
| `methodApplications` | `id` |
| `itemStatusEvents` | `id` |
| `itemLinks` | `id` |
| `methodTombstones` | `methodId` |

### 3. 姣斿瑙勫垯

棣栨杩佺Щ鎴?JSON 鎭㈠鍚庯細

```text
source = parseAndValidate() 寰楀埌鐨勮鑼冨寲 BackupData
actual = SQLite exportData() 寰楀埌鐨勮鑼冨寲 BackupData

閫愰泦鍚堬細
  鏁伴噺鐩稿悓
  姣忎釜绋冲畾閿泦鍚堢浉鍚?
  姣忎釜 Contract 瀛楁鍊间弗鏍肩浉鍚?
  鎵€鏈?tombstone versions 鏄犲皠涓ユ牸鐩稿悓
鈫?鎵嶈涓轰竴鑷?
```

姣旇緝澶辫触锛?

```text
杩佺Щ transaction 鍐咃細鐩存帴 rollback銆?

鎭㈠ transaction 鍐咃細鐩存帴 rollback銆?

鑻ュ洜瀹炵幇椤哄簭瀵艰嚧鍙兘 commit 鍚庢瘮杈冿細璇ュ疄鐜颁笉鍏佽鍚堝苟锛?
蹇呴』閲嶆瀯涓?commit 鍓嶅彲楠岃瘉鐨?transaction 鍐呮鏌ワ紝鎴栧湪 commit 鍓嶅棰勫啓鍏ユ暟鎹瀯寤哄悓绛夊彲姣旇緝蹇収銆?
```

杩佺Щ鏉ユ簮 hash锛?

```text
SHA-256(UTF-8 缂栫爜鐨?canonical BackupData JSON)
```

hash 鐢ㄤ簬瀹¤鍜岄噸澶嶈縼绉讳繚鎶わ紝涓嶆浛浠ｉ€愬瓧娈典竴鑷存€ф瘮瀵广€?

### 4. `replaceData()` 浜嬪姟椤哄簭

`BackupRepository.replaceData(data)` 鍙帴鏀跺凡閫氳繃 Application 鏍￠獙鐨?`BackupData`銆備簨鍔″唴锛?

```text
BEGIN IMMEDIATE
鈫?娓呯┖锛歩tem_links銆乮tem_status_events銆乵ethod_applications銆乵ethod_evidence銆乵ethod_versions銆乵ethod_tombstones銆乺eviews銆乵ethods銆乮tems
鈫?鎻掑叆锛歩tems
鈫?鎻掑叆锛歩tem_status_events
鈫?鎻掑叆锛歳eviews
鈫?鎻掑叆锛歮ethods
鈫?鎻掑叆锛歮ethod_versions
鈫?鎻掑叆锛歮ethod_evidence
鈫?鎻掑叆锛歮ethod_applications
鈫?鎻掑叆锛歮ethod_tombstones
鈫?鎻掑叆锛歩tem_links
鈫?assertSqliteBusinessIntegrity()
鈫?涓庤緭鍏?BackupData 瑙勮寖鍖栭€愬瓧娈典竴鑷存€ф瘮瀵?
鈫?COMMIT
```

浠绘剰寮傚父锛?

```text
ROLLBACK
鈫?涓诲簱淇濈暀鎭㈠鍓嶅畬鏁存暟鎹?
```

> `system_metadata` 涓嶅睘浜?BackupData锛屾櫘閫氭仮澶嶇粷涓嶆竻绌烘垨閲嶅啓 IndexedDB migration metadata銆?

## 銆愬叚銆丩ocal API 绮剧‘ DTO 涓?HTTP 瑙勬牸銆?

> 鏈妭鍐荤粨缁?Phase 2锛汸hase 1 涓嶅疄鐜?HTTP銆侱TO 浼樺厛澶嶇敤鐜版湁 Contracts銆侶TTP handler 鍙仛杈撳叆瑙ｆ瀽銆丱rigin 妫€鏌ャ€佽皟鐢?Application銆佽緭鍑?DTO锛涗笉寰楀啓 SQL銆?

### 1. 鍏叡绾﹀畾

```text
Content-Type锛歛pplication/json; charset=utf-8
鎵€鏈夊啓鎺ュ彛鍙帴鍙?application/json
鎵€鏈?JSON body 蹇呴』鏈夊ぇ灏忛檺鍒讹紙寤鸿 10 MiB锛?
涓嬭浇澶囦唤浣跨敤 application/json + attachment
```

璇锋眰 ID锛?

```text
API 涓烘瘡涓姹傜敓鎴?requestId
閿欒鍝嶅簲鍙寘鍚?requestId锛堜笉灞炰簬涓氬姟 Contract锛?
鏈嶅姟绔棩蹇楀繀椤诲叧鑱?requestId
```

鍏变韩 DTO锛?

```ts
export type LocalApiErrorCode =
  | 'storage-unavailable'
  | 'storage-write-failed'
  | 'migration-required'
  | 'migration-in-progress'
  | 'validation-failed'
  | 'conflict'
  | 'not-found'
  | 'internal-error'

export interface LocalApiErrorResponse {
  error: {
    code: LocalApiErrorCode
    message: string
    retryable: boolean
    requestId?: string
  }
}

export type LocalStorageHealth =
  | { status: 'ready'; databasePath: string; schemaVersion: number }
  | { status: 'migration-required' }
  | { status: 'migration-in-progress' }
  | { status: 'storage-unavailable'; code: string; message: string }
```

`local-api-unreachable` 鏄祻瑙堝櫒 client 鑷韩鐨勭綉缁滈敊璇紝涓嶆槸鏈嶅姟绔搷搴旂爜锛屽洜姝や笉鏀捐繘 HTTP 杩斿洖浣撶被鍨嬨€?

### 2. Health銆両tems 涓庣姸鎬?

| HTTP | 璇锋眰 body / query | 鎴愬姛鍝嶅簲 | Application 璋冪敤 |
|---|---|---|---|
| `GET /api/health` | 鏃?| `LocalStorageHealth` | 浠?storage health |
| `GET /api/items` | 鏃?| `Item[]` | `itemApplication.listItems()` |
| `GET /api/items/trash` | 鏃?| `Item[]` | `itemApplication.listTrash()` |
| `POST /api/items` | `CaptureIdeaInput` | `Item` | `createIdea()` |
| `GET /api/items/:id/status-events` | 鏃?| `ItemStatusEvent[]` | `listStatusEvents()` |
| `POST /api/items/:id/start-execution` | `{ startAction?: string }` | `Item` | `startExecution()` |
| `POST /api/items/:id/status` | `{ status: ItemStatus }` | `Item` | `changeStatus()` |
| `PUT /api/items/:id/content` | `{ content: string }` | `Item` | `updateItemContent()` |
| `POST /api/items/:id/trash` | 鏃?| `204` | `deleteItem()` |
| `POST /api/items/:id/restore` | 鏃?| `Item` | `restoreItem()` |

`start-execution` 涓嶅緱鏀瑰啓涓洪€氱敤 `status` endpoint 鐨勭壒娈?body锛涜繖鏄惎鍔ㄥ姩浣滀笉鍙噸鍐欒竟鐣岀殑涓€閮ㄥ垎銆?

### 3. Review銆丮ethod 涓庢柟娉曞簲鐢?

| HTTP | 璇锋眰 | 鎴愬姛鍝嶅簲 | Application 璋冪敤 |
|---|---|---|---|
| `GET /api/reviews/by-item/:itemId` | 鏃?| `Review \| null` | `getReviewForItem()` |
| `POST /api/reviews/complete` | `CompleteReviewInput` | `CompleteReviewResult` | `completeReview()` |
| `GET /api/methods` | 鏃?| `Method[]` | `listMethods()` |
| `GET /api/methods/:id/versions` | 鏃?| `MethodVersion[]` | `listMethodVersions()` |
| `GET /api/methods/:id/evidence` | 鏃?| `MethodEvidenceDetail[]` | `listMethodEvidenceDetails()` |
| `POST /api/methods/:id/apply` | `{ title: string; content?: string }` | `Item` | `createItem()` |
| `POST /api/methods/:id/validate-from-review` | `{ reviewId: string; revision?: CreateMethodInput }` | `Method` | `validateFromReview()` |
| `POST /api/methods/:id/trash` | 鏃?| `204` | `moveToTrash()` |
| `POST /api/methods/:id/restore` | 鏃?| `Method` | `restore()` |
| `GET /api/method-applications/:itemId/context` | 鏃?| `MethodApplicationContextResult` | `getContextResultForItem()` |
| `POST /api/method-applications/source-displays` | `{ itemIds: string[] }` | `ItemMethodSourceDisplay[]` | `listSourceDisplaysForItems()` |

### 4. 鎼滅储銆佷华琛ㄧ洏銆佸洖鏀剁珯涓庡浠?

| HTTP | 璇锋眰 | 鎴愬姛鍝嶅簲 | Application 璋冪敤 |
|---|---|---|---|
| `GET /api/search?q=` | `q: string` | `SearchResult[]` | `search()` |
| `GET /api/dashboard?window=` | `DashboardWindow` | `DashboardReport` | `getReport()` |
| `GET /api/trash?filter=` | `TrashFilter` | `TrashEntry[]` | `listTrashEntries()` |
| `GET /api/backup/export` | 鏃?| `BackupDocument` 涓嬭浇 | `createBackup()` |
| `POST /api/backup/restore` | `{ document: string }` | `{ restored: true }` | parse 鈫?restore锛屽惈鎭㈠鐐?|
| `POST /api/migration/indexeddb/import` | `{ document: string }` | `{ migrated: true }` | 杩佺Щ鏈嶅姟锛屼笉鍙鐢ㄦ櫘閫?restore 缁曡繃 metadata |

涓婁紶 body 鏄?JSON 鏂囨湰鑰岄潪澶氭鏂囦欢棣栫増瀹炵幇锛屽師鍥犳槸 BackupDocument 鏈潵灏辨槸 JSON锛屼笖鑳藉湪涓€涓檺鍒跺ぇ灏忕殑鏍囧噯 JSON body 涓畬鎴愭牎楠屻€傚墠绔枃浠堕€夋嫨鍚庤鍙栨枃鏈紝client 鍙戦€?`{ document }`銆備笉寰楀湪娴忚鍣ㄦ湰鍦拌В鏋愬悗浼犵粨鏋勫寲瀵硅薄锛屼互闃插鎴风缁曡繃瀹屾暣鍘熸枃 / size 妫€鏌ャ€?

### 5. Origin 鏍￠獙

鍐欐帴鍙ｅ強鏁忔劅璇诲彇锛堝浠藉鍑猴級蹇呴』锛?

```text
鐢熶骇 Origin锛歨ttp://127.0.0.1:32145
寮€鍙?Origin锛氬湪鐜鍙橀噺 KB_DEV_ORIGIN 涓槑纭厤缃殑鍗曚釜 origin
鍏朵粬 Origin锛?03 validation-failed
```

鍚屾簮鐢熶骇璇锋眰鍙甯搁€氳繃銆備笉瀛樺湪 `Origin` 鐨勮姹傚彧鍏佽锛?

```text
GET /api/health
```

鍏朵粬鏃?Origin 璇锋眰榛樿鎷掔粷锛涗笉涓?CLI銆乧url 鎴栤€滄柟渚胯皟璇曗€濇墿寮犲啓鍏ュ叆鍙ｃ€?

## 銆愪竷銆佸墠绔?health gate銆佽縼绉诲悜瀵间笌闃绘柇椤佃鏍笺€?

> 鏈妭鍐荤粨缁?Phase 3锛涘綋鍓嶄笉瀹炴柦椤甸潰銆?

### 1. 椤甸潰鐘舵€佹満

```ts
type BootState =
  | { kind: 'checking' }
  | { kind: 'ready'; health: Extract<LocalStorageHealth, { status: 'ready' }> }
  | { kind: 'migration-required' }
  | { kind: 'migration-in-progress' }
  | { kind: 'api-unreachable' }
  | { kind: 'storage-unavailable'; message: string; databasePath?: string }
```

鍚姩娴佺▼锛?

```text
checking
鈫?GET /api/health

ready
鈫?鎵嶅彲瑁呴厤骞惰鍙栧伐浣滃彴

migration-required
鈫?鍙樉绀鸿縼绉诲悜瀵?

migration-in-progress
鈫?鍙樉绀轰腑鏂縼绉婚樆鏂彁绀轰笌閲嶈瘯

缃戠粶寮傚父
鈫?api-unreachable

storage-unavailable
鈫?鏁版嵁搴撴崯鍧?/ 涓嶅彲鎵撳紑闃绘柇椤?
```

绂佹鍦?`ready` 涔嬪墠璋冪敤浠讳綍涓氬姟 list / search / write API銆?

### 2. 杩佺Щ鍚戝

鏈€灏忔楠わ細

```text
姝ラ 1锛氳鏄庢棫 IndexedDB 鏃犳硶琚?Node 鑷姩璇诲彇銆?
姝ラ 2锛氳姹傜敤鎴疯繑鍥炴棫宸ヤ綔鍙般€佸師 Profile / origin 瀵煎嚭瀹屾暣 JSON銆?
姝ラ 3锛氶€夋嫨 JSON 鏂囦欢銆?
姝ラ 4锛氭樉绀衡€滄鍦ㄩ獙璇佸拰鍐欏叆 SQLite鈥濓紝鏈熼棿绂佺敤閲嶅鎻愪氦涓庡叧闂€?
姝ラ 5锛氭垚鍔熷悗 health 閲嶆柊璇锋眰锛涗粎 ready 鍚庤繘鍏ュ伐浣滃彴銆?
```

澶辫触锛?

```text
淇濈暀宸查€夋嫨鐨勬枃浠跺悕绉颁笌鍙啀娆￠€夋嫨鎿嶄綔
鏄剧ず API 杩斿洖鐨勫彲琛屽姩閿欒
涓嶅緱鏄剧ず浠讳綍鈥滆縼绉诲畬鎴愨€濇垨绌哄伐浣滃彴
```

鍓嶇涓嶄細涔熶笉寰楄鍙?IndexedDB銆佽В鏋愬叧绯汇€佽绠?hash 鎴栧啓涓诲簱銆?

### 3. 鏁版嵁搴撻樆鏂〉鏂囨

API 鏃犳硶杩炴帴锛?

```text
鏍囬锛氭湰鏈烘暟鎹簱鏈氨缁?
璇存槑锛氭棤娉曡繛鎺ユ湰鏈?Local API銆備綘鐨勪簨椤瑰皻鏈璇诲彇锛涜繖涓嶆槸鈥滄殏鏃犱簨椤光€濄€?
鎿嶄綔锛氶噸璇曡繛鎺?
杈呭姪锛氳鍚姩 Local API锛屽苟璁块棶 http://127.0.0.1:32145銆?
```

瀛樺偍涓嶅彲鐢細

```text
鏍囬锛氭湰鍦版暟鎹簱涓嶅彲鐢?
璇存槑锛氭湰鏈烘暟鎹簱鏃犳硶鎵撳紑鎴栨棤娉曢€氳繃瀹屾暣鎬ф鏌ワ紝绯荤粺娌℃湁鍔犺浇浠讳綍鏁版嵁銆?
璺緞锛歿databasePath锛屼粎 health 鏄庣‘鎻愪緵鏃跺睍绀簘
鎿嶄綔锛氶噸璇曟鏌?/ 鏌ョ湅鎭㈠姝ラ
鎻愮ず锛氳鍏堜繚鐣欏師鏂囦欢鍓湰锛屽啀浠庡畬鏁?JSON 澶囦唤鎭㈠銆?
```

杩佺Щ寮傚父閬楃暀锛?

```text
鏍囬锛氭湰鏈烘暟鎹縼绉绘湭瀹屾垚
璇存槑锛氱郴缁熶笉浼氱寽娴嬫垨瑕嗙洊褰撳墠鏈満鏁版嵁搴撱€?
鎿嶄綔锛氭煡鐪嬭縼绉绘楠?/ 閲嶈瘯鐘舵€佹鏌?
```

## 銆愬叓銆丳hase 1 鑷姩鍖栨祴璇曟竻鍗曘€?

### 1. 鍩虹璁炬柦涓?Schema

1. 涓存椂鐩綍涓嶅瓨鍦ㄦ椂鍙垱寤烘暟鎹簱鍜?Schema v1锛?
2. `schema_migrations` 姝ｇ‘璁板綍 v1锛涢噸澶嶆墦寮€涓嶉噸澶嶆墽琛岋紱
3. `foreign_keys = ON`銆乄AL銆丗ULL銆乥usy_timeout 宸茶缃紱
4. `quick_check = ok` 鏃跺彲鎵撳紑锛涢潪 `ok` 鎴栨姏閿欐椂杩斿洖绋冲畾 `integrity-check-failed`锛?
5. migration DDL 浠讳竴姝ュけ璐ユ椂涓嶈褰曠増鏈€佷笉鍙骇鐢熷崐鍗囩骇 schema锛?
6. 鏁版嵁搴撹矾寰勪笉鍦ㄩ」鐩洰褰曠殑杩愯鏃舵柇瑷€鐢?Local API Phase 2 瑕嗙洊锛孭hase 1 鍙獙璇佷换鎰忎紶鍏ユ祴璇曡矾寰勫彲鎺ф墦寮€銆?

### 2. Item 涓?P0 鍥炲綊

蹇呴』杩佺Щ骞堕€氳繃鐜版湁鍚岀瓑娴嬭瘯锛?

```text
鍒涘缓浜嬮」 + 鍒濆 ItemStatusEvent
鐘舵€佽縼绉讳笌鍞竴浜嬩欢
startExecution锛歵rim銆佺┖鍊笺€佷笉鍙噸鍐欍€佸け璐?rollback
updateContent锛氭墍鏈夋湭鍒犻櫎鐘舵€併€佷粎鏇存柊 content / updatedAt
updateContent 脳 changeStatus
updateContent 脳 delete / restore
purgeDeletedBefore 脳 restore
宸插垹闄や簨椤规洿鏂版嫆缁濅笖涓嶅娲?
鐘舵€佷簨浠跺け璐?rollback
```

SQLite 涓撻」锛?

```text
浜嬪姟鍐呮ā鎷熺浜屾潯璇彞澶辫触
鈫?Item銆乪vent銆乻tartAction 瀹屾暣 rollback

SQLITE_BUSY / 閿佽秴鏃?
鈫?鍙瘑鍒姏閿?
鈫?鏃犻儴鍒嗗啓鍏?
```

### 3. 澶嶇洏銆佹柟娉曚笌鐢熷懡鍛ㄦ湡

蹇呴』瀹屾暣鍥炲綊锛?

```text
completeReview 鍏ㄦ湁鎴栧叏鏃?
褰㈡垚 / 浠呴獙璇?/ 淇鏂规硶
MethodVersion銆丮ethodEvidence relation銆丮ethodApplication 鍐荤粨鐗堟湰
鏂规硶鍥炴敹绔欍€佹仮澶嶃€佸埌鏈熸案涔呮竻鐞嗐€丮ethodTombstone
姘镐箙娓呯悊澶辫触 rollback
浜嬮」姘镐箙娓呯悊鍚庢柟娉曟潵婧?/ 澧撶鏈€鍚庡紩鐢ㄥ洖鏀?
getContextResultForItem 浜旂被鐘舵€?
listSourceDisplaysForItems 鎵归噺鐘舵€併€佹柇瑁傛棤鏍囬銆佸彧璇绘棤鍓綔鐢?
```

### 4. 澶囦唤 Repository

1. `exportData()` 鍦?read transaction 杩斿洖 9 涓畬鏁撮泦鍚堬紱
2. `replaceData()` 鎴愬姛鍚庢暟鎹笌杈撳叆涓ユ牸涓€鑷达紱
3. 浠讳竴闆嗗悎 insert 澶辫触瀹屾暣 rollback锛?
4. restore 涓嶆敼鍙?system_metadata锛?
5. `assertSqliteBusinessIntegrity()` 瀵规瘡涓喕缁撳紩鐢ㄩ敊璇垎鍒嫆缁濓紱
6. 鐜版湁 IndexedDB 瀵煎嚭鐨?v2 `BackupData` 瀵煎叆 SQLite 鍚庡鍑轰竴鑷达紱
7. v1 / v2 `BackupApplicationService.parseAndValidate()` 缁х画閫氳繃宸叉湁鍏煎娴嬭瘯銆?

### 5. 楠岃瘉鍛戒护

Phase 1 鏈€浣庡懡浠わ細

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build:h5
corepack pnpm exec git diff --check
```

> `build:h5` 鍦?Phase 1 鏈慨鏀瑰墠绔椂浠嶉渶鎵ц涓哄伐绋嬪洖褰掞紱涓嶅緱灏嗗叾褰撲綔 SQLite 鎴?Local API 楠屾敹鏇夸唬銆?

姣忔瀹屾垚涓€杞伐绋嬮獙璇侊紝鎸夐」鐩鍒欏悓鏃ヨ拷鍔狅細

```text
docs/daily-contributions/YYYY-MM-DD.md
```

鍙褰曞疄闄呭鍔犻」銆佷慨澶嶉」涓庢湭瀹屾垚椤癸紱涓嶈褰曢獙璇佸懡浠ゆ垨杩囩▼銆?

## 銆愪節銆丳hase 1 瀹屾垚闂ㄦ涓庡悗缁祦杞€?

Phase 1 涓嶆槸鈥滆兘鍐欏叆涓€鏉?SQLite Item鈥濆嵆瀹屾垚銆傚繀椤诲悓鏃舵弧瓒筹細

```text
鎵€鏈夌幇鏈?Repository Contracts 閮芥湁 SQLite 瀹炵幇
宸插叧闂?P0 鐨勪簨鍔′竴鑷存€ф祴璇曞畬鏁磋縼绉诲苟閫氳繃
鏂规硶澧撶銆佹柇瑁傚叧鑱斻€佸浠?v1 / v2銆乻tartAction銆乧ontent銆佸洖鏀剁珯鍧囨棤鏁版嵁涓㈠け
SQLite 涓存椂鏂囦欢瀵煎叆 / 瀵煎嚭寰€杩斾竴鑷?
涓嶆敼娴忚鍣ㄦ棩甯歌閰嶏紝涓嶅舰鎴?IndexedDB + SQLite 鍙屽啓
鏃?.db / JSON 鐪熷疄鏁版嵁杩涘叆 Git
```

浜や粯缁?QA 鐨勬姤鍛婂繀椤诲寘鍚細

```text
淇敼鏂囦欢
Contract 鏄犲皠
DDL 涓?schema version
浜嬪姟瀹炵幇璇存槑
澶辫触 rollback 璇佹嵁
澶囦唤璇诲啓寰€杩旇瘉鎹?
鑷姩鍖栧疄闄呯粨鏋?
纭鏈慨鏀圭殑涓氬姟璇箟鍜屽墠绔竟鐣?
```

娴佽浆锛?

```text
Application / Repository 宸ョ▼甯堬細Phase 1 瀹炴柦
鈫?QA锛歋QLite 鏁版嵁灞傚畾鍚戦獙鏀?
鈫?鏋舵瀯甯堬細SQLite Contract 绋冲畾瀹￠槄
鈫?Application / Repository 宸ョ▼甯堬細Phase 2 Local API銆佽縼绉汇€佹仮澶嶇偣
```

## 銆愪氦浠樼粰鐮斿彂鐨勬妧鏈害鏉熴€?

```text
鏈枃浠朵粎鎺堟潈 Phase 1 SQLite 鏁版嵁灞傚疄鏂姐€?

蹇呴』锛?
- 浣跨敤 better-sqlite3锛?
- 澶嶇敤鏃㈡湁 Contracts / Domain / Application 璇箟锛?
- 鍦ㄦ瘡涓琛ㄥ啓鍏ヤ腑浜嬪姟鍐呴噸鏂拌鍙栵紱
- 浠?SQL transaction 淇濇寔鍘熷瓙鎬э紱
- 浠?BackupData 瑙勮寖鍖栭€愬瓧娈垫瘮瀵逛繚璇佸鍏?/ 瀵煎嚭涓€鑷达紱
- 淇濈暀 MethodTombstone 鍘嗗彶鍏崇郴锛?
- 杩佺Щ鎵€鏈夊凡鍏抽棴 P0 鐨勮嚜鍔ㄥ寲娴嬭瘯銆?

涓嶅緱锛?
- 鍐?Local API 鎴栧墠绔〉闈紱
- 璁?H5 杩炴帴 SQLite锛?
- 淇敼 IndexedDB 鏃ュ父宸ヤ綔鍙帮紱
- 鏂板闀挎湡鍙屽啓锛?
- 鏀圭姸鎬佹満銆佸浠界増鏈€佷笟鍔℃暟鎹ā鍨嬶紱
- 鎻愪氦鏁版嵁搴撴枃浠躲€乄AL銆丼HM 鎴栫湡瀹?JSON 鏁版嵁锛?
- 鐢ㄥ閿?cascade 鍙栦唬鏃㈡湁姘镐箙娓呯悊缂栨帓銆?
```
