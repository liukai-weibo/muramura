-- 安全审计中心二期：扩展活动审计事件枚举
-- activity_audit_events 的 module/action CHECK 约束由 5 模块 + 4 动作扩展为 14 模块 + 11 动作。
-- 新覆盖：探索轨道、方法、复盘、状态小结、饮食推荐、首页 AI 卡片、AI 偏好、AI 会话、AI 配置。

ALTER TABLE activity_audit_events
  DROP CHECK activity_audit_events_module_check,
  DROP CHECK activity_audit_events_action_check,
  ADD CONSTRAINT activity_audit_events_module_check CHECK (module_code IN ('daily_note', 'mood', 'meal', 'item', 'search', 'exploration_track', 'method', 'review', 'daily_summary', 'daily_diet', 'home_ai_card', 'ai_preference', 'ai_conversation', 'ai_config')),
  ADD CONSTRAINT activity_audit_events_action_check CHECK (action_code IN ('create', 'update', 'delete', 'search', 'assign', 'remove', 'restore', 'purge', 'archive', 'complete', 'append'));
