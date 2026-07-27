# SQLite 涓诲簱杩佺Щ 鈥?鍒嗛樁娈靛疄鏂藉熀绾夸笌 S1 浠诲姟涔?

> 鐘舵€侊細**浜у搧宸插喕缁撳垎闃舵瀹炴柦銆傚綋鍓嶅彧鎺堟潈 S1锛歋QLite 鍩虹璁炬柦銆?*
> 浼樺厛绾э細P0 鏁版嵁涓绘潈涓庢満鍣ㄧ骇鎸佷箙鍖栥€?
> 鍏宠仈鏂囨。锛?
> - `docs/architecture/娴忚鍣↖ndexedDB鍒版湰鏈篠QLite涓诲簱杩佺Щ-鏋舵瀯璇勫.md`
> - `docs/architecture/娴忚鍣↖ndexedDB鍒版湰鏈篠QLite涓诲簱杩佺Щ-姝ｅ紡瀹炴柦浠诲姟涔?md`
> - `docs/architecture/娴忚鍣↖ndexedDB鍒版湰鏈篠QLite涓诲簱杩佺Щ-寮€宸ヨ鏍艰ˉ鍏?md`
>
> **鏈枃浠朵紭鍏堜簬涓婅堪鏂囨。涓换浣曗€滃畬鏁?SQLite Repository 鍙竴娆℃€у紑宸モ€濈殑琛ㄨ堪銆?*

## 銆愭妧鏈粨璁猴細鍙锛屼絾蹇呴』鍒嗛樁娈甸獙璇併€?

SQLite 杩佺Щ涓嶆槸鏅€?Repository 鏇挎崲锛岃€屾槸瑕嗙洊浜嬪姟涓€鑷存€с€佸巻鍙插叧绯汇€佸洖鏀剁珯銆佹柟娉曠敓鍛藉懆鏈熶笌澶囦唤鎭㈠鐨勬暟鎹簳搴ц縼绉汇€?

鍥犳锛屽湪 S1鈥揝5 鍏ㄩ儴瀹屾垚骞剁粡 QA 楠岃瘉鍓嶏紝绯荤粺鐘舵€佸浐瀹氫负锛?

```text
IndexedDB
= 褰撳墠杩愯涓殑鍞竴涓诲簱

SQLite
= 姝ｅ湪鍒嗛樁娈靛疄鏂戒笌楠岃瘉鐨勫€欓€変富搴?
```

涓嶅緱鎶娾€淪QLite 鏁版嵁搴撴枃浠跺彲鍒涘缓鈥濇垨鈥滈儴鍒?Repository 鍙繍琛屸€濇弿杩颁负瀹屾垚涓诲簱杩佺Щ銆?

鍙湁 S6 鐪熷疄杩佺Щ銆侀噸鍚獙璇佷笌浜у搧楠屾敹瀹屾垚鍚庯紝鎵嶅厑璁稿垏鎹负锛?

```text
SQLite
= 鍞竴鍙俊涓诲簱

IndexedDB
= 浠呮棫鏁版嵁涓€娆℃€ц縼绉绘潵婧?
```

## 銆愪竴銆佸垎闃舵鎬昏銆?

| 闃舵 | 鍏佽鑼冨洿 | 閫€鍑洪棬妲?| 鍒囨崲鐘舵€?|
|---|---|---|---|
| S1 | SQLite 鍩虹璁炬柦 | 鍘熺敓妯″潡鐪熷疄杩愯銆佹暟鎹簱瀹夊叏鍒涘缓銆丼chema v1銆丳RAGMA銆乣quick_check`銆佸紓甯镐笉瑕嗙洊鍘熸枃浠?| IndexedDB 缁х画涓诲簱 |
| S2 | Item / Review / Backup Repository | 鐘舵€併€佸惎鍔ㄥ姩浣溿€佸垹闄ゆ仮澶嶃€丳0 浜ら敊銆乣completeReview()`銆佸浠戒簨鍔￠€氳繃 | IndexedDB 缁х画涓诲簱 |
| S3 | 鏂规硶鐢熷懡鍛ㄦ湡鏁版嵁灞?| 鐗堟湰銆佽瘉鎹€佸簲鐢ㄣ€佸纰戙€佹案涔呮竻鐞嗕笌鏂鍏宠仈鍘熷瓙鎬ч€氳繃 | IndexedDB 缁х画涓诲簱 |
| S4 | 璇绘ā鍨嬩笌宸ヤ綔娴?| ReviewWorkflow銆丼earch銆丏ashboard銆佹壒閲忔柟娉曟潵婧愬睍绀轰笌鏃㈡湁 Contract 绛変环 | IndexedDB 缁х画涓诲簱 |
| S5 | 鍏ㄩ噺 BackupData 绛変环鎬?| 9 涓泦鍚堛€佺粨鏋勫寲鍏崇郴銆佹棫澶囦唤闄嶇骇銆侀潪娉曞浠芥嫆缁濄€丼QLite 瀵煎叆瀵煎嚭涓ユ牸绛変环 | IndexedDB 缁х画涓诲簱 |
| S6 | Local API銆佸墠绔垏鎹笌鐪熷疄杩佺Щ UAT | API / 闃绘柇椤点€佽縼绉汇€佹仮澶嶇偣銆侀噸鍚笌鎭㈠婕旂粌銆佷骇鍝侀獙鏀?| SQLite 鎵嶅彲鎴愪负涓诲簱 |

S1鈥揝5 涓换涓€闃舵澶辫触鎴栧瓨鍦ㄦ湭鍏抽棴 P0锛屽悗缁樁娈典笉寰椾互鈥滃厛鎺ュ墠绔啀琛ユ祴璇曗€濈殑鏂瑰紡缁曡繃銆?

## 銆愪簩銆丳0 涓嶅彉閲忋€?

浠ヤ笅浜嬪疄涓嶅緱鍥犫€滃厛璁?SQLite 璺戣捣鏉モ€濊€岄檷浣庨獙璇佹爣鍑嗭細

```text
completeReview()
鈫?Review銆両tem 鐘舵€併€佺姸鎬佷簨浠躲€佹柟娉?/ 璇佹嵁 / 鐗堟湰 / 鏂版兂娉曞叧绯诲叏鏈夋垨鍏ㄦ棤

purgeDeletedBefore() 鈫?restore()
鈫?浜嬪姟浜ら敊鍚庝笉寰楁竻鐞嗗凡鎭㈠浜嬮」鍙婂叾鍏宠仈浜嬪疄

startAction + idea_to_try 鈫?doing + ItemStatusEvent
鈫?鍚屼簨鍔″師瀛愪繚瀛樻垨鍚屼簨鍔″洖婊?

鏂规硶姘镐箙娓呯悊 / MethodTombstone / Version / Evidence / Application
鈫?涓嶅緱浜х敓鍗婂啓鍏ャ€侀敊璇噸杩炴垨涓嶅彲瑙ｉ噴鏂

JSON 澶囦唤瀵煎嚭 / 瀵煎叆
鈫?鍏ㄩ泦鍚堛€佸彲閫夊瓧娈靛拰缁撴瀯鍖栧紩鐢ㄤ弗鏍肩瓑浠?
```

鏈**鐪熷疄 SQLite 鑷姩鍖栨祴璇?*璇佹槑鍓嶏紝涓嶈兘杩涘叆鍓嶇涓诲簱鍒囨崲銆?

## 銆愪笁銆丼1锛歋QLite 鍩虹璁炬柦瀹炴柦浠诲姟涔︺€?

### 銆怱1 鐩爣銆?

寤虹珛涓€涓彲鐪熷疄鎵撳紑銆佹鏌ャ€佸崌绾у苟瀹夊叏鍏抽棴鐨?SQLite 鍩虹璁炬柦灞傦紝涓哄悗缁?Repository 瀹炵幇鎻愪緵绋冲畾鏁版嵁搴撳彞鏌勩€?

S1 涓嶅疄鐜颁换浣曚笟鍔?Repository锛屼笉鍐欏叆鐪熷疄涓汉鏁版嵁锛屼笉鍒囨崲浠讳綍鍓嶇璺緞銆?

### 銆怱1 鎺堟潈鑼冨洿銆?

鍏佽淇敼锛?

```text
package.json
pnpm-lock.yaml
pnpm-workspace.yaml
.gitignore
packages/storage-sqlite/**
tests/sqlite-infrastructure.test.ts锛堟垨绛変环鍚堟垚娴嬭瘯鏂囦欢锛?
docs/architecture/**
docs/daily-contributions/YYYY-MM-DD.md
```

绂佹淇敼锛?

```text
apps/client/**
apps/local-api/**
packages/local-api-client/**
packages/application/**
packages/contracts/**
packages/storage-indexeddb/**
鐜版湁涓氬姟 Repository銆佺姸鎬佹満鎴?BackupDocument
README.md锛圫1 鏈舰鎴愮敤鎴峰彲杩愯鍏ュ彛锛?
```

### 銆怱1.1 better-sqlite3 鍘熺敓鏋勫缓銆?

鍏佽涓斿繀椤伙細

```text
鏂板 better-sqlite3
鎵瑰噯浠?better-sqlite3 鐨?pnpm 鍘熺敓鏋勫缓鑴氭湰
瀹屾垚鍚庢墽琛岀湡瀹?Node require / import銆佹墦寮€涓存椂 SQLite 鏂囦欢銆佸缓琛ㄣ€佸啓鍏ャ€佽鍙栦笌鍏抽棴楠岃瘉
```

绂佹锛?

```text
鎵瑰噯鍏朵粬琚?pnpm 鎷︽埅鐨勬湭鐭ヤ緷璧栨瀯寤鸿剼鏈?
浠呮牴鎹?node_modules 瀛樺湪鎴?pnpm 瀹夎鎴愬姛瀹ｇО椹卞姩鍙繍琛?
鍦ㄩ」鐩洰褰曘€丩OCALAPPDATA 姝ｅ紡鐩綍鎴栦换浣曠湡瀹炰釜浜虹洰褰曟墽琛屾祴璇曞啓鍏?
```

鏋勫缓瀹℃壒蹇呴』鏈€灏忓寲锛氬彧鍏佽 `better-sqlite3`銆傝嫢 pnpm 鍛戒护鏄剧ず棰濆渚濊禆涔熻姹傛墽琛岃剼鏈紝绔嬪嵆鍋滄骞舵姤鍛婏紝涓嶆墿澶ф壒鍑嗚寖鍥淬€?

### 銆怱1.2 娴嬭瘯鏁版嵁搴撹矾寰勩€?

S1 涓嶈Е纰帮細

```text
%LOCALAPPDATA%\Knowledge_Base\knowledge-base.db
```

鎵€鏈夎嚜鍔ㄥ寲娴嬭瘯鏁版嵁搴撳繀椤讳綅浜庢祴璇曚复鏃剁洰褰曪紝渚嬪锛?

```text
os.tmpdir()\knowledge-base-sqlite-tests\{random-id}\knowledge-base.test.db
```

姣忎釜娴嬭瘯鐙珛鐩綍 / 鏂囦欢锛沗afterEach` 鎴?`afterAll` 鍏抽棴 handle 鍚庨€掑綊鍒犻櫎娴嬭瘯鐩綍銆傛祴璇曞け璐ユ椂鍙繚鐣欒矾寰勪緵璇婃柇锛屼絾涓嶅緱璇皢鍏舵爣璁颁负鐢ㄦ埛鏁版嵁搴撱€?

### 銆怱1.3 S1 妯″潡鎺ュ彛銆?

鏂板鐩綍锛?

```text
packages/storage-sqlite/
  package.json
  tsconfig.json
  src/index.ts
  src/database.ts
  src/schema.ts
  src/errors.ts
```

S1 浠呭鍑哄熀纭€璁炬柦鑳藉姏锛?

```ts
export type SqliteStorageOpenErrorCode =
  | 'directory-unavailable'
  | 'database-open-failed'
  | 'schema-migration-failed'
  | 'integrity-check-failed'

export class SqliteStorageOpenError extends Error {
  readonly code: SqliteStorageOpenErrorCode
  readonly databasePath: string
}

export interface OpenKnowledgeDatabaseOptions {
  databasePath: string
}

export interface SqliteKnowledgeDatabase {
  readonly databasePath: string
  readonly schemaVersion: number
  close(): void
}

export function openKnowledgeDatabase(
  options: OpenKnowledgeDatabaseOptions,
): SqliteKnowledgeDatabase

export const SQLITE_SCHEMA_VERSION = 1
```

鏈樁娈典笉瑕佹彁鍓嶅鍑猴細

```text
createSqliteRepository
浠讳綍 Item / Review / Method Repository
浠讳綍 Application Service
HTTP / API Client
杩佺Щ鏈嶅姟
鎭㈠鐐规湇鍔?
```

### 銆怱1.4 鏁版嵁鐩綍涓庢墦寮€瑙勫垯銆?

`openKnowledgeDatabase()` 鎺ユ敹鏄惧紡璺緞锛屼笉鑷璇诲彇 `LOCALAPPDATA`銆傚師鍥狅細

```text
S1 鍙獙璇佹暟鎹簱鍩虹璁炬柦
鐪熷疄鐢ㄦ埛璺緞瑙ｆ瀽灞炰簬 S6 Local API 鍚姩鑱岃矗
娴嬭瘯蹇呴』鍙敞鍏ヤ复鏃惰矾寰?
```

鍥哄畾椤哄簭锛?

```text
1. 璁＄畻 dirname(databasePath)
2. fs.mkdir(dirname, { recursive: true })
3. 鎵撳紑 SQLite 鏂囦欢
4. PRAGMA foreign_keys = ON
5. PRAGMA journal_mode = WAL
6. PRAGMA synchronous = FULL
7. PRAGMA busy_timeout = 5000
8. applySchemaMigrations()
9. PRAGMA quick_check
10. 杩斿洖 SqliteKnowledgeDatabase
```

浠讳竴姝ュけ璐ワ細

```text
鍏抽棴宸叉墦寮€鍙ユ焺
鈫?鎶?SqliteStorageOpenError
鈫?淇濈暀鍘熸暟鎹簱鏂囦欢
鈫?涓嶅垹闄ゃ€佹敼鍚嶃€佽鐩栨垨鑷姩鏂板缓鏇夸唬绌哄簱
```

濡傛灉澶辫触鍙戠敓鍦ㄤ竴涓鍓嶄笉瀛樺湪鐨勬祴璇曟枃浠跺垱寤轰箣鍚庯紝鍏佽鐣欎笅绌烘枃浠讹紱浣嗕笉寰楀悜鐢ㄦ埛璺緞搴旂敤姝よ涓恒€傜湡瀹炵敤鎴疯矾寰勬晠闅滃鐞嗗皢鍦?S6 澧炲姞鈥滅幇鏈夋枃浠?/ 鏂板缓鏂囦欢鈥濇槑纭瘖鏂€?

### 銆怱1.5 Schema v1銆?

S1 鍙垱寤?Schema锛屼笉鍦ㄧ敓浜ц矾寰勫～鍏呮暟鎹€侱DL 閲囩敤涓婁竴浠藉紑宸ヨ鏍艰ˉ鍏呬腑鍐荤粨鐨勫畬鏁?Schema v1锛?

```text
schema_migrations
items
item_status_events
reviews
methods
method_versions
method_evidence
method_applications
method_tombstones
item_links
system_metadata
```

S1 蹇呴』璇佹槑锛?

```text
棣栨鎵撳紑
鈫?鍏ㄩ儴琛ㄣ€佺储寮曞拰 schema_migrations(version=1) 瀛樺湪

鍐嶆鎵撳紑鍚屼竴鏂囦欢
鈫?涓嶉噸澶嶆彃鍏?migration 璁板綍
鈫?涓嶆墽琛岀牬鍧忔€ч噸寤?
鈫?鐜版湁琛ㄥ拰娴嬭瘯鍐欏叆淇濈暀
```

DDL 涓庡閿竟鐣屼笉寰楀湪 S1 鎿呰嚜鏀瑰彉銆傚挨鍏讹細

```text
涓嶅洜鏂逛究瀵?Method / MethodVersion / Evidence / Application 澧炲姞浼氶樆鏂纰戣涔夌殑纭閿?
涓嶄互 ON DELETE CASCADE 鏇夸唬鏈潵涓氬姟娓呯悊缂栨帓
```

### 銆怱1.6 `quick_check` 澶辫触绛栫暐銆?

蹇呴』灏佽涓哄彲娴嬭瘯鍑芥暟銆傛垚鍔熸潯浠讹細

```text
PRAGMA quick_check
鈫?鎭颁负 "ok"
```

寮傚父鎴栭潪 `ok`锛?

```text
close
鈫?throw SqliteStorageOpenError('integrity-check-failed')
鈫?涓嶅皾璇曚慨澶?
鈫?涓嶅垱寤虹浜屼釜鏁版嵁搴撴枃浠?
鈫?涓嶈鐩栧師鏁版嵁搴?
```

S1 娴嬭瘯鍏佽閫氳繃 database adapter / 鍙楁帶 test seam 妯℃嫙 `quick_check` 寮傚父鎴栭敊璇粨鏋滐紱涓嶅緱渚濋潬鎵嬪伐鎹熷潖浜岃繘鍒舵暟鎹簱鏉ュ埗閫犱笉绋冲畾娴嬭瘯銆?

### 銆怱1.7 浜嬪姟杈圭晫鍩虹璁炬柦銆?

S1 鍙彁渚涘唴閮?transaction helper锛屼絾涓嶇紪鍐欎笟鍔?transaction锛?

```ts
interface SqliteKnowledgeDatabase {
  runInTransaction<T>(work: () => T): T
  runInReadTransaction<T>(work: () => T): T
}
```

瑕佹眰锛?

```text
write transaction 浣跨敤 better-sqlite3 transaction 鎴栫瓑浠?BEGIN IMMEDIATE 璇箟
read transaction 鏈変竴鑷存€у揩鐓ц涔?
work 鎶涢敊鏃?rollback
绂佹鍦?transaction callback 鍐?await / Promise
```

S1 鍙渶鐢ㄥ悎鎴愯〃 / `system_metadata` 楠岃瘉锛?

```text
涓ゆ潯鍐欏叆涓浜屾潯鎶涢敊
鈫?绗竴鏉″洖婊?

read transaction 鍐呰鍙栦竴鑷?
鈫?涓嶆贩鍏ユ湭鎻愪氦鍐欏叆
```

涓嶈兘鎶婅繖涓熀纭€璁炬柦娴嬭瘯琛ㄥ啓鍏ユ寮忎笟鍔?Schema锛涘彲浣跨敤娴嬭瘯涓存椂琛紝娴嬭瘯缁撴潫鍒犻櫎銆?

## 銆愬洓銆丼1 鑷姩鍖栭獙鏀舵竻鍗曘€?

S1 瀹屾垚蹇呴』鑷冲皯鏂板骞堕€氳繃浠ヤ笅鐪熷疄 SQLite 娴嬭瘯銆?

### A. 鍘熺敓妯″潡鐪熷疄鍙敤

1. `better-sqlite3` 鍦?Node 娴嬭瘯杩涚▼鍙 import / require锛?
2. 涓存椂 `.db` 鍙墦寮€锛?
3. 鍙垱寤轰复鏃惰〃銆佹彃鍏ヤ竴琛屻€佽鍙栬琛屻€佸叧闂紱
4. 鍏抽棴鍚庨噸鏂版墦寮€浠嶅彲璇诲彇璇ヨ锛?
5. 姝ら獙璇佸繀椤讳娇鐢ㄧ湡瀹?native binding锛屼笉鍙?mock `better-sqlite3`銆?

### B. 鐩綍銆佹枃浠朵笌 Schema

1. 涓嶅瓨鍦ㄧ殑宓屽涓存椂鐩綍鍙垱寤猴紱
2. 鎸囧畾 `.db` 鏂囦欢鍙ǔ瀹氬垱寤猴紱
3. 棣栨鎵撳紑鎵ц Schema v1锛屾墍鏈夎〃鍜岀储寮曞瓨鍦紱
4. `schema_migrations` 浠呮湁 version 1锛?
5. 閲嶅鎵撳紑涓嶉噸澶嶈縼绉汇€佷笉鍒犺〃銆佷笉涓复鏃舵祴璇曟暟鎹紱
6. `foreign_keys` 宸插惎鐢紱
7. `journal_mode` 瀹為檯涓?`wal`锛?
8. `synchronous` 瀹為檯涓?`full`锛?
9. `busy_timeout` 瀹為檯涓?`5000`锛?
10. close 鍚庝笉鍐嶉仐鐣欐湭鍏抽棴鏁版嵁搴?handle锛學indows 涓嬪彲鍒犻櫎娴嬭瘯 `.db` / `-wal` / `-shm` 鏂囦欢銆?

### C. 澶辫触淇濇姢

1. 鐖惰矾寰勪笉鍙垱寤烘椂杩斿洖 `directory-unavailable`锛屼笉闈欓粯浣跨敤鍏朵粬鐩綍锛?
2. 鏁版嵁搴撴墦寮€澶辫触鏃惰繑鍥?`database-open-failed`锛屼笉鍒涘缓鏇夸唬绌哄簱锛?
3. Schema migration 鍙楁帶澶辫触鏃讹細
   - 杩斿洖 `schema-migration-failed`锛?
   - 涓嶅啓鍏ユ垚鍔?migration version锛?
   - 涓嶄骇鐢熷崐鍗囩骇鐘舵€侊紱
4. `quick_check` 闈?`ok` 鎴栨姏閿欐椂锛?
   - 杩斿洖 `integrity-check-failed`锛?
   - 鍏抽棴鏁版嵁搴擄紱
   - 涓嶈鐩栥€佷笉鍒犻櫎鍘熸枃浠讹紱
5. write transaction 绗簩鏉¤鍙ュけ璐ワ細绗竴鏉″畬鏁村洖婊氾紱
6. 璇诲啓浜嬪姟 helper 涓嶆帴鍙楀紓姝?callback锛汿ypeScript 绫诲瀷涓庤繍琛屾椂淇濇姢鑷冲皯鍏朵竴鏄庣‘鎷掔粷銆?

### D. DDL 杈圭晫瀹℃煡娴嬭瘯

1. `items.status` 瀵归潪鍐荤粨鐘舵€佸€兼嫆缁濓紱
2. `reviews.item_id` 鍞竴锛?
3. `method_applications.item_id` 鍞竴锛?
4. `method_versions(method_id, version)` 鍞竴锛?
5. `method_tombstones` 鍙彃鍏ヨ€屼笉瀛樺湪瀵瑰簲 Method锛?
6. 涓嶅瓨鍦?Method 鏃讹紝MethodEvidence / MethodApplication 鐨勫巻鍙插瓧娈靛彲瀛樺偍锛堢敤浜庡悗缁纰戣涔夛級锛屼絾姝ゆ椂 S1 涓嶅０鏄庝笟鍔″畬鏁存€у凡閫氳繃锛?
7. Item / Review / Event / Link 鐨勭‖澶栭敭瑙勫垯鎸?DDL 鐢熸晥銆?

### S1 楠岃瘉鍛戒护

```bash
corepack pnpm typecheck
corepack pnpm test --run tests/sqlite-infrastructure.test.ts
corepack pnpm test
corepack pnpm build:h5
git -C Knowledge_Base diff --check
```

S1 鎻愪氦 QA 鍓嶏紝蹇呴』鍦?Windows 寮€鍙戞満涓婂疄闄呮墽琛屼竴娆″師鐢?binding 鎵撳紑銆佸叧闂拰鍒犻櫎涓存椂 SQLite 鏂囦欢楠岃瘉銆備笉鑳戒粎渚濊禆 CI 鎴?TypeScript 缂栬瘧銆?

## 銆愪簲銆丼1 QA 楠屾敹杈撳嚭瑕佹眰銆?

QA 鎶ュ憡蹇呴』鏄庣‘锛?

```text
SQLite 浠嶄负鍊欓€変富搴擄紝IndexedDB 浠嶄负褰撳墠杩愯涓诲簱銆?
```

鎶ュ憡鑷冲皯鍖呭惈锛?

```text
鍘熺敓 binding 瀹為檯杩愯璇佹嵁
涓存椂鏂囦欢鍒涘缓 / reopen / close / delete 璇佹嵁
PRAGMA 鍜?Schema migration 缁撴灉
quick_check 澶辫触淇濇姢璇佹嵁
浜嬪姟 rollback 璇佹嵁
纭娌℃湁淇敼鍓嶇銆丄pplication 涓氬姟璇箟銆両ndexedDB 涓昏矾寰勬垨鐪熷疄鐢ㄦ埛鏁版嵁
鏈畬鎴愰」锛歋2鈥揝6
鏄惁寤鸿杩涘叆 S2锛氶€氳繃 / 鏈夋潯浠堕€氳繃 / 涓嶉€氳繃
```

S1 閫氳繃鍙厑璁哥敵璇疯繘鍏?S2锛涗笉鍏佽锛?

```text
鍒囧墠绔?
瀵煎叆鐪熷疄 IndexedDB JSON
浣跨敤 %LOCALAPPDATA% 姝ｅ紡涓诲簱
瀹ｅ竷 SQLite 宸茶縼绉诲畬鎴?
```

## 銆愬叚銆佸悗缁樁娈佃繘鍏ユ潯浠躲€?

| 鐢宠杩涘叆 | 闇€瑕佸厛閫氳繃 |
|---|---|
| S2 | S1 QA 閫氳繃 + 鏋舵瀯纭鍩虹璁炬柦 Contract 绋冲畾 |
| S3 | S2 QA 閫氳繃锛岀壒鍒槸 Item P0銆丷eview 鍘熷瓙鎬у拰 BackupRepository rollback |
| S4 | S3 QA 閫氳繃锛岀壒鍒槸鏂规硶澧撶銆佹柇瑁傚叧鑱斾笌鐢熷懡鍛ㄦ湡浜嬪姟 |
| S5 | S4 QA 閫氳繃锛岀幇鏈夋墍鏈?Repository / 璇绘ā鍨?Contract 宸茬瓑浠?|
| S6 | S5 QA 閫氳繃锛孲QLite BackupData 瀵煎叆瀵煎嚭鍏ㄩ噺涓ユ牸绛変环 |

## 銆愪氦浠樼粰鏁版嵁灞傚伐绋嬪笀鐨勬妧鏈害鏉熴€?

```text
褰撳墠鍙仛 S1銆?

鍏佽锛?
- 瀹夎骞朵粎鎵瑰噯 better-sqlite3 鍘熺敓鏋勫缓锛?
- 鍒涘缓 packages/storage-sqlite 鍩虹璁炬柦锛?
- 瀹炵幇 SQLite 鎵撳紑銆丳RAGMA銆丼chema v1銆乹uick_check銆佸叧闂拰鍩虹浜嬪姟 helper锛?
- 鐢ㄤ复鏃跺悎鎴?SQLite 鏂囦欢娴嬭瘯鐪熷疄 native binding銆丏DL 鍜屽け璐ヤ繚鎶ゃ€?

绂佹锛?
- 瀹炵幇浠讳竴涓氬姟 Repository锛?
- 杩佺Щ瀹屾暣 Contracts锛?
- 鏂板缓 Local API銆丠TTP銆佸墠绔?API client 鎴栬縼绉诲悜瀵硷紱
- 鍐欏叆 / 瀵煎叆鐪熷疄涓汉鏁版嵁锛?
- 璇诲彇銆佹竻鐞嗘垨鍙屽啓 IndexedDB锛?
- 鍒囨崲褰撳墠鍓嶇涓诲簱锛?
- 瀹ｇО SQLite 宸叉槸涓诲簱鎴栬縼绉诲畬鎴愩€?

瀹屾垚鍚庯細
鏁版嵁灞傚伐绋嬪笀 鈫?QA S1 瀹氬悜楠屾敹 鈫?鏋舵瀯甯堢‘璁ゆ槸鍚﹁繘鍏?S2銆?
```
