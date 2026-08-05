CREATE TABLE ai_conversations (
  id VARCHAR(128) NOT NULL,
  owner_user_id VARCHAR(128) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ai_conversations_owner_unique (owner_user_id),
  CONSTRAINT ai_conversations_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE ai_conversation_messages (
  id VARCHAR(128) NOT NULL,
  conversation_id VARCHAR(128) NOT NULL,
  owner_user_id VARCHAR(128) NOT NULL,
  sequence_no BIGINT NOT NULL,
  role_code VARCHAR(16) NOT NULL,
  status_code VARCHAR(16) NOT NULL,
  content MEDIUMTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY ai_conversation_messages_sequence_unique (conversation_id, sequence_no),
  KEY ai_conversation_messages_owner_created_idx (owner_user_id, created_at, id),
  CONSTRAINT ai_conversation_messages_role_check CHECK (role_code IN ('user', 'assistant')),
  CONSTRAINT ai_conversation_messages_status_check CHECK (status_code IN ('completed', 'incomplete', 'aborted', 'error')),
  CONSTRAINT ai_conversation_messages_conversation_fk FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE,
  CONSTRAINT ai_conversation_messages_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB;
