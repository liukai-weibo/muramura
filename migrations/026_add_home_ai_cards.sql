CREATE TABLE user_home_ai_cards (
  id CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NOT NULL,
  card_title VARCHAR(50) NOT NULL,
  ai_prompt TEXT NOT NULL,
  card_size VARCHAR(10) NOT NULL DEFAULT 'medium',
  card_theme VARCHAR(16) NOT NULL DEFAULT 'cream',
  refresh_mode VARCHAR(10) NOT NULL DEFAULT 'daily',
  sort_index INT NOT NULL DEFAULT 0,
  is_hidden TINYINT(1) NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY user_home_ai_cards_owner_sort_idx (owner_user_id, sort_index),
  CONSTRAINT user_home_ai_cards_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id)
) ENGINE=InnoDB;

CREATE TABLE user_home_ai_card_caches (
  id CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NOT NULL,
  card_id CHAR(36) NOT NULL,
  cache_date DATE NOT NULL,
  ai_output TEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY user_home_ai_card_cache_owner_card_date_idx (owner_user_id, card_id, cache_date),
  CONSTRAINT user_home_ai_card_caches_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT user_home_ai_card_caches_card_fk FOREIGN KEY (card_id) REFERENCES user_home_ai_cards(id) ON DELETE CASCADE
) ENGINE=InnoDB;
