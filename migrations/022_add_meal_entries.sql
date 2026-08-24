CREATE TABLE meal_entries (
  id CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NOT NULL,
  entry_date DATE NOT NULL,
  meal_type VARCHAR(16) NOT NULL,
  content VARCHAR(1000) NOT NULL,
  feeling TINYINT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY meal_entries_owner_date_type_idx (owner_user_id, entry_date, meal_type),
  KEY meal_entries_owner_date_idx (owner_user_id, entry_date DESC, created_at DESC),
  CONSTRAINT meal_entries_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB;
