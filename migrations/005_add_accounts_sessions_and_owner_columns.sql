CREATE TABLE users (
  id VARCHAR(128) NOT NULL,
  username VARCHAR(80) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY users_username_unique (username)
) ENGINE=InnoDB;

CREATE TABLE user_sessions (
  id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  session_secret_hash BINARY(32) NOT NULL,
  expires_at DATETIME(3) NOT NULL,
  revoked_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY user_sessions_secret_hash_unique (session_secret_hash),
  KEY user_sessions_user_expires_idx (user_id, expires_at),
  CONSTRAINT user_sessions_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE initial_owner_claims (
  id VARCHAR(128) NOT NULL,
  user_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY initial_owner_claims_user_unique (user_id),
  CONSTRAINT initial_owner_claims_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

ALTER TABLE items ADD COLUMN owner_user_id VARCHAR(128) NULL DEFAULT NULL, ADD KEY items_owner_created_idx (owner_user_id, created_at), ADD CONSTRAINT items_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE reviews ADD COLUMN owner_user_id VARCHAR(128) NULL DEFAULT NULL, ADD KEY reviews_owner_created_idx (owner_user_id, created_at), ADD CONSTRAINT reviews_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE methods ADD COLUMN owner_user_id VARCHAR(128) NULL DEFAULT NULL, ADD KEY methods_owner_updated_idx (owner_user_id, updated_at), ADD CONSTRAINT methods_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE method_evidence ADD COLUMN owner_user_id VARCHAR(128) NULL DEFAULT NULL, ADD KEY method_evidence_owner_created_idx (owner_user_id, created_at), ADD CONSTRAINT method_evidence_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE method_versions ADD COLUMN owner_user_id VARCHAR(128) NULL DEFAULT NULL, ADD KEY method_versions_owner_created_idx (owner_user_id, created_at), ADD CONSTRAINT method_versions_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE method_applications ADD COLUMN owner_user_id VARCHAR(128) NULL DEFAULT NULL, ADD KEY method_applications_owner_created_idx (owner_user_id, created_at), ADD CONSTRAINT method_applications_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE item_status_events ADD COLUMN owner_user_id VARCHAR(128) NULL DEFAULT NULL, ADD KEY item_status_events_owner_created_idx (owner_user_id, created_at), ADD CONSTRAINT item_status_events_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE item_links ADD COLUMN owner_user_id VARCHAR(128) NULL DEFAULT NULL, ADD KEY item_links_owner_created_idx (owner_user_id, created_at), ADD CONSTRAINT item_links_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE method_tombstones ADD COLUMN owner_user_id VARCHAR(128) NULL DEFAULT NULL, ADD KEY method_tombstones_owner_deleted_idx (owner_user_id, permanently_deleted_at), ADD CONSTRAINT method_tombstones_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE exploration_tracks ADD COLUMN owner_user_id VARCHAR(128) NULL DEFAULT NULL, ADD KEY exploration_tracks_owner_updated_idx (owner_user_id, updated_at), ADD CONSTRAINT exploration_tracks_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT;
