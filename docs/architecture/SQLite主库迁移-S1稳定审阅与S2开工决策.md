# SQLite 涓诲簱杩佺Щ 鈥?S1 鏋舵瀯绋冲畾瀹￠槄涓?S2 寮€宸ュ喅绛?

> 鐘舵€侊細**S1 鍩虹璁炬柦閫氳繃鏋舵瀯绋冲畾瀹￠槄锛涙巿鏉?S2锛欼tem / Review / Backup SQLite Repository 涓庤嚜鍔ㄥ寲娴嬭瘯銆?*
> 鍓嶇疆锛歚docs/architecture/SQLite涓诲簱杩佺Щ-鍒嗛樁娈靛疄鏂藉熀绾夸笌S1浠诲姟涔?md`銆?
> 閲嶈鐘舵€侊細**SQLite 浠嶆槸鍊欓€変富搴擄紱IndexedDB 浠嶆槸褰撳墠杩愯涓殑鍞竴涓诲簱銆?*

## 銆愭妧鏈粨璁猴細鏈夋潯浠跺彲琛屻€?

S1 瀹為檯瀹炵幇涓庝骇鍝佸垎闃舵杈圭晫涓€鑷达細

```text
packages/storage-sqlite
鈫?鐪熷疄 better-sqlite3 native binding
鈫?鏄惧紡娴嬭瘯涓存椂璺緞
鈫?PRAGMA + Schema v1 + quick_check + 鍩虹 transaction helper
```

鏈彂鐜颁互涓嬭秺鐣屽疄鐜帮細

```text
涓氬姟 Repository
Local API
娴忚鍣ㄥ墠绔敼鍔?
Application 涓氬姟璇箟鍙樻洿
IndexedDB 璇诲啓璺緞鍒囨崲
鐪熷疄涓汉鏁版嵁瀵煎叆
鍙屽啓鎴栬縼绉婚€昏緫
```

S1 鐨勫疄闄呭疄鐜板凡楠岃瘉 Schema v1銆乣schema_migrations`銆佺洰褰曞垱寤恒€乣foreign_keys`銆乄AL銆丗ULL 鍚屾銆乥usy timeout銆乣quick_check` 澶辫触鍏抽棴銆丼chema 澶辫触鍏抽棴鍜屽悓姝ヤ簨鍔?rollback銆俀A 鎶ュ憡鏄剧ず鍏ㄩ噺宸ョ▼楠岃瘉閫氳繃銆?

鍥犳锛屽厑璁歌繘鍏?**S2锛欼tem / Review / Backup Repository**銆?

杩欓」鎺堟潈涓嶆槸鍓嶇鍒囨崲鎺堟潈锛屼篃涓嶆槸 SQLite 涓诲簱鍒囨崲鎺堟潈銆?

## 銆愪竴銆丼1 鏋舵瀯瀹￠槄缁撹銆?

### 宸茬‘璁ょǔ瀹氱殑鍩虹璁炬柦 Contract

```ts
openKnowledgeDatabase({ databasePath })
鈫?SqliteKnowledgeDatabase
```

宸叉彁渚涳細

```ts
databasePath
schemaVersion
close()
runInTransaction()
runInReadTransaction()
```

鍏抽敭瀹炵幇纭锛?

```text
mkdir(parent, recursive)
鈫?better-sqlite3 鎵撳紑鎸囧畾鏂囦欢
鈫?foreign_keys = ON
鈫?journal_mode = WAL
鈫?synchronous = FULL
鈫?busy_timeout = 5000
鈫?applySchemaMigrations
鈫?quick_check
鈫?鎴愬姛鍚庤繑鍥?handle
```

澶辫触鏃跺彞鏌勫叧闂苟鎶涘嚭缁撴瀯鍖?`SqliteStorageOpenError`锛?

```text
directory-unavailable
database-open-failed
schema-migration-failed
integrity-check-failed
```

杩欐弧瓒?S1 鍩虹璁炬柦鍊欓€夊簱鐨勮姹傘€?

### S1 娴嬭瘯璇佹嵁宸茶鐩?

```text
鐪熷疄 native binding锛氭墦寮€ / 寤鸿〃 / 鍐欏叆 / 鍏抽棴 / 閲嶅紑 / 璇诲彇
Schema v1锛氶娆″垱寤恒€佷簩娆℃墦寮€涓嶉噸澶嶈縼绉汇€佹棦鏈夋暟鎹繚鐣?
PRAGMA锛歠oreign_keys銆乄AL銆丗ULL銆乥usy_timeout
浜嬪姟锛氱浜屾潯鍐欏け璐ユ椂绗竴鏉?rollback
寮傛 transaction callback锛氭槑纭嫆缁?
澶辫触淇濇姢锛歋chema migration / quick_check 澶辫触鍏抽棴涓斾笉瑕嗙洊鍘熸枃浠?
DDL锛氱姸鎬?CHECK銆丷eview 鍞竴銆丮ethodApplication 鍞竴銆丮ethodVersion 鍞竴銆両tem 澶栭敭涓庡纰戝巻鍙插紩鐢ㄨ竟鐣?
```

### S1 灏氫笉鏋勬垚鐨勮兘鍔?

```text
涓嶆槸 SQLite Repository 璇箟绛変环鎬?
涓嶆槸 SQLite BackupData 瀵煎叆 / 瀵煎嚭
涓嶆槸 Item / Review P0 涓€鑷存€ц瘉鏄?
涓嶆槸鐪熷疄 IndexedDB 鈫?SQLite 鏁版嵁杩佺Щ
涓嶆槸 Local API / 娴忚鍣ㄥ伐浣滃彴
涓嶆槸 SQLite 涓诲簱鍒囨崲
```

## 銆愪簩銆丼QLite 瀹氫綅涓庡叡瀛樿竟鐣屻€?

浜у搧姝ゅ墠宸插喕缁擄紝鏋舵瀯鍐嶆纭锛?

```text
S1鈥揝5锛?
IndexedDB = 褰撳墠鍞竴杩愯涓诲簱
SQLite = 鍊欓€夊熀纭€璁炬柦 / 鍊欓€夋暟鎹眰

S6 浜у搧楠屾敹鍚庯細
SQLite = 鍞竴鍙俊涓诲簱
IndexedDB = 浠呮棫鏁版嵁涓€娆℃€?JSON 杩佺Щ鏉ユ簮
```

S2 寮€鍙戞湡闂村厑璁镐袱濂?Repository 鍦?*涓嶅悓娴嬭瘯璺緞**涓悓鏃跺瓨鍦細

```text
IndexedDb*Repository
鈫?鐜版湁娴忚鍣ㄥ伐浣滃彴涓庢棦鏈夊洖褰掓祴璇?

Sqlite*Repository
鈫?鐙珛涓存椂 SQLite 娴嬭瘯鏂囦欢涓?S2 娴嬭瘯
```

杩欎笉鏄暱鏈熷弻鍐欙紝鍥犱负锛?

```text
鍚屼竴鐢ㄦ埛鎿嶄綔涓嶅緱鍚屾椂鍐?IndexedDB 涓?SQLite
鐢熶骇娴忚鍣ㄤ粛鍙啓 IndexedDB
S2 SQLite 浠呭啓鍚堟垚娴嬭瘯鏁版嵁
```

涓ユ牸绂佹锛?

```text
鍦ㄩ〉闈㈡搷浣滃悗鍚屾椂璋冪敤涓ゅ Repository
鎶婂綋鍓?IndexedDB 鏁版嵁澶嶅埗鍒版祴璇?SQLite 鍐嶇户缁悓姝?
鍦ㄧ湡瀹?%LOCALAPPDATA% 涓荤洰褰曞啓鍊欓€?SQLite 鏁版嵁
璁╂祻瑙堝櫒璇诲彇鍊欓€?SQLite 鐨勪换浣曠粨鏋?
```

## 銆愪笁銆丼2 鐩爣涓庢渶灏忚寖鍥淬€?

### S2 鐩爣

鍦ㄦ瘡娴嬭瘯鐙珛涓存椂 SQLite 鏂囦欢涓紝瀹炵幇骞堕獙璇侊細

```text
ItemRepository
ReviewRepository
BackupRepository
```

S2 鍙瘉鏄庝笁绫?Contracts 鍦?SQLite 涓彲鍙俊鎵ц锛涗笉瀹炴柦鏂规硶浣撶郴銆佸畬鏁?ReviewWorkflow銆佹悳绱€佷华琛ㄧ洏銆丄PI 鎴栧墠绔€?

### S2 鎺堟潈鑼冨洿

鍏佽淇敼锛?

```text
packages/storage-sqlite/src/**
packages/storage-sqlite/package.json锛堜粎涓?S2 蹇呴渶鐨勫寘鍐呴厤缃級
tests/sqlite-item-repository.test.ts
tests/sqlite-review-repository.test.ts
tests/sqlite-backup-repository.test.ts
tests/sqlite-s2-*.test.ts锛堝繀瑕佺殑鍚堟垚娴嬭瘯锛?
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

濡?TypeScript project references 鎴栨牴 workspace 鏋勫缓鍙戠幇瀛樺偍鍖呭鍑洪厤缃己鍙ｏ紝鍙仛鏈€灏忛厤缃慨澶嶏紱蹇呴』鍦ㄤ氦浠樻姤鍛婇€愰」璇存槑銆?

浠嶇姝慨鏀癸細

```text
apps/client/**
apps/local-api/**
packages/local-api-client/**
packages/application/**
packages/contracts/**
packages/storage-indexeddb/**
鐜版湁 BackupDocument 鐗堟湰 / BackupData 瀛楁
Domain 鐘舵€佹満
浠讳綍鐪熷疄鐢ㄦ埛鏁版嵁鐩綍
```

### S2 闈炵洰鏍?

```text
MethodRepository
MethodApplicationRepository
ReviewWorkflowRepository.complete()
SearchRepository
DashboardRepository
MethodTombstone 涓氬姟鐢熷懡鍛ㄦ湡
鐪熷疄 IndexedDB JSON 瀵煎叆
SQLite 鑷姩鎭㈠鐐?
HTTP / Local API
鍓嶇 API client銆乭ealth gate銆佽縼绉诲悜瀵?
```

`ReviewRepository` 鍙疄鐜板熀纭€锛?

```text
create
getById
getByItemId
delete
```

瀹冧笉绛変簬 `completeReview()`銆傚畬鏁村鐩樺伐浣滄祦灞炰簬 S4锛屼笖蹇呴』绛?S3 鐨勬柟娉曟暟鎹眰瀹屾垚鍚庡疄鐜般€?

## 銆愬洓銆丼2 Contracts 涓庡疄鏂界害鏉熴€?

### 1. 宸ュ巶鎵╁睍

S2 灏?`packages/storage-sqlite/src/index.ts` 鎵╁睍涓哄彧鍖呭惈宸插畬鎴愮殑 Contract锛?

```ts
export interface SqliteS2RepositoryBundle {
  database: SqliteKnowledgeDatabase
  itemRepository: ItemRepository
  reviewRepository: ReviewRepository
  backupRepository: BackupRepository
}

export function createSqliteS2Repository(
  databasePath: string,
): SqliteS2RepositoryBundle
```

涓嶅緱鎻愬墠鍛藉悕涓猴細

```text
createSqliteRepository
createProductionSqliteRepository
createLocalApiRepository
```

鍘熷洜锛歋2 鍙鐩栭儴鍒?Contracts锛屼笉搴斾吉瑁呬负鍙浛浠ｅ叏閲忓瓨鍌ㄧ粍鍚堟牴銆?

### 2. `SqliteItemRepository` 蹇呴』瀹炵幇

```ts
ItemRepository.create
getById
list
listDeleted
listStatusEvents
changeStatus
startExecution
updateContent
delete
restore
purgeDeletedBefore
```

鎵€鏈?Item 鍐欏叆涓嶅彉閲忎繚鎸佷笌鐜版湁 IndexedDB 瀹炵幇涓€鑷达細

#### `create()`

```text
鏍囬 trim 鍚庝笉寰椾负绌?
鍒涘缓 Item
鍒涘缓鍒濆 ItemStatusEvent锛坒romStatus 缂哄け锛宼oStatus = 鍒濆鐘舵€侊級
鈫?鍚屼竴 write transaction
```

#### `changeStatus()`

```text
write transaction
鈫?SELECT 褰撳墠 Item
鈫?涓嶅瓨鍦ㄦ垨 deletedAt 瀛樺湪锛氫簨椤逛笉瀛樺湪
鈫?assertTransition(current.status, target)
鈫?浠呮敼 status / updatedAt
鈫?INSERT ItemStatusEvent
鈫?commit / rollback
```

#### `startExecution()`

```text
write transaction
鈫?浜嬪姟鍐呰鍙栧綋鍓?Item
鈫?item 蹇呴』涓烘湭鍒犻櫎 idea_to_try
鈫?assertTransition(idea_to_try, doing)
鈫?宸叉湁 startAction锛氭嫆缁濋噸鍐?
鈫?杈撳叆 trim锛涚┖鍊间笉鍐?startAction
鈫?鍚屾椂鍐?Item(status = doing, 鍙€?startAction, updatedAt)
鈫?鍚屾椂鍐?idea_to_try 鈫?doing Event
鈫?浠讳竴姝ュけ璐ユ暣浣?rollback
```

涓嶅緱鐢?`changeStatus()` 鍚庣浜屾 SQL 鏇存柊 `start_action`銆?

#### `updateContent()`

```text
write transaction
鈫?浜嬪姟鍐呰鍙栨渶鏂?Item
鈫?涓嶅瓨鍦ㄦ垨宸插垹闄わ細浜嬮」涓嶅瓨鍦?
鈫?trim input.content
鈫?浠呮洿鏂?content / updatedAt
鈫?涓嶅啓 ItemStatusEvent
鈫?涓嶆敼 status銆乻tartAction 鎴栧叾浠栧瓧娈?
```

浜у搧宸插喕缁擄細鎵€鏈夋湭鍒犻櫎 Item 鐘舵€侀兘鍏佽缂栬緫 `content`锛涗笉寰楅噸鏂版敹绐勪负 `idea_to_try`銆?

#### `delete()` / `restore()`

```text
delete锛氫簨鍔″唴閲嶈锛涗粎璁剧疆 deletedAt / updatedAt锛涘凡鍒犻櫎 idempotent
restore锛氫簨鍔″唴閲嶈锛涗粎绉婚櫎 deletedAt銆佹洿鏂?updatedAt锛涗笉鍐欑姸鎬佷簨浠?
```

#### `purgeDeletedBefore()`

S2 蹇呴』鍏堝鍒诲綋鍓?Item 娓呯悊璇箟锛岃€屼笉鏄彧 `DELETE FROM items`锛?

```text
浜嬪姟鍐呮煡璇?deletedAt <= cutoff 鐨?Item
鈫?璇诲彇瀵瑰簲 Review銆両temStatusEvent銆両temLink銆丮ethodEvidence銆丮ethodApplication 鐨勫叧鑱旀儏鍐?
鈫?鎸夋棦鏈?IndexedDB Repository 璇箟鏄惧紡娓呯悊 / 鏇存柊
鈫?淇濊瘉涓嶇暀涓嬩細瀵艰嚧 BackupData 涓嶅彲鎭㈠鐨勫繀濉紩鐢?
```

浣?S2 灏氭湭瀹炵幇鏂规硶琛?Repository锛屼笉寰楀湪娌℃湁鍐荤粨鏄犲皠涓庢祴璇曞墠鈥滅寽娴嬧€?MethodEvidence / MethodApplication / Tombstone 鐨勬竻鐞嗚鍒欍€?

鍥犳 S2 鐨勫叿浣撹竟鐣屽喕缁撲负锛?

```text
S2 鍙互瀹炵幇 purgeDeletedBefore() 鐨勬棤鍏宠仈 Item 璺緞锛屼互鍙?
涓?Review / ItemStatusEvent / ItemLink 鐨勬樉寮忔竻鐞嗚矾寰勶紱

鑻ュ緟娓呯悊 Item 瀛樺湪 MethodEvidence銆丮ethodApplication銆丮ethodVersion 鎴?Tombstone 鐩稿叧寮曠敤锛?
鈫?蹇呴』鎷掔粷娓呯悊骞舵姏绋冲畾閿欒 `SQLite 鏂规硶鍏宠仈娓呯悊灏氭湭瀹炴柦`锛?
鈫?涓嶅厑璁搁儴鍒嗗垹闄わ紱
鈫?涓嶅緱鍥?S2 鏂逛究鍒犻櫎銆佺疆绌烘垨浼€犺繖浜涘叧绯汇€?
```

杩欐槸**鍊欓€?SQLite 鐨勫畨鍏ㄦ嫆缁?*锛屼笉鏄渶缁堜骇鍝佽涔夋敼鍙橈紱S3 灏嗗湪鏂规硶鐢熷懡鍛ㄦ湡鏁版嵁灞備腑瑙ｉ櫎璇ラ檺鍒跺苟浠ョ幇鏈夎涓轰负鍑嗐€傜敱浜?SQLite 灏氶潪涓诲簱锛岃闄愬埗涓嶄細褰卞搷鐪熷疄鐢ㄦ埛銆?

### 3. `SqliteReviewRepository` 蹇呴』瀹炵幇

```text
create
getById
getByItemId
delete
```

绾︽潫锛?

```text
Review 鍐呭瀛楁涓庣幇鏈?Contract 瀹屽叏涓€鑷达紱鍐欏叆鏃?trim 瑙勫垯涓?IndexedDB 瀵归綈銆?
涓€浜嬮」鏈€澶氫竴涓?Review锛岀敱 UNIQUE(item_id) 涓?Repository 涓氬姟閿欒鍏卞悓淇濊瘉銆?
Review.delete() 鍙兘浣滀负鍚庣画 workflow / purge 鍐呴儴鑳藉姏锛涘墠绔棤鏂板垹闄ゅ叆鍙ｃ€?
```

`ReviewRepository.create()` 涓嶅緱锛?

```text
鏀瑰彉 Item.status
鍐?ItemStatusEvent
鍒涘缓鏂规硶銆佽瘉鎹€佺増鏈€佸簲鐢ㄦ垨鏂版兂娉?
```

### 4. `SqliteBackupRepository` 鐨?S2 闄愬埗

S2 蹇呴』瀹炵幇瀹屾暣 Contract锛?

```ts
exportData(): Promise<BackupData>
replaceData(data: BackupData): Promise<void>
```

浣嗗綋鍓?SQLite 杩樻病鏈夊叏閮?Repository锛屽疄鐜颁粛闇€鑳藉澶勭悊 BackupData 鐨勫叏閮?9 涓泦鍚堬紝浠ヤ究涓?S5 绛変环鎬у瀹氬熀纭€銆?

S2 `BackupRepository` 绾︽潫锛?

```text
exportData()
鈫?鍦?single read transaction 璇诲彇鎵€鏈?9 涓笟鍔¤〃
鈫?DTO 鏄犲皠瀹屾暣淇濈暀 content銆乻tartAction銆乨eletedAt銆佸纰?versions

replaceData(data)
鈫?鍙帴鏀跺凡閫氳繃 BackupApplicationService.parseAndValidate() 鐨?BackupData
鈫?BEGIN IMMEDIATE
鈫?娓呯┖鍏ㄩ儴 9 涓笟鍔¤〃
鈫?鎸夊喕缁撻『搴忔彃鍏ュ叏閮?9 涓泦鍚?
鈫?鎵ц S2 鍙獙璇佺殑鍩虹寮曠敤瀹屾暣鎬ф鏌?
鈫?rollback 鎴?commit
```

S2 涓嶈嚜琛屽疄鐜?JSON parse銆乿1/v2 鍏煎鎴?BackupDocument 鐢熸垚锛涜繖浜涗粛鍦?Application 灞傦紝褰撳墠涓嶄慨鏀广€係2 娴嬭瘯鍙娇鐢ㄧ幇鏈?`BackupApplicationService` 鍜屽悎鎴?Repository adapter 楠岃瘉鍏惰緭鍏ョ鍚堥鏈燂紝浣嗕笉鏀?Application銆?

### 5. S2 涓氬姟瀹屾暣鎬ф鏌ュ垎灞?

S2 鍦?`replaceData()` 鍐呭繀椤绘鏌ワ細

```text
ItemStatusEvent 鈫?Item
Review 鈫?Item
MethodApplication 鈫?Item
ItemLink 鈫?Review / Item
Review.itemId 鍞竴
MethodApplication.itemId 鍞竴
MethodVersion(methodId, version) 鍞竴
Item.status 鍚堟硶
MethodEvidence.relation 鍚堟硶
MethodTombstone.versions_json 鍙В鏋愩€佺増鏈潎涓烘暣鏁?
Method 涓庡悓 ID Tombstone 涓嶅叡瀛?
```

瀵逛簬鏂规硶鐢熷懡鍛ㄦ湡鐨勬繁灞傝鍒欙細

```text
MethodEvidence / MethodApplication 寮曠敤 Method 鎴?Tombstone
鍐荤粨 methodVersion 瀛樺湪浜?MethodVersion 鎴?Tombstone versions
MethodVersion.sourceReviewId 鍙€夋柇瑁傚吋瀹?
```

S2 `replaceData()` 蹇呴』**瀹屾暣鎵ц褰撳墠 BackupApplicationService 宸叉牎楠屽悗鐨勭粨鏋滀繚鐣?*锛屼絾娣卞眰 Repository 琛屼负鍜?purge 璇箟涓嶅湪 S2 鏂板瀹炵幇銆傝嫢 SQL integrity helper 鏃犳硶鍙潬楠岃瘉鏌愰」锛屼笉寰楃寽娴嬶紱閫氳繃 Application 鏃㈡湁 `parseAndValidate()` 浣滀负鍞竴鎺ュ彈鍏ュ彛锛屼笖灏嗚椤规爣璁颁负 S3 / S5 蹇呴』琛ラ綈鐨勭嫭绔嬮獙璇併€?

浠讳綍澶囦唤鎻掑叆澶辫触銆佸敮涓€绾︽潫澶辫触鎴栧彲楠岃瘉鐨勫畬鏁存€уけ璐ワ細

```text
瀹屾暣 rollback
鈫?澶囦唤鏇挎崲鍓嶆暟鎹簱淇濇寔涓嶅彉
```

### 6. `system_metadata` 閾佸緥

```text
BackupData 涓嶅寘鍚?system_metadata銆?
S2 exportData() 涓嶅鍑哄畠銆?
S2 replaceData() 涓嶆竻绌恒€佷笉鍐欏叆瀹冦€?
```

杩欎繚璇佹湭鏉?IndexedDB 杩佺Щ metadata 涓嶄細琚櫘閫?JSON restore 鎰忓鎶归櫎銆?

## 銆愪簲銆丼2 蹇呴』杩佺Щ鐨?P0 鑷姩鍖栨祴璇曘€?

### A. Item 鍐欏叆涓庣姸鎬佷簨浠?

1. 鍒涘缓 Item 涓庡垵濮?Event 鍘熷瓙锛?
2. 闈炴硶 title 鎷掔粷锛屾棤 Item / Event锛?
3. 鎵€鏈夊悎娉曠姸鎬佽縼绉讳笌 Event 涓€鑷达紱
4. 鏃犳晥杩佺Щ鎷掔粷锛屽師 Item / Event 涓嶅彉锛?
5. `startExecution()` 闈炵┖銆佺┖鍊笺€佺┖鐧?trim銆佸凡鏈夊揩鐓ч噸鍐欐嫆缁濓紱
6. `items` 鏇存柊澶辫触鎴?event 鎻掑叆澶辫触鏃讹紝鐘舵€併€佷簨浠躲€乻tartAction 鍏?rollback锛?
7. `updateContent()` 瑕嗙洊鍏ㄩ儴 8 绉嶆湭鍒犻櫎鐘舵€侊紝娓呯┖鍚堟硶锛屼笉浜х敓 event锛?
8. 宸插垹闄?/ 涓嶅瓨鍦?Item 鍐呭鏇存柊鎷掔粷涓斾笉澶嶆椿锛?
9. `updateContent 脳 changeStatus` 鍙楁帶浜ら敊锛氭渶缁?content 涓?status 閮芥纭紝event 鍞竴锛?
10. `updateContent 脳 delete / restore`锛氫笉鍥炴粴鏈€鏂板唴瀹癸紝涓嶆剰澶栨仮澶嶏紱
11. `purgeDeletedBefore 脳 restore`锛氭仮澶嶅湪 purge write transaction 寮€濮嬪墠鎻愪氦鏃讹紝涓嶈兘琚竻鐞嗐€?

### B. Review 鍩虹 Contract

1. create / getById / getByItemId锛?
2. 閲嶅 Item Review 鎷掔粷锛?
3. Item 涓嶅瓨鍦ㄧ殑 Review 鐢卞閿?/ Repository 鏄庣‘鎷掔粷锛?
4. Review 瀛楁 trim銆佺┖鍊间笌鐜版湁 IndexedDB 璇箟涓€鑷达紱
5. delete 鍚庝笉鍙鍙栵紱
6. Review create / delete 澶辫触涓嶆薄鏌?Item 鎴栫姸鎬佷簨浠躲€?

### C. Item purge 鐨勯樁娈垫€у畨鍏ㄦ嫆缁?

1. 鏃犲叧鑱?deleted Item 杩囨湡鏃讹細Item銆丷eview銆丒vent銆両temLink 鎸夋棦鏈夋棤鏂规硶璺緞娓呯悊锛?
2. 鎭㈠宸插湪 purge transaction 鍓嶆彁浜わ細涓嶆竻鐞嗭紱
3. 浠讳綍 MethodEvidence / MethodApplication / MethodVersion / Tombstone 鍏宠仈瀛樺湪锛?
   - purge 鎷掔粷锛?
   - Item銆丷eview銆丒vent銆両temLink銆佹柟娉曠浉鍏虫暟鎹潎涓嶅彉锛?
   - 涓嶄骇鐢熷崐鍒犻櫎銆?

### D. Backup Repository

1. 鍚叏閮?9 闆嗗悎銆乣content`銆乣startAction`銆乣deletedAt` 鍜?Tombstone versions 鐨勫悎鎴?BackupData锛?
   - `replaceData()` 鍚?`exportData()` 瑙勮寖鍖栭€愬瓧娈典竴鑷达紱
2. `exportData()` 浣跨敤 read transaction锛屽彈鎺у啓鍏ヤ氦閿欎笉浜х敓璺ㄨ〃娣峰悎蹇収锛?
3. 浠绘剰闆嗗悎 insert 澶辫触锛氭仮澶嶅墠鏁版嵁搴撳畬鏁翠繚鐣欙紱
4. system_metadata 鍦?replace 鍓嶅悗涓嶅彉锛?
5. 缁撴瀯鍖栧繀濉?Item 寮曠敤鏂銆丮ethod / Tombstone 鍚?ID 鍐茬獊銆侀潪娉?tombstone versions 鎷掔粷骞?rollback锛?
6. 鐜版湁 v1 / v2 JSON 鍏煎娴嬭瘯淇濇寔閫氳繃锛?
7. 涓嶅緱鍥犱负 SQLite 瀛樺偍璁?`startAction`銆乣content`銆乣deletedAt` 杞崲涓虹┖瀛楃涓层€乶ull 鎴栦涪澶便€?

### E. 鏄庣‘涓嶅湪 S2 楠屾敹鐨勬祴璇?

```text
completeReview() 鍏ㄦ湁鎴栧叏鏃?
Method create / validate / revision
Method lifecycle / purge / tombstone reference count
鏂规硶鏂鍏宠仈璇绘ā鍨?
Search / Dashboard
鎵归噺鏂规硶鏉ユ簮灞曠ず
鐪熷疄 IndexedDB 鈫?SQLite 瀵煎叆
Local API 涓庢祻瑙堝櫒闃绘柇椤?
```

杩欎簺鏄?S3 / S4 / S5 / S6 鐨勯棬妲涳紝涓嶈兘鍥?S2 娴嬭瘯閫氳繃鑰屾爣璁颁负宸插畬鎴愩€?

## 銆愬叚銆丼2 QA 閫€鍑洪棬妲涖€?

QA 鍙湁鍚屾椂纭浠ヤ笅浜嬪疄锛屾墠鍙缓璁繘鍏?S3锛?

```text
S2 SQLite Repository 鍙湪涓存椂鍚堟垚鏁版嵁鏂囦欢杩愯
Item 鐘舵€?/ 浜嬩欢 / startAction / content / 鍒犻櫎鎭㈠ P0 瀹屾暣閫氳繃
Review 鍩虹 Contract 閫氳繃
BackupData 鍏ㄩ噺璇诲啓浜嬪姟銆乺ollback 涓?system_metadata 闅旂閫氳繃
Item purge 瀵规柟娉曞叧鑱旈噰鍙栧畨鍏ㄦ嫆缁濊€岄潪鐮村潖鎬х寽娴?
褰撳墠娴忚鍣?IndexedDB 鐢熶骇璺緞鏈淇敼
鏈嚭鐜板弻鍐欍€佸墠绔€丠TTP銆佺湡瀹炴暟鎹縼绉绘垨涓诲簱鍒囨崲
```

QA 鎶ュ憡蹇呴』浣跨敤鍑嗙‘琛ㄨ堪锛?

```text
SQLite S2 鍊欓€夋暟鎹眰宸查€氳繃瀹氬悜楠岃瘉銆?
IndexedDB 浠嶄负褰撳墠鍞竴杩愯涓诲簱銆?
```

## 銆愪竷銆丼3 棰勫憡锛屼笉鎺堟潈銆?

S3 灏嗗疄鐜板拰瑙ｉ櫎 S2 鐨勬柟娉曞叧鑱?purge 瀹夊叏鎷掔粷锛岃寖鍥村寘鎷細

```text
MethodRepository
MethodApplicationRepository
MethodVersion
MethodEvidence
MethodTombstone
鏂规硶鍥炴敹绔?/ 鎭㈠ / 鍒版湡姘镐箙娓呯悊
鏂鏂规硶鍏宠仈涓婁笅鏂?
浜嬮」姘镐箙娓呯悊鍚庣殑寮曠敤娓呯悊涓庡纰戞渶鍚庡紩鐢ㄥ洖鏀?
```

S3 寮€宸ュ墠闇€鍗曠嫭鏋舵瀯瀹￠槄锛屼笉寰楀湪 S2 椤烘墜瀹炵幇銆?

## 銆愪氦浠樼粰鏁版嵁灞傚伐绋嬪笀鐨勬妧鏈害鏉熴€?

```text
S1 宸查€氳繃锛岀幇鎺堟潈 S2銆?

浠呭疄鐜帮細
- SqliteItemRepository锛?
- SqliteReviewRepository锛?
- SqliteBackupRepository锛?
- createSqliteS2Repository 娴嬭瘯缁勫悎鏍癸紱
- S2 涓存椂 SQLite 鍚堟垚鏁版嵁鑷姩鍖栨祴璇曘€?

蹇呴』锛?
- 澶嶇敤鐜版湁 ItemRepository / ReviewRepository / BackupRepository Contracts锛?
- 缁存寔浜嬪姟鍐呴噸鏂拌鍙栧拰宸插叧闂?P0 鐨勪氦閿欎繚鎶わ紱
- 淇濇寔 startAction銆乧ontent銆乨eletedAt銆両temStatusEvent 鍘熷瓙浜嬪疄锛?
- BackupData 璇诲啓 9 闆嗗悎涓?system_metadata 涓庢櫘閫?restore 闅旂锛?
- 閬囧埌鏂规硶鍏宠仈 Item purge 鏃跺畨鍏ㄦ嫆缁濓紝涓嶇寽娴嬫垨閮ㄥ垎娓呯悊锛?
- 鍦ㄦ姤鍛婁腑澹版槑 SQLite 浠嶆槸鍊欓€変富搴撱€?

绂佹锛?
- Method / ReviewWorkflow / Search / Dashboard 瀹炵幇锛?
- Local API銆丠TTP銆佸墠绔€佽縼绉诲悜瀵硷紱
- 淇敼 IndexedDB 鎴?Application / Contracts / Domain锛?
- 鐪熷疄鏁版嵁瀵煎叆銆佸弻鍐欐垨鍓嶇鍒囨崲锛?
- 瀹ｇО SQLite 宸插畬鎴愪富搴撹縼绉汇€?

瀹屾垚鍚庯細
鏁版嵁灞傚伐绋嬪笀 鈫?QA S2 瀹氬悜楠屾敹 鈫?鏋舵瀯甯?S2 绋冲畾瀹￠槄 鈫?鎵嶅彲鐢宠 S3銆?
```
