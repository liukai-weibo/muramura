ALTER TABLE users ADD COLUMN deleted_at DATETIME(3) NULL AFTER updated_at;

ALTER TABLE security_audit_events DROP CHECK security_audit_events_action_code_check;
ALTER TABLE security_audit_events ADD CONSTRAINT security_audit_events_action_code_check CHECK (action_code IN ('platform_admin_granted', 'platform_admin_revoked', 'user_sessions_revoked', 'user_soft_deleted', 'user_restored'));
