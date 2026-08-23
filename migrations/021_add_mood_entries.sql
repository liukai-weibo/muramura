CREATE TABLE mood_entries (
  id CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NOT NULL,
  entry_date DATE NOT NULL,
  content VARCHAR(2000) NOT NULL,
  mood_level TINYINT NOT NULL,
  tags TEXT NOT NULL DEFAULT '[]',
  response TEXT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY mood_entries_owner_date_idx (owner_user_id, entry_date DESC, created_at DESC),
  CONSTRAINT mood_entries_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB;