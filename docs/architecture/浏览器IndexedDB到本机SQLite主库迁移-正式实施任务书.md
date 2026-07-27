# 娴忚鍣?IndexedDB 鈫?鏈満 SQLite 涓诲簱杩佺Щ 鈥?姝ｅ紡瀹炴柦浠诲姟涔?

> 鐘舵€侊細**浜у搧宸插喕缁擄紱鏈枃浠朵粎鎺堟潈鏋舵瀯璁捐涓庝换鍔℃媶鍒嗭紝涓嶆巿鏉冪洿鎺ョ爺鍙戙€?*
> 鍓嶇疆璇勫锛歚docs/architecture/娴忚鍣↖ndexedDB鍒版湰鏈篠QLite涓诲簱杩佺Щ-鏋舵瀯璇勫.md`銆?
> 浼樺厛绾э細**P0 鏁版嵁涓绘潈涓庢満鍣ㄧ骇鎸佷箙鍖?*銆傚湪鏈縼绉婚獙鏀躲€佹仮澶嶆紨缁冨拰浜у搧灏佹澘鍓嶏紝鏆傚仠鍚庣画浣撻獙浼樺寲闇€姹傘€?

## 銆愭妧鏈粨璁猴細鍙銆?

鏈郴缁熶粠娴忚鍣?IndexedDB 杩佺Щ鑷虫湰鏈?SQLite 鏂囦欢涓诲簱锛岄噰鐢細

```text
娴忚鍣ㄥ伐浣滃彴
鈫?127.0.0.1:32145 Local API
鈫?Application / SQLite Repository
鈫?%LOCALAPPDATA%\Knowledge_Base\knowledge-base.db
鈫?JSON 澶囦唤 / 鎭㈠
```

SQLite 鏄敮涓€鍙俊涓诲簱锛汮SON 鏄敤鎴峰畨鍏ㄥ浠姐€佹仮澶嶅拰璺ㄧ幆澧冭縼绉绘牸寮忥紱鏃?IndexedDB 浠呬綔涓哄巻鍙叉暟鎹殑涓€娆℃€?JSON 瀵煎嚭鏉ユ簮銆?

```text
绂佹 IndexedDB 涓?SQLite 闀挎湡鍙屽啓銆?
绂佹 API 鏈惎鍔ㄦ椂闈欓粯鍥為€€鍒扮┖ IndexedDB銆?
绂佹灏嗘暟鎹簱涓嶅彲鐢ㄤ吉瑁呬负鈥滄殏鏃犱簨椤光€濄€?
```

## 銆愪竴銆佸凡鍐荤粨鐨勪骇鍝佷笌杩愯杈圭晫銆?

### 1. 鍥哄畾鍦板潃

```text
Local API host锛?27.0.0.1
Local API port锛?2145
鏃ュ父宸ヤ綔鍙帮細http://127.0.0.1:32145
```

绂佹锛?

```text
0.0.0.0
localhost 鏇夸唬 127.0.0.1
IPv6 閫氶厤鐩戝惉
灞€鍩熺綉 / 鍏綉鏆撮湶
Docker / Nginx 鏃ュ父鎵樼
杩滅▼璁块棶
```

### 2. 涓诲簱涓庢枃浠剁洰褰?

```text
SQLite 涓诲簱锛?LOCALAPPDATA%\Knowledge_Base\knowledge-base.db
鑷姩鎭㈠鐐癸細%LOCALAPPDATA%\Knowledge_Base\backups\
```

鏁版嵁搴撶洰褰曞睘浜庡綋鍓?Windows 鐢ㄦ埛锛屼笉鏀惧湪 Git 椤圭洰鐩綍銆俉AL 宸ヤ綔闆嗕篃灞炰簬鏁版嵁搴撶殑涓€閮ㄥ垎锛?

```text
knowledge-base.db
knowledge-base.db-wal
knowledge-base.db-shm
```

瀹冧滑涓嶆槸鐢ㄦ埛澶囦唤锛屼笉鑳藉崟鐙鍒躲€佹彁浜ゆ垨浣滀负鎭㈠娴佺▼杈撳叆銆?

### 3. 鏃ュ父涓庡紑鍙戝惎鍔?

鏍?`package.json` 蹇呴』鏂板骞跺喕缁撳涓嬪懡浠わ細

```bash
# 鏃ュ父鐪熷疄浣跨敤锛氬厛鏋勫缓锛屽啀鐢?Local API 鎵樼 H5
corepack pnpm build:h5
corepack pnpm start:local

# 鏈満 API锛屼緵闆嗘垚娴嬭瘯鎴栨晠闅滄帓鏌ヤ娇鐢?
corepack pnpm start:api

# 寮€鍙戯細骞惰鍚姩 API 涓?Taro H5 鐑洿鏂?
corepack pnpm dev:local
```

鏃ュ父鍏ュ彛鍙兘鏄細

```text
http://127.0.0.1:32145
```

寮€鍙戞湡 H5 鐑洿鏂板湴鍧€鍙互瀛樺湪锛屼絾鍙兘绮剧‘璋冪敤 `http://127.0.0.1:32145/api/*`銆備笉寰楀皢寮€鍙戝湴鍧€褰撲綔鏃ュ父鏁版嵁涓诲叆鍙ｃ€?

### 4. 鎭㈠鐐逛繚鐣?

姣忔 JSON 鎭㈠涓诲簱鍓嶏細

```text
瀵煎嚭褰撳墠 SQLite 瀹屾暣 JSON
鈫?鍘熷瓙鍐欏叆 backups\before-restore-YYYY-MM-DDTHH-mm-ss.json
鈫?浠呮仮澶嶇偣鍐欏叆鎴愬姛鍚庢墠鍏佽瑕嗙洊鎭㈠
```

瑙勫垯锛?

```text
淇濈暀鏈€杩?20 涓嚜鍔ㄦ仮澶嶇偣
瓒呰繃 20 涓悗鍒犻櫎鏈€鏃х殑鑷姩鎭㈠鐐?
鐢ㄦ埛鎵嬪姩瀵煎嚭鐨?JSON 姘镐笉鐢辩郴缁熻嚜鍔ㄥ垹闄?
```

鎭㈠鐐规竻鐞嗗繀椤诲彂鐢熷湪鏂扮殑鎭㈠鐐瑰凡瀹夊叏钀界洏涔嬪悗銆傛竻鐞嗗け璐ヤ笉闃绘柇鏈鎭㈠鐐瑰垱寤烘垨鍚庣画鎭㈠锛屼絾蹇呴』璁板綍鍙鍔ㄥ憡璀︼紱涓嶅緱鍒犻櫎浠讳綍鐢ㄦ埛鎵嬪姩澶囦唤銆?

## 銆愪簩銆佹帹鑽愮洰褰曚笌鍖呰竟鐣屻€?

鏂板锛?

```text
apps/local-api/
  src/main.ts                 # 鍚姩銆佺洰褰曘€丼QLite health銆丠TTP server銆侀潤鎬佹墭绠?
  src/server.ts               # Fastify 瑁呴厤銆佽矾鐢辨敞鍐屻€侀敊璇鐞?
  src/routes/**               # HTTP 鍒?Application 鐨勮杽閫傞厤灞?
  src/storage-health.ts       # 鍚姩妫€鏌ャ€乭ealth 鐘舵€佷笌閿欒鍒嗙被
  src/migration/**            # 涓€娆℃€?IndexedDB JSON 瀵煎叆缂栨帓
  src/restore-points.ts       # 鑷姩鎭㈠鐐瑰垱寤轰笌鏈€澶?20 涓繚鐣欑瓥鐣?

packages/storage-sqlite/
  src/index.ts                # createSqliteRepository() 宸ュ巶涓?exports
  src/database.ts             # 璺緞銆佽繛鎺ャ€丳RAGMA銆乻chema migration銆乮ntegrity check
  src/schema.ts               # schema version銆丏DL銆丼QL migration
  src/repositories/**         # 鐜版湁 Repository Contracts 鐨?SQLite 瀹炵幇

packages/local-api-client/
  src/index.ts                # fetch client銆乼yped facade銆丩ocalApiError

packages/contracts/
  src/index.ts                # 浠?Local API DTO / health / error 鍏变韩绫诲瀷纭湁蹇呰鏃舵柊澧?
```

淇濈暀浣嗛檷绾э細

```text
packages/storage-indexeddb/
鈫?鏃у伐浣滃彴涓庤縼绉绘潵婧?/ 娴嬭瘯涓撶敤
鈫?涓嶅厑璁告柊鏃ュ父宸ヤ綔鍙拌閰?
```

鏃ュ父鍓嶇蹇呴』绉婚櫎锛?

```text
@knowledge-base/storage-indexeddb 鐨勭敓浜т緷璧?
createIndexedDbRepository() 鐨勯〉闈㈣閰?
娴忚鍣ㄥ唴 Application + IndexedDB Repository 涓绘暟鎹矾寰?
```

## 銆愪笁銆丼QLite 鎶€鏈害鏉熶笌 Schema銆?

### 1. 渚濊禆涓庨┍鍔?

鏂板鐢熶骇渚濊禆锛?

```text
better-sqlite3
fastify
@fastify/static
```

鏂板寮€鍙戜緷璧栵細

```text
@types/better-sqlite3
```

鍙寜瀹炵幇闇€瑕佹柊澧炰竴涓皬鍨嬪苟鍙戝紑鍙戣剼鏈緷璧栵紱涓嶅紩鍏ワ細

```text
ORM
Drizzle
Prisma
Express
Nest
鐧诲綍 / JWT
浠诲姟闃熷垪
鏈嶅姟鍙戠幇
鏁版嵁搴撳畧鎶よ繘绋?
```

### 2. SQLite 杩炴帴鍒濆鍖?

姣忔 Local API 鍚姩蹇呴』鎸夐『搴忥細

```text
1. 璇诲彇 process.env.LOCALAPPDATA锛涚己澶卞嵆澶辫触銆?
2. mkdir(dataDir, { recursive: true })銆?
3. 鎵撳紑 knowledge-base.db锛涘け璐ュ嵆閫€鍑恒€?
4. PRAGMA foreign_keys = ON銆?
5. PRAGMA journal_mode = WAL銆?
6. PRAGMA synchronous = FULL銆?
7. PRAGMA busy_timeout = 5000銆?
8. 鍦ㄥ悓涓€鍚姩娴佺▼鎵ц SQLite Schema migration銆?
9. 鎵ц PRAGMA quick_check銆?
10. 浠呬笂杩板叏閮ㄦ垚鍔熷悗鎵嶅惎鍔?HTTP listen(32145, '127.0.0.1')銆?
```

瑙勫垯锛?

- `quick_check` 杩斿洖闄?`ok` 澶栫殑浠讳綍缁撴灉锛氭嫆缁濈洃鍚€佷繚鐣欏師鏂囦欢銆侀€€鍑洪潪闆讹紱
- 涓嶅洜妫€鏌ュけ璐?rename銆佸垹闄ゃ€佽鐩栨垨鍒涘缓鏂扮殑绌哄簱锛?
- 涓嶅洜绔彛鍗犵敤鑷姩閫夋嫨鏂扮鍙ｏ紱浠ラ潪闆堕€€鍑哄苟鎶ュ憡 `127.0.0.1:32145` 琚崰鐢紱
- 涓嶅湪杩愯鏃朵负鈥滀慨澶嶆潈闄愨€濋檷浣庡綋鍓嶇敤鎴风洰褰?ACL锛?
- 浠讳綍鍐欏叆澶辫触鐢?API 鏄惧紡杩斿洖 `storage-write-failed`锛屼笉鍚炴帀閿欒銆?

### 3. SQLite Schema version

SQLite 浣跨敤鑷繁鐨勫熀纭€璁炬柦 Schema version锛屼笉涓?`BackupDocument.version`銆佹棫 Dexie version 鎴栦骇鍝?Sprint 缁戝畾銆?

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
```

Schema migration 鍘熷垯锛?

```text
姣忎釜 SQL migration 鍦?SQLite transaction 鍐呮墽琛屻€?
浠呭湪 migration 鎴愬姛鍚庡啓鍏?schema_migrations銆?
澶辫触鍒欐暣涓?migration 鍥炴粴锛孉PI 涓嶅惎鍔ㄣ€?
涓嶉€氳繃鈥滄暟鎹簱涓虹┖鈥濋噸寤烘潵鎺╃洊 migration 澶辫触銆?
```

棣栫増 Schema version 1 鍖呭惈濡備笅琛細

```sql
CREATE TABLE items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN (
    'idea_to_try', 'idea_later', 'doing', 'paused',
    'waiting_review', 'reviewed', 'archived_no_review', 'abandoned'
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
  FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
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
  UNIQUE (method_id, version)
);
CREATE INDEX idx_method_versions_source_review
  ON method_versions(source_review_id);

CREATE TABLE method_evidence (
  id TEXT PRIMARY KEY,
  method_id TEXT NOT NULL,
  review_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  relation TEXT CHECK (relation IN ('formation', 'validation', 'revision', 'unknown')),
  method_version INTEGER
);
CREATE INDEX idx_method_evidence_method ON method_evidence(method_id);
CREATE INDEX idx_method_evidence_review ON method_evidence(review_id);
CREATE UNIQUE INDEX idx_method_evidence_method_review ON method_evidence(method_id, review_id);

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

### 4. 鍏崇郴杈圭晫

浠ヤ笅鏄厑璁告案涔呮竻鐞嗗悗淇濈暀鍙В閲婂巻鍙插叧绯荤殑浜嬪疄锛?*涓嶅緱浣跨敤浼氶樆濉炲纰戣涔夌殑纭閿?*锛?

```text
method_evidence.method_id
method_applications.method_id + method_version
method_versions.method_id
```

鐞嗙敱锛氭柟娉曟鏂囦笌鐗堟湰姝ｆ枃姘镐箙娓呯悊鍚庯紝`MethodEvidence` 涓?`MethodApplication` 浠嶉渶閫氳繃 `MethodTombstone` 琛ㄨ揪鍘嗗彶鍏崇郴銆?

鐩稿弽锛孖tem 浣滀负鍘嗗彶浜嬪疄涓昏褰曟椂锛孯eview銆佺姸鎬佷簨浠躲€佹柟娉曞簲鐢ㄥ拰 ItemLink 浠嶉渶瑕?Item 瀛樻椿锛涙案涔呮竻鐞?Item 鐨勬棦鏈?Repository 浜嬪姟蹇呴』鏄惧紡娓呯悊鍏跺叧鑱旀暟鎹紝淇濇寔鏃㈡湁璇箟銆備笉寰椾緷璧栨棤瀹¤鐨?`ON DELETE CASCADE` 浠ｆ浛鐜版湁娓呯悊绛栫暐銆?

### 5. Repository 浜嬪姟绾︽潫

姣忎釜 SQLite Repository 鍐欏叆蹇呴』锛?

```text
BEGIN IMMEDIATE
鈫?浜嬪姟鍐呴噸鏂拌鍙栧綋鍓嶈褰?
鈫?鎵ц鏃㈡湁 Domain / Repository 鏍￠獙
鈫?鍙悎骞舵湰鍛戒护鍏佽淇敼鐨勫瓧娈?
鈫?鍐欏叧鑱斾簨瀹?
鈫?COMMIT

浠讳竴澶辫触
鈫?ROLLBACK
```

SQLite 鍗曟枃浠朵笉鎰忓懗鐫€鍙拷鐣ュ苟鍙戜竴鑷存€с€傚繀椤荤户缁縼绉诲凡鏈夊彈鎺т氦閿欐祴璇曪細

```text
updateContent 脳 changeStatus
updateContent 脳 delete / restore
purgeDeletedBefore 脳 restore
startExecution 鍘熷瓙鎬?
completeReview 鍘熷瓙鎬?
鏂规硶姘镐箙娓呯悊涓庡纰戜簨鍔″洖婊?
```

## 銆愬洓銆丷epository 涓?Application 瀹炴柦鏄犲皠銆?

### 1. 鍘熸牱瀹炵幇鐨勬棦鏈?Contracts

SQLite 蹇呴』瀹屾暣瀹炵幇鐜版湁锛?

```text
ItemRepository
ReviewRepository
MethodRepository
MethodApplicationRepository
ReviewWorkflowRepository
BackupRepository
SearchRepository
DashboardRepository
```

涓嶄负杩佺Щ淇敼锛?

```text
ItemStatus 鏋氫妇鎴栫姸鎬佹満
Review 璇箟
Method / MethodVersion / MethodEvidence / MethodApplication 鍏崇郴
MethodTombstone 璇箟
ItemLink 璇箟
BackupData 缁撴瀯
BackupDocument v1 / v2 涓氬姟鍏煎瑙勫垯
```

### 2. SQL 鏌ヨ绾︽潫

- list銆佹悳绱€佷华琛ㄧ洏銆佽瘉鎹鎯呫€佹柟娉曟潵婧愬睍绀虹瓑鏌ヨ閮藉繀椤荤敱 SQLite Repository 缁撴瀯鍖栬繑鍥烇紱
- 鍓嶇涓嶅緱鍥犳暟鎹敼涓?HTTP 鑰岃嚜琛?join銆佹寜鏍囬鎺ㄦ柇鎴栫粍鍚堝巻鍙插叧绯伙紱
- `listSourceDisplaysForItems()` 缁х画浣滀负浜嬮」姹犲敮涓€鎵归噺鏉ユ簮琛?Contract锛?
- `getContextResultByItemId()` 缁х画杩斿洖鏃㈡湁 `no-association / available / unavailable / method-in-trash / method-purged` 缁撴瀯鍖栫姸鎬侊紱
- 鎼滅储绗竴鐗堜繚鎸佸綋鍓嶈涔夊拰瀛楁瑕嗙洊锛屼笉寮曞叆 FTS銆佸垎璇嶃€佸悜閲忔垨妯＄硦鑷姩鍖归厤銆傝嫢 SQL `LIKE` 鐩存帴瀹炵幇鐜版湁琛屼负锛屽簲浼樺厛閲囩敤銆?

### 3. Application 杩愯浣嶇疆

```text
Local API 杩涚▼
鈫?鍒涘缓 SQLite Repository
鈫?鍒涘缓鐜版湁 Application Service
鈫?HTTP handler 璋冪敤 Application

娴忚鍣?
鈫?鍙娇鐢?local-api-client typed facade
鈫?涓嶅垱寤?Application Service + SQLite Repository
```

濡傛灉瀹㈡埛绔渶瑕佸鐢ㄧ函璁＄畻绫诲瀷鎴栨棤鍓綔鐢ㄧ殑灞曠ず杈呭姪鍑芥暟锛屽簲浠庣嫭绔嬬函鍑芥暟妯″潡瀵煎叆锛涗笉寰椾负浜嗗鐢ㄨ€屾妸鏈嶅姟绔?Repository 鎴?`better-sqlite3` 鎵撳叆 H5 鍖呫€?

## 銆愪簲銆丩ocal API 涓庨敊璇?Contract銆?

### 1. API 璺敱鍘熷垯

璺敱蹇呴』瀵瑰簲宸插瓨鍦ㄧ殑 Application 鐢ㄤ緥锛屼笉鏆撮湶琛ㄦ垨 SQL銆備緥濡傦細

```text
GET    /api/health
GET    /api/items
POST   /api/items
GET    /api/items/:id/status-events
POST   /api/items/:id/start-execution
POST   /api/items/:id/status
PUT    /api/items/:id/content
POST   /api/items/:id/trash
POST   /api/items/:id/restore

GET    /api/reviews/by-item/:itemId
POST   /api/reviews/complete

GET    /api/methods
GET    /api/methods/:id/versions
GET    /api/methods/:id/evidence
POST   /api/methods/:id/apply
POST   /api/methods/:id/validate-from-review
POST   /api/methods/:id/trash
POST   /api/methods/:id/restore

GET    /api/method-applications/:itemId/context
POST   /api/method-applications/source-displays

GET    /api/search?q=
GET    /api/dashboard?window=
GET    /api/trash?filter=

GET    /api/backup/export
POST   /api/backup/restore
POST   /api/migration/indexeddb/import
```

鐢熶骇鐘舵€佷笅锛屾墍鏈?API 璺敱蹇呴』瑕佹眰 storage health 涓?`ready`锛岃縼绉讳笓鐢ㄨ矾鐢遍櫎澶栥€?

### 2. 缁熶竴鍝嶅簲閿欒

鏂板鍏变韩绫诲瀷锛堟斁鍏?Contracts 鎴?local-api-client锛屾寜瀹為檯渚濊禆鏂瑰悜鍐冲畾锛夛細

```ts
export type LocalApiErrorCode =
  | 'local-api-unreachable'
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
  }
}
```

HTTP 鏄犲皠寤鸿锛?

| 鍦烘櫙 | HTTP | code | retryable |
|---|---:|---|---|
| API 鏃犳硶杩炴帴 | client 鏈湴閿欒 | `local-api-unreachable` | true |
| 鏁版嵁搴撴棤娉曟墦寮€銆佹崯鍧忋€佹湭灏辩华 | 503 | `storage-unavailable` | false |
| 鍐欏叆澶辫触銆佺鐩樻弧銆侀攣瓒呮椂 | 503 | `storage-write-failed` | true |
| 灏氭湭杩佺Щ | 409 | `migration-required` | false |
| 杩佺Щ閿佸畾涓?| 409 | `migration-in-progress` | true |
| 闈炴硶澶囦唤 / 闈炴硶杈撳叆 | 400 | `validation-failed` | false |
| 鐘舵€佹満鎷掔粷銆侀噸澶嶈縼绉汇€侀噸澶嶅鐩?| 409 | `conflict` | false |
| 浜嬮」 / 瀵硅薄涓嶅瓨鍦?| 404 | `not-found` | false |
| 鏈綊绫诲紓甯?| 500 | `internal-error` | true |

涓嶅緱灏嗗簳灞傝矾寰勩€丼QL 璇彞銆佸爢鏍堟垨涓汉鏁版嵁杩斿洖娴忚鍣ㄣ€傛湇鍔＄鏃ュ織鍙繚鐣欐妧鏈粏鑺傦紝鍓嶇浠呮樉绀哄彲琛屽姩璇存槑銆?

### 3. Health Contract

```ts
export type LocalStorageHealth =
  | { status: 'ready'; databasePath: string; schemaVersion: number }
  | { status: 'migration-required' }
  | { status: 'migration-in-progress' }
  | { status: 'storage-unavailable'; code: string; message: string }
```

娴忚鍣ㄩ娆″姞杞斤細

```text
GET /api/health
鈫?ready锛氳繘鍏ュ伐浣滃彴骞惰鍙栨暟鎹?
鈫?migration-required锛氬彧鏄剧ず杩佺Щ寮曞
鈫?migration-in-progress锛氬彧鏄剧ず杩佺Щ绛夊緟 / 閲嶈瘯
鈫?storage-unavailable 鎴栬姹傚け璐ワ細鍙樉绀烘暟鎹簱闃绘柇椤?
```

缁濅笉鍏佽锛?

```text
health 澶辫触 鈫?娓叉煋绌轰簨椤瑰垪琛?
health 澶辫触 鈫?鍒濆鍖?IndexedDB
health 澶辫触 鈫?鍋囨垚鍔?Toast
```

### 4. 闈欐€佹枃浠朵笌 Origin

`apps/local-api` 鍦ㄧ敓浜фā寮忛€氳繃 `@fastify/static` 鎵樼 `apps/client/dist`锛岄潤鎬侀〉鍜?API 鍚屾簮涓猴細

```text
http://127.0.0.1:32145
```

寮€鍙戞ā寮忥細

```text
Taro H5 origin锛氫粎浜у搧鍐荤粨鐨勫紑鍙戝湴鍧€
API锛?27.0.0.1:32145
CORS锛氬彧鍏佽璇ョ簿纭紑鍙?origin
```

涓嶅緱浣跨敤 `*` CORS銆傛墍鏈夋祻瑙堝櫒淇敼绫昏姹傚簲鏍￠獙 `Origin` 灞炰簬鐢熶骇鎴栧喕缁撳紑鍙?origin锛涜嫢涓嶅尮閰嶏紝鎷掔粷璇锋眰銆?

## 銆愬叚銆佷竴娆℃€?IndexedDB JSON 瀹夊叏杩佺Щ銆?

### 1. 鐘舵€佹満

`system_metadata` 涓娇鐢ㄤ互涓嬮敭锛?

```text
indexeddb_migration_state
indexeddb_migration_source_hash
indexeddb_migrated_at
```

鐘舵€佸€硷細

```text
not_started
in_progress
complete
```

鍒濆绌哄簱娌℃湁璇?key 鏃讹紝璇箟绛夊悓 `not_started`銆?

### 2. 鐢ㄦ埛杩佺Щ娴佺▼

```text
A. 鍦ㄤ粛鍙闂棫鏁版嵁鐨勬棫宸ヤ綔鍙般€佸師娴忚鍣?Profile銆佸師 origin 涓細
   瀵煎嚭瀹屾暣 JSON 澶囦唤骞剁敱鐢ㄦ埛淇濆瓨銆?

B. 鍚姩鏂?Local API锛岃闂?http://127.0.0.1:32145銆?

C. health = migration-required锛?
   鏄剧ず杩佺Щ寮曞锛屾槑纭彁绀衡€滀綘鐨勪簨椤规湭琚鍙栵紝涓嶆槸绌烘暟鎹€濄€?

D. 鐢ㄦ埛閫夋嫨鏃?JSON 鏂囦欢涓婁紶銆?

E. Local API锛?
   parseAndValidate(JSON)
   鈫?澶辫触锛氫笉鍐?SQLite锛屾樉绀烘牎楠岄敊璇€?
   鈫?鎴愬姛锛氭寜瑙勮寖鍖?BackupData 璁＄畻 SHA-256銆?

F. SQLite 鍗曚竴 BEGIN IMMEDIATE transaction锛?
   1) migration_state 蹇呴』涓?not_started锛?
   2) 鍏ㄩ儴涓氬姟琛ㄥ繀椤讳负绌猴紱
   3) 鍐?indexeddb_migration_state = in_progress锛?
   4) 鍐欏叆鍏ㄩ儴 BackupData锛?
   5) 鎵ц SQL 鏈€灏忓畬鏁存€ф鏌ワ紱
   6) 鍐?indexeddb_migration_source_hash 涓?indexeddb_migrated_at锛?
   7) 鍐?indexeddb_migration_state = complete锛?
   8) COMMIT銆?

G. 鎻愪氦鍚庯細
   SQLite exportData()
   鈫?涓庤В鏋愬悗鐨?BackupData 鎸夐泦鍚堛€両D銆佸瓧娈点€佸叧鑱旇繘琛屼竴鑷存€ф牳瀵?
   鈫?涓嶄竴鑷达細杩涘叆 storage-unavailable锛岀姝㈠伐浣滃彴鍐欏叆骞惰姹備繚鐣欐枃浠?/ 鎭㈠澶勭悊
   鈫?涓€鑷达細health = ready锛岃繘鍏ュ伐浣滃彴銆?
```

`in_progress` 涓嶅簲鍦ㄦ甯告彁浜ゅ悗琚閮ㄥ彲瑙侊紱瀹冪殑浠峰€兼槸闃插尽寮傚父瀹炵幇鍜屾槑纭姸鎬併€侫PI 鍚姩鑻ュ彂鐜版寔涔呭寲 `in_progress`锛?

```text
鎷掔粷姝ｅ父宸ヤ綔鍙?
鈫?鏄剧ず migration-in-progress / 闇€瑕佷汉宸ユ仮澶嶆彁绀?
鈫?涓嶈嚜鍔ㄧ寽娴嬫垨閲嶅瀵煎叆
```

璁捐鍘熷垯涓?SQLite transaction 浼氫娇鏈彁浜ょ殑 in_progress 鍥炴粴锛涜嫢浠嶅嚭鐜版寔涔呭寲璇ョ姸鎬侊紝蹇呴』瑙嗕綔寮傚父锛岃€岄潪鎿呰嚜淇銆?

### 3. 瀵煎叆椤哄簭

`BackupRepository.replaceData()` 鎴栬縼绉诲唴閮?bulk insert 蹇呴』鍦ㄤ竴涓?SQLite transaction 涓紝涓斾緷鐓х幇鏈夎涔変笌绾︽潫鍐欏叆锛?

```text
items
鈫?itemStatusEvents
鈫?reviews
鈫?methods
鈫?methodVersions
鈫?methodEvidence
鈫?methodApplications
鈫?methodTombstones
鈫?itemLinks
```

涓嶅彲鐢ㄧ‖澶栭敭鐨勫巻鍙叉柟娉曞叧绯荤户缁敱 `parseAndValidate()` 鍜?SQL 鍚庢牎楠岀淮鎶ゃ€備换浣?insert銆佸敮涓€绾︽潫銆佸簭鍒楀寲鎴栭獙璇佸け璐ワ細瀹屾暣 rollback銆?

### 4. 涓嶅彲閲嶅涓庣姝㈠弻鍐?

```text
migration_state = complete
鈫?/api/migration/indexeddb/import 杩斿洖 conflict
鈫?涓嶅彲瑕嗙洊宸叉湁 SQLite 涓诲簱

鍚庣画瀵煎叆澶栭儴 JSON
鈫?鍙兘璧?/api/backup/restore
鈫?鍏堝垱寤哄綋鍓?SQLite 鑷姩鎭㈠鐐?
鈫?涓嶈鍙栥€佸啓鍏ユ垨鍚屾 IndexedDB
```

杩佺Щ鎴愬姛涓嶅垹闄ゆ棫 IndexedDB銆傜敤鎴峰畬鎴愰噸鍚€佸鍑恒€佹仮澶嶆紨缁冨悗鍐嶈嚜琛屽喅瀹氭槸鍚︽竻鐞嗘祻瑙堝櫒鏁版嵁銆?

## 銆愪竷銆丣SON 澶囦唤涓庢仮澶嶃€?

### 1. 鐗堟湰绛栫暐

淇濇寔锛?

```text
BackupDocument.format = knowledge-base-backup
BackupDocument.version = 2
```

鏈涓嶅崌绾у浠界増鏈€係QLite 璺緞銆乄AL銆乻chema migration銆丩ocal API metadata銆佺鍙ｃ€佹満鍣ㄤ俊鎭拰杩佺Щ鐘舵€佸潎涓嶅緱杩涘叆 BackupDocument銆?

鍏煎瑙勫垯淇濇寔锛?

```text
v1锛歮ethodTombstones 缂哄け 鈫?[]
鏃?Item锛歴tartAction 缂哄け 鈫?undefined
startAction 闈?string 鈫?鎷掔粷
蹇呭～寮曠敤鏂 鈫?鎷掔粷
鍙€変笖鍙В閲婄殑鍘嗗彶闄嶇骇 鈫?鎸夋棦鏈夎鍒欏吋瀹?
```

### 2. SQLite 瀵煎嚭

`SqliteBackupRepository.exportData()` 蹇呴』鍦ㄤ竴鑷存€?read transaction 鍐呰鍙栧叏閮ㄤ笟鍔¤〃銆傝繑鍥為『搴忓拰瀵硅薄褰㈢姸蹇呴』瀵归綈鐜版湁 `BackupData`銆?

鐢辨湇鍔＄ `BackupApplicationService` 娌跨敤鏃㈡湁閫昏緫鐢熸垚瀹屾暣 JSON 鏂囨。銆傛祻瑙堝櫒鍙帴鏀朵笅杞藉唴瀹癸紝涓嶈嚜琛屾嫾 BackupData銆?

### 3. SQLite 鎭㈠

```text
涓婁紶 JSON
鈫?BackupApplicationService.parseAndValidate() 瀹屾暣鎴愬姛
鈫?鍒涘缓褰撳墠 SQLite JSON 鑷姩鎭㈠鐐?
鈫?鑷姩鎭㈠鐐规垚鍔熷啓鍏?
鈫?SQLite BEGIN IMMEDIATE
鈫?replaceData 鍏ㄩ噺鏇挎崲 + SQL 鍚庢牎楠?
鈫?COMMIT
鈫?淇濈暀鏈€杩?20 涓嚜鍔ㄦ仮澶嶇偣
```

澶辫触瑙勫垯锛?

```text
瑙ｆ瀽 / 鏍￠獙澶辫触
鈫?涓嶅垱寤烘仮澶嶇偣銆佷笉淇敼 SQLite銆?

鎭㈠鐐瑰垱寤哄け璐?
鈫?涓嶄慨鏀?SQLite銆?

replaceData / SQL 鏍￠獙澶辫触
鈫?SQLite 鍥炴粴涓烘仮澶嶅墠瀹屾暣鏁版嵁銆?

鎭㈠鎴愬姛鍚庢仮澶嶇偣娓呯悊澶辫触
鈫?鎭㈠淇濇寔鎴愬姛锛涜褰曟槑纭憡璀︼紱涓嶅垹闄ゆ洿澶氭枃浠躲€?
```

## 銆愬叓銆佸墠绔垏鎹笌鏁版嵁搴撻樆鏂〉銆?

### 1. 鍒囨崲鍘熷垯

鍓嶇鏈疆涓嶆槸灏?Dexie 鎹负 fetch 鐨勯浂鏁ｆ浛鎹€傚繀椤伙細

```text
椤甸潰鍚姩
鈫?local-api-client.health()
鈫?鍙湁 ready 鎵嶅姞杞藉伐浣滃彴鏁版嵁
鈫?鎵€鏈夎鍐欑粡 local-api-client 鈫?Local API
```

鍓嶇涓嶅緱锛?

```text
鍒涘缓 IndexedDB fallback
缁存姢涓?SQLite 骞惰鐨勬湰鍦颁笟鍔＄姸鎬佷綔涓烘寔涔呭寲鏇夸唬
鐩存帴瑙ｆ瀽 / 鎷艰鏁版嵁搴撳叧绯?
閬囧埌 API 閿欒鏄剧ず绌烘暟鎹?
```

### 2. 鏈€灏忛樆鏂〉

#### API 鏈繍琛?/ 鏃犳硶杩炴帴

```text
鏍囬锛氭湰鏈烘暟鎹簱鏈氨缁?
璇存槑锛氭棤娉曡繛鎺ユ湰鏈?Local API銆備綘鐨勪簨椤瑰皻鏈璇诲彇锛涜繖涓嶆槸鈥滄殏鏃犱簨椤光€濄€?
鎿嶄綔锛氶噸璇曡繛鎺?
杈呭姪锛氳鍚姩 Local API锛屽苟璁块棶 http://127.0.0.1:32145銆?
```

#### 鏁版嵁搴撴崯鍧?/ 鏃犳硶鎵撳紑

```text
鏍囬锛氭湰鍦版暟鎹簱涓嶅彲鐢?
璇存槑锛氭湰鏈烘暟鎹簱鏃犳硶閫氳繃妫€鏌ユ垨鏃犳硶鎵撳紑锛岀郴缁熸病鏈夊姞杞戒换浣曟暟鎹€?
璺緞锛?LOCALAPPDATA%\Knowledge_Base\knowledge-base.db
鎿嶄綔锛氶噸璇曟鏌?/ 鏌ョ湅鎭㈠姝ラ
鎻愮ず锛氳鍏堜繚鐣欏師鏂囦欢鍓湰锛屽啀浠庡畬鏁?JSON 澶囦唤鎭㈠銆?
```

#### 棣栨杩佺Щ

```text
鏍囬锛氶渶瑕佽縼绉荤幇鏈夋湰鍦版暟鎹?
璇存槑锛氳鍏堝湪鏃у伐浣滃彴瀵煎嚭瀹屾暣 JSON锛屽啀瀵煎叆鍒版湰鏈?SQLite銆?
鎿嶄綔锛氶€夋嫨 JSON 骞跺鍏?
```

#### 杩愯鏃跺啓鍏ュけ璐?

```text
淇濈暀褰撳墠椤甸潰鑽夌
鈫?鏄剧ず鈥滄湰鏈烘暟鎹簱鏈啓鍏ワ紝璇烽噴鏀剧┖闂存垨瑙ｅ喅鍗犵敤鍚庨噸璇曗€?
鈫?绂佹鏄剧ず鎴愬姛鐘舵€佹垨鍋囧埛鏂?
```

### 3. 褰撳墠鍓嶇宸ヤ綔杈圭晫

鎵€鏈夋湰鍦板瓨鍌ㄣ€丄PI client銆侀樆鏂〉涓庝笟鍔＄敤渚嬪垏鎹㈠繀椤诲湪 SQLite Repository + Local API + 鏁版嵁灞?QA 閫氳繃鍚庡紑濮嬨€傚墠绔笉寰楀厛鎶婃棫椤甸潰鏀归€犳垚鈥滅┖ SQLite 宸ヤ綔鍙扳€濄€?

## 銆愪節銆丟it銆侀殣绉佷笌杩愯鏁版嵁銆?

蹇呴』鏇存柊 `.gitignore`锛?

```gitignore
*.db
*.db-wal
*.db-shm
*.sqlite
*.sqlite3
knowledge-base-backup*.json
/backups/
```

鍚屾椂纭锛?

```text
%LOCALAPPDATA%\Knowledge_Base\
涓嶄綅浜庝粨搴撳唴锛涗笉搴斾緷璧?gitignore 淇濇姢銆?
```

绂佹鎻愪氦锛?

```text
浠讳綍 SQLite 涓诲簱 / WAL / SHM
浠讳綍 JSON 鐢ㄦ埛澶囦唤銆佽嚜鍔ㄦ仮澶嶇偣鎴栬縼绉绘牱鏈湡瀹炴暟鎹?
鍖呭惈鐪熷疄涓汉鏁版嵁鐨勬祴璇曞浐瀹氭枃浠?
```

娴嬭瘯鍙兘浣跨敤鍚堟垚鏁版嵁鍜屾祴璇曚复鏃剁洰褰曘€?

## 銆愬崄銆佸疄鏂藉垎鏈熶笌璐ｄ换娴佽浆銆?

### Phase 0锛氬熀纭€璁炬柦鍐荤粨锛堟灦鏋勶級

浜у嚭锛?

```text
鏈换鍔′功瀹￠槄瀹屾垚
SQLite DDL / migration strategy
API 璺敱 / health / error DTO 鍐荤粨
IndexedDB JSON 杩佺Щ鐘舵€佹満鍐荤粨
```

### Phase 1锛歋QLite 鏁版嵁灞傦紙Application / Repository锛?

鍏佽淇敼锛?

```text
packages/storage-sqlite/**
packages/contracts/**锛堝繀瑕佸叡浜?DTO锛?
packages/application/**锛堝繀瑕佹湇鍔＄瑁呴厤閫傞厤锛?
tests/**
package.json / pnpm-lock.yaml / pnpm-workspace.yaml
.gitignore
docs/architecture/**
```

浜や粯锛?

```text
SQLite connection / DDL migration
瀹屾暣 SQLite Repository Contracts
SQLite BackupRepository
SQLite 鏁版嵁灞傝嚜鍔ㄥ寲
```

绂佹淇敼鍓嶇鐢熶骇瑁呴厤銆?

### Phase 2锛歀ocal API銆佽縼绉讳笌鎭㈠锛圓pplication / Repository锛?

鍏佽淇敼锛?

```text
apps/local-api/**
packages/local-api-client/**锛堜粎 API client 楠ㄦ灦锛?
packages/storage-indexeddb/**锛堜粎杩佺Щ鏉ユ簮 / 娴嬭瘯閫傞厤锛?
tests/**
README.md
```

浜や粯锛?

```text
127.0.0.1:32145 API
health / error Contract
闈欐€?H5 鎵樼
JSON 涓€娆℃€у鍏?
migration metadata
鑷姩鎭㈠鐐逛笌鏈€杩?20 涓繚鐣?
```

### Phase 3锛氭暟鎹彲淇?QA

QA 蹇呴』鍏堥獙璇侊細

```text
SQLite Repository 鍏ㄩ噺涓氬姟鍥炲綊
JSON v1 / v2 瀵煎叆瀵煎嚭
棣栨杩佺Щ銆侀噸澶嶈縼绉汇€侀儴鍒嗗け璐?rollback
鎭㈠鐐瑰垱寤哄け璐ヤ繚鎶?
replaceData rollback
鏂规硶澧撶 / 鏂鍏宠仈 / 鍚姩鍔ㄤ綔 / 鍥炴敹绔?
Windows LOCALAPPDATA 鐪熷疄璺緞鍚姩 / 閲嶅惎楠岃瘉
```

鏈粡 QA 閫氳繃锛屼笉寰楁妸鏃ュ父鍓嶇鍒囨崲鍒?API銆?

### Phase 4锛氬墠绔?API 鍒囨崲锛堝墠绔級

鍏佽淇敼锛?

```text
apps/client/**
packages/local-api-client/**
鍓嶇鐩稿叧娴嬭瘯
README.md锛堝叆鍙ｈ鏄庯級
```

浜や粯锛?

```text
health gate 闃绘柇椤?
杩佺Щ鍚戝
Local API client 鎺ュ叆
鎵€鏈夊伐浣滃彴璇诲啓浠?IndexedDB 鍒囧埌 API
绉婚櫎 IndexedDB 鏃ュ父鐢熶骇瑁呴厤
```

### Phase 5锛歈A 涓庝骇鍝?UAT

```text
H5 鐪熷疄娴忚鍣ㄨ縼绉?
鍏抽棴娴忚鍣?/ 閲嶅惎 Local API / 閲嶅惎鏈哄櫒
浠?SQLite 閲嶈鎵€鏈夋暟鎹?
瀵煎嚭 SQLite JSON
鎭㈠鍒扮┖娴嬭瘯 SQLite
楠岃瘉浜嬮」銆佺姸鎬佷簨浠躲€佸鐩樸€佹柟娉曘€佺増鏈€佽瘉鎹€佸簲鐢ㄣ€佸纰戙€佸洖鏀剁珯銆乧ontent銆乻tartAction
```

### Phase 6锛氫骇鍝侀獙鏀朵笌灏佹澘

```text
浜у搧楠岃瘉杩佺Щ SOP
纭鏃?IndexedDB 鏈鑷姩鍒犻櫎
纭 SQLite 鏄敮涓€涓诲簱
纭澶囦唤鎭㈠婕旂粌鎴愬姛
褰掓。鏂囨。銆佺嫭绔?Git 鎻愪氦銆丼print 灏佹澘
```

## 銆愬崄涓€銆佽嚜鍔ㄥ寲娴嬭瘯涓庤縼绉婚獙鏀剁煩闃点€?

### A. SQLite Repository 鍥炲綊

蹇呴』灏嗘棦鏈?Repository 娴嬭瘯鐭╅樀杩佺Щ鍒版瘡娴嬭瘯鐙珛鐨勪复鏃?SQLite 鏂囦欢锛?

```text
Item create / list / trash
鐘舵€佹満涓庡敮涓€鐘舵€佷簨浠?
startExecution 鍘熷瓙鍐欏叆鍙婂け璐?rollback
content 鏇存柊涓庣姸鎬?/ 鍒犻櫎 / 鎭㈠骞跺彂
purgeDeletedBefore 涓?restore 浜ら敊
completeReview 鍏ㄦ湁鎴栧叏鏃?
褰㈡垚 / 楠岃瘉 / 淇鏂规硶
鏂规硶鐗堟湰銆佽瘉鎹€佹柟娉曞簲鐢?
鏂规硶鍥炴敹绔欍€佹仮澶嶃€佸埌鏈熸案涔呮竻鐞嗕笌澧撶
鏂涓婁笅鏂囦笌鎵归噺鏉ユ簮灞曠ず
鎼滅储銆佷华琛ㄧ洏銆佸洖鏀剁珯
```

涓嶈兘鍥犻┍鍔ㄤ粠 IndexedDB 鏀逛负 SQLite 鑰屽垹闄ゅ凡鍏抽棴 P0 鐨勪氦閿欐祴璇曘€?

### B. 澶囦唤鎭㈠

蹇呴』瑕嗙洊锛?

1. SQLite v2 瀵煎嚭 鈫?parse 鈫?鏂?SQLite 鎭㈠锛岄€愰泦鍚堜笌瀛楁涓€鑷达紱
2. v1 缂?`methodTombstones`銆佹棫 Item 缂?`startAction` 鍙仮澶嶏紱
3. 闈?string `startAction`銆佸繀濉紩鐢ㄦ柇瑁傘€佸悓 ID 鏂规硶涓庡纰戝苟瀛樹弗鏍兼嫆缁濓紱
4. 涓€鑷存€у鍑轰笉浼氭贩鍚堜笉鍚屼簨鍔℃椂鍒荤殑璺ㄨ〃鏁版嵁锛?
5. 鑷姩鎭㈠鐐瑰啓鍏ュけ璐ユ椂锛屾嫆缁濇仮澶嶄笖鍘?SQLite 涓嶅彉锛?
6. restore 鍐呬换鎰?insert 鎴栧悗鏍￠獙澶辫触鏃讹紝鍘?SQLite 瀹屾暣淇濈暀锛?
7. 鎴愬姛鎭㈠鍚庝繚鐣欐渶杩?20 涓嚜鍔ㄦ仮澶嶇偣銆佹寜鏈€鏃т紭鍏堟竻鐞嗐€?

### C. IndexedDB JSON 涓€娆℃€ц縼绉?

蹇呴』瑕嗙洊锛?

1. 宸查獙璇?v2 JSON 瀵煎叆绌?SQLite 鍚庯紝9 涓?BackupData 闆嗗悎鍏ㄩ噺涓€鑷达紱
2. `content`銆乣startAction`銆乣deletedAt`銆佺姸鎬佷簨浠躲€佸纰戠増鏈槧灏勫拰鎵€鏈夊叧绯诲畬鏁翠繚鐣欙紱
3. source hash銆佽縼绉绘椂闂淬€乧omplete 鐘舵€佷笌涓氬姟鏁版嵁鍚屼簨鍔℃彁浜わ紱
4. 杩佺Щ绗簩娆¤姹傛嫆缁濓紝涓嶈鐩栧凡鏈?SQLite锛?
5. JSON 鏍￠獙澶辫触涓嶅啓 SQLite锛?
6. 浠绘剰 bulk insert / metadata 鍐欏叆澶辫触锛屼笟鍔¤〃鍜?metadata 鍧?rollback锛?
7. 鎴愬姛杩佺Щ鍚?SQLite 鍐嶅鍑恒€佸啀鎭㈠鍒版柊搴撲竴鑷达紱
8. IndexedDB 鏉ユ簮娴嬭瘯搴撳湪鎴愬姛 / 澶辫触鍚庡潎鏈鏀瑰啓銆?

### D. Local API / 鍓嶇寮傚父

蹇呴』瑕嗙洊锛?

```text
127.0.0.1:32145 姝ｅ父鐩戝惉
闈?127.0.0.1 缁戝畾琚厤缃眰鎷掔粷鎴栨棤鐩戝惉璇佹槑
绔彛鍗犵敤澶辫触涓嶈嚜鍔ㄥ垏鎹㈢鍙?
API 鏈惎鍔?/ connection refused
鏁版嵁鐩綍涓嶅瓨鍦ㄥ彲鍒涘缓
鐩綍涓嶅彲鍐?
鏁版嵁搴撻攣瓒呮椂
quick_check 澶辫触
migration-required
migration-in-progress
storage-write-failed
涓氬姟 not-found / conflict 涓?infrastructure error 鍒嗙
```

H5 浜哄伐 UAT 鑷冲皯锛?

```text
API 涓嶅彲鐢ㄦ椂涓嶆槸绌烘€?
杩佺Щ鍓嶅繀椤绘彁绀烘棫 JSON 瀵煎嚭
鐪熷疄 SQLite 杩佺Щ鍚庢祻瑙堝櫒鍒锋柊浠嶆湁鏁版嵁
鍏抽棴娴忚鍣ㄣ€侀噸鍚?API銆侀噸鍚數鑴戝悗鏁版嵁浠嶅湪
鏃?IndexedDB 涓嶅啀琚柊宸ヤ綔鍙拌鍐?
SQLite JSON 瀵煎嚭涓庢仮澶嶆紨缁冩垚鍔?
127.0.0.1 鍙闂紝灞€鍩熺綉 IP 涓嶅彲璁块棶
```

## 銆愬崄浜屻€佹槑纭姝€?

```text
缁х画浠ユ祻瑙堝櫒 IndexedDB 浣滀负闀挎湡涓诲簱
IndexedDB 涓?SQLite 闀挎湡鍙屽啓
灏?.db銆?wal銆?shm銆丣SON 澶囦唤鎴栫湡瀹炰釜浜烘暟鎹彁浜?Git
鐩戝惉 0.0.0.0銆佸眬鍩熺綉鎴栧叕缃?
璐﹀彿銆佺櫥褰曘€佹潈闄愩€佷簯绔€佸悓姝ャ€佸崗浣溿€佽繙绋?DB銆侀儴缃?
鍓嶇鐩存帴璋冪敤 SQLite銆佹枃浠剁郴缁熸垨 SQL
鍥犺縼绉诲垹鍑忕姸鎬併€佽瘉鎹€佺増鏈€佸洖鏀剁珯銆佸纰戞垨鍘嗗彶鍏宠仈
鏁版嵁搴撻敊璇樉绀轰负鈥滄殏鏃犱簨椤光€?
quick_check 澶辫触鍚庡垱寤虹┖搴撹鐩栧師鏂囦欢
鐢?SQLite 杩佺Щ椤哄甫閲嶅啓鐘舵€佹満銆佽矾鐢便€佸叏灞€鐘舵€佸簱鎴?UI
```

## 銆愪氦浠樼粰鐮斿彂鐨勬妧鏈害鏉熴€?

```text
鏈换鍔′功宸插喕缁撴柟鍚戯紝浣嗗皻鏈巿鏉冪洿鎺ュ疄鐜般€?

姝ｅ紡寮€宸ュ墠锛屽繀椤荤敱鏋舵瀯甯堝啀杈撳嚭锛?
1. SQLite DDL 涓?SQL migration 鐨勯€愮増鏈疄鏂芥竻鍗曪紱
2. 鍏ㄩ儴 API request / response DTO 涓庤矾鐢辨潈闄愶紙Origin锛夋竻鍗曪紱
3. SQLite Repository 瀵圭幇鏈夋瘡涓?Contract 鐨勫疄鐜版槧灏勮〃锛?
4. JSON migration / restore 鐨勭簿纭畬鏁存€ф瘮瀵圭畻娉曪紱
5. 杩佺Щ鍚戝鐘舵€佷笌鍓嶇閿欒鏂囨楠屾敹绋匡紱
6. Phase 1 鏁版嵁灞備笓椤规祴璇曟竻鍗曘€?

瀹炴柦椤哄簭涓嶅彲棰犲€掞細
SQLite 鏁版嵁灞?
鈫?Local API + 杩佺Щ / 澶囦唤鎭㈠
鈫?QA 鏁版嵁鍙俊鎬ч獙璇?
鈫?鍓嶇 API 鍒囨崲涓庨樆鏂〉
鈫?H5 / Windows 閲嶅惎 UAT
鈫?浜у搧楠屾敹銆?
```

## 銆愪笅涓€璐ｄ换宀椼€?

```text
鏋舵瀯甯堬細杈撳嚭涓婅堪寮€宸ュ墠鐨勫疄鐜拌鏍艰ˉ鍏?
鈫?Application / Repository 宸ョ▼甯堬細Phase 1 SQLite 鏁版嵁灞?
```
