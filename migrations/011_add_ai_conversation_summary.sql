ALTER TABLE ai_conversations
  ADD COLUMN summary_content MEDIUMTEXT NULL,
  ADD COLUMN summary_version INT NULL,
  ADD COLUMN summary_through_sequence BIGINT NULL,
  ADD COLUMN summary_updated_at DATETIME(3) NULL;
