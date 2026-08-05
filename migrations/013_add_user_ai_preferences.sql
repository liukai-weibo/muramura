CREATE TABLE user_ai_preferences (
  id CHAR(36) NOT NULL PRIMARY KEY,
  owner_user_id CHAR(36) NOT NULL,
  preference_key VARCHAR(32) NOT NULL,
  preference_value VARCHAR(2000) NOT NULL,
  source_code VARCHAR(32) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  CONSTRAINT user_ai_preferences_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_ai_preferences_key_check CHECK (preference_key IN ('response_style', 'response_length', 'working_style', 'custom_rule')),
  CONSTRAINT user_ai_preferences_source_check CHECK (source_code = 'user_confirmed'),
  INDEX user_ai_preferences_owner_updated_idx (owner_user_id, updated_at, id)
) ENGINE=InnoDB;
