CREATE TABLE activity_audit_events (
  id VARCHAR(128) NOT NULL,
  actor_user_id VARCHAR(128) NOT NULL,
  actor_username VARCHAR(255) NULL,
  module_code VARCHAR(32) NOT NULL,
  action_code VARCHAR(32) NOT NULL,
  entity_id VARCHAR(128) NULL,
  snapshot TEXT NULL,
  risk_level VARCHAR(16) NOT NULL DEFAULT 'normal',
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY activity_audit_actor_created_idx (actor_user_id, created_at DESC, id),
  KEY activity_audit_module_created_idx (module_code, created_at DESC, id),
  CONSTRAINT activity_audit_events_module_check CHECK (module_code IN ('daily_note', 'mood', 'meal', 'item', 'search')),
  CONSTRAINT activity_audit_events_action_check CHECK (action_code IN ('create', 'update', 'delete', 'search')),
  CONSTRAINT activity_audit_events_actor_user_fk FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
