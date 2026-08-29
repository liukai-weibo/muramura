-- 首页 AI 卡片「刷新」操作审计：刷新生成写缓存后记录 action=refresh（此前复用 update，快照为 cacheDate/cacheId 无可读价值）
-- 在既有 11 个动作后追加 'refresh'。

ALTER TABLE activity_audit_events
  DROP CHECK activity_audit_events_action_check,
  ADD CONSTRAINT activity_audit_events_action_check CHECK (action_code IN ('create', 'update', 'delete', 'search', 'assign', 'remove', 'restore', 'purge', 'archive', 'complete', 'append', 'refresh'));
