ALTER TABLE ai_conversations
  DROP INDEX ai_conversations_owner_unique,
  ADD COLUMN title VARCHAR(160) NOT NULL DEFAULT '默认会话' AFTER owner_user_id,
  ADD COLUMN archived_at DATETIME(3) NULL AFTER updated_at,
  ADD COLUMN deleted_at DATETIME(3) NULL AFTER archived_at,
  ADD KEY ai_conversations_owner_lifecycle_updated_idx (owner_user_id, deleted_at, archived_at, updated_at, id),
  ADD KEY ai_conversations_owner_deleted_updated_idx (owner_user_id, deleted_at, updated_at, id);
