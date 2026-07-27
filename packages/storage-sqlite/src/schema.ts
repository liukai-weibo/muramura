import type Database from 'better-sqlite3'

export const SQLITE_SCHEMA_VERSION = 1

const schemaV1 = `
CREATE TABLE items (id TEXT PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('idea_to_try','idea_later','doing','paused','waiting_review','reviewed','archived_no_review','abandoned')), created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT, start_action TEXT);
CREATE INDEX idx_items_active_status_updated ON items(status, updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_deleted_at ON items(deleted_at);
CREATE TABLE item_status_events (id TEXT PRIMARY KEY, item_id TEXT NOT NULL, from_status TEXT, to_status TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE RESTRICT);
CREATE INDEX idx_item_status_events_item_created ON item_status_events(item_id, created_at);
CREATE TABLE reviews (id TEXT PRIMARY KEY, item_id TEXT NOT NULL UNIQUE, actual_action TEXT NOT NULL, result TEXT NOT NULL, effective TEXT NOT NULL, incompatible TEXT NOT NULL, reason TEXT NOT NULL, adjustment TEXT NOT NULL, new_ideas TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE RESTRICT);
CREATE TABLE methods (id TEXT PRIMARY KEY, title TEXT NOT NULL, applicable TEXT NOT NULL, unsuitable TEXT NOT NULL, steps TEXT NOT NULL, validation_count INTEGER NOT NULL, version INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT);
CREATE INDEX idx_methods_active_updated ON methods(updated_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_methods_deleted_at ON methods(deleted_at);
CREATE TABLE method_versions (id TEXT PRIMARY KEY, method_id TEXT NOT NULL, version INTEGER NOT NULL, title TEXT NOT NULL, applicable TEXT NOT NULL, unsuitable TEXT NOT NULL, steps TEXT NOT NULL, source_review_id TEXT, created_at TEXT NOT NULL, UNIQUE(method_id, version));
CREATE INDEX idx_method_versions_source_review ON method_versions(source_review_id);
CREATE TABLE method_evidence (id TEXT PRIMARY KEY, method_id TEXT NOT NULL, review_id TEXT NOT NULL, created_at TEXT NOT NULL, relation TEXT CHECK(relation IN ('formation','validation','revision','unknown')), method_version INTEGER);
CREATE UNIQUE INDEX idx_method_evidence_method_review ON method_evidence(method_id, review_id);
CREATE INDEX idx_method_evidence_method ON method_evidence(method_id); CREATE INDEX idx_method_evidence_review ON method_evidence(review_id);
CREATE TABLE method_applications (id TEXT PRIMARY KEY, method_id TEXT NOT NULL, method_version INTEGER NOT NULL, item_id TEXT NOT NULL UNIQUE, created_at TEXT NOT NULL, FOREIGN KEY(item_id) REFERENCES items(id) ON DELETE RESTRICT);
CREATE INDEX idx_method_applications_method_version ON method_applications(method_id, method_version);
CREATE TABLE method_tombstones (method_id TEXT PRIMARY KEY, title TEXT NOT NULL, permanently_deleted_at TEXT NOT NULL, versions_json TEXT NOT NULL);
CREATE TABLE item_links (id TEXT PRIMARY KEY, source_review_id TEXT NOT NULL, target_item_id TEXT NOT NULL, type TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(source_review_id) REFERENCES reviews(id) ON DELETE RESTRICT, FOREIGN KEY(target_item_id) REFERENCES items(id) ON DELETE RESTRICT);
CREATE INDEX idx_item_links_source_review ON item_links(source_review_id); CREATE INDEX idx_item_links_target_item ON item_links(target_item_id);
CREATE TABLE system_metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export function applySchemaMigrations(database: Database.Database): void {
  database.exec('CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)')
  if (database.prepare('SELECT 1 FROM schema_migrations WHERE version = 1').get()) return
  database.transaction(() => {
    database.exec(schemaV1)
    database.prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)').run(SQLITE_SCHEMA_VERSION, new Date().toISOString())
  })()
}
