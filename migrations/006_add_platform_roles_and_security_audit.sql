CREATE TABLE user_roles (
  user_id VARCHAR(128) NOT NULL,
  role_code VARCHAR(32) NOT NULL,
  granted_by_user_id VARCHAR(128) NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (user_id, role_code),
  KEY user_roles_role_user_idx (role_code, user_id),
  KEY user_roles_granted_by_created_idx (granted_by_user_id, created_at),
  CONSTRAINT user_roles_role_code_check CHECK (role_code IN ('member', 'platform_admin')),
  CONSTRAINT user_roles_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT user_roles_granted_by_user_fk FOREIGN KEY (granted_by_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE security_audit_events (
  id VARCHAR(128) NOT NULL,
  actor_user_id VARCHAR(128) NULL,
  target_user_id VARCHAR(128) NOT NULL,
  action_code VARCHAR(64) NOT NULL,
  operation_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY security_audit_events_operation_unique (operation_id),
  KEY security_audit_events_target_created_idx (target_user_id, created_at, id),
  KEY security_audit_events_actor_created_idx (actor_user_id, created_at, id),
  CONSTRAINT security_audit_events_action_code_check CHECK (action_code IN ('platform_admin_granted', 'platform_admin_revoked', 'user_sessions_revoked')),
  CONSTRAINT security_audit_events_actor_user_fk FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE RESTRICT,
  CONSTRAINT security_audit_events_target_user_fk FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO user_roles (user_id, role_code, granted_by_user_id, created_at)
SELECT id, 'member', NULL, created_at
FROM users;
