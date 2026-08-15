CREATE TABLE daily_notes (
  id CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NOT NULL,
  entry_date DATE NOT NULL,
  content MEDIUMTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY daily_notes_owner_date_unique (owner_user_id, entry_date),
  KEY daily_notes_owner_date_idx (owner_user_id, entry_date DESC),
  CONSTRAINT daily_notes_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
