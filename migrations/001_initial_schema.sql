CREATE TABLE IF NOT EXISTS schema_migrations (
  version INT PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  checksum CHAR(64) NOT NULL,
  applied_at DATETIME(3) NOT NULL
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS items (id VARCHAR(128) PRIMARY KEY, title TEXT NOT NULL, content TEXT NOT NULL, status VARCHAR(64) NOT NULL, start_action TEXT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, deleted_at DATETIME(3) NULL) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS reviews (id VARCHAR(128) PRIMARY KEY, item_id VARCHAR(128) NOT NULL, actual_action TEXT NOT NULL, result TEXT NOT NULL, effective TEXT NOT NULL, incompatible TEXT NOT NULL, reason TEXT NOT NULL, adjustment TEXT NOT NULL, new_ideas TEXT NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, UNIQUE KEY reviews_item_id_unique (item_id), CONSTRAINT reviews_item_fk FOREIGN KEY (item_id) REFERENCES items(id)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS methods (id VARCHAR(128) PRIMARY KEY, title TEXT NOT NULL, applicable TEXT NOT NULL, unsuitable TEXT NOT NULL, steps TEXT NOT NULL, validation_count INT NOT NULL, version INT NOT NULL, created_at DATETIME(3) NOT NULL, updated_at DATETIME(3) NOT NULL, deleted_at DATETIME(3) NULL) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS method_versions (id VARCHAR(128) PRIMARY KEY, method_id VARCHAR(128) NOT NULL, version INT NOT NULL, title TEXT NOT NULL, applicable TEXT NOT NULL, unsuitable TEXT NOT NULL, steps TEXT NOT NULL, source_review_id VARCHAR(128) NULL, created_at DATETIME(3) NOT NULL, UNIQUE KEY method_versions_method_version_unique (method_id, version)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS method_evidence (id VARCHAR(128) PRIMARY KEY, method_id VARCHAR(128) NOT NULL, review_id VARCHAR(128) NOT NULL, relation VARCHAR(32) NOT NULL, method_version INT NULL, created_at DATETIME(3) NOT NULL) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS method_applications (id VARCHAR(128) PRIMARY KEY, method_id VARCHAR(128) NOT NULL, method_version INT NOT NULL, item_id VARCHAR(128) NOT NULL, created_at DATETIME(3) NOT NULL, CONSTRAINT method_applications_item_fk FOREIGN KEY (item_id) REFERENCES items(id)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS method_tombstones (method_id VARCHAR(128) PRIMARY KEY, title TEXT NOT NULL, permanently_deleted_at DATETIME(3) NOT NULL, versions JSON NOT NULL) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS item_status_events (id VARCHAR(128) PRIMARY KEY, item_id VARCHAR(128) NOT NULL, from_status VARCHAR(64) NULL, to_status VARCHAR(64) NOT NULL, created_at DATETIME(3) NOT NULL, CONSTRAINT item_status_events_item_fk FOREIGN KEY (item_id) REFERENCES items(id)) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS item_links (id VARCHAR(128) PRIMARY KEY, source_review_id VARCHAR(128) NOT NULL, target_item_id VARCHAR(128) NOT NULL, type VARCHAR(64) NOT NULL, created_at DATETIME(3) NOT NULL, CONSTRAINT item_links_review_fk FOREIGN KEY (source_review_id) REFERENCES reviews(id), CONSTRAINT item_links_target_item_fk FOREIGN KEY (target_item_id) REFERENCES items(id)) ENGINE=InnoDB;
