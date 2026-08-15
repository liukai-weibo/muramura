ALTER TABLE ai_conversations
  ADD COLUMN conversation_kind VARCHAR(32) NOT NULL DEFAULT 'general' AFTER title;

ALTER TABLE daily_notes
  ADD COLUMN ai_conversation_id CHAR(36) NULL AFTER content,
  ADD KEY daily_notes_ai_conversation_idx (ai_conversation_id),
  ADD CONSTRAINT daily_notes_ai_conversation_fk FOREIGN KEY (ai_conversation_id) REFERENCES ai_conversations(id) ON DELETE SET NULL;
