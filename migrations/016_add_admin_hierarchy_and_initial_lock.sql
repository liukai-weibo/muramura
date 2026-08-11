ALTER TABLE users
  ADD COLUMN is_initial_platform_admin TINYINT(1) NOT NULL DEFAULT 0 AFTER deleted_at,
  ADD KEY users_initial_platform_admin_idx (is_initial_platform_admin);

ALTER TABLE user_roles
  DROP CHECK user_roles_role_code_check,
  ADD COLUMN platform_admin_guard TINYINT AS (IF(role_code = 'platform_admin', 1, NULL)) STORED,
  ADD UNIQUE KEY user_roles_single_platform_admin_unique (platform_admin_guard),
  ADD CONSTRAINT user_roles_role_code_check CHECK (role_code IN ('member', 'ordinary_admin', 'platform_admin'));

ALTER TABLE security_audit_events
  DROP CHECK security_audit_events_action_code_check,
  ADD CONSTRAINT security_audit_events_action_code_check CHECK (action_code IN (
    'platform_admin_granted',
    'platform_admin_revoked',
    'ordinary_admin_granted',
    'ordinary_admin_revoked',
    'user_sessions_revoked',
    'user_soft_deleted',
    'user_restored',
    'user_username_changed',
    'user_password_reset'
  ));

UPDATE users u
JOIN (
  SELECT target_user_id
  FROM security_audit_events
  WHERE actor_user_id IS NULL AND action_code = 'platform_admin_granted'
  GROUP BY target_user_id
  HAVING COUNT(*) = 1
) initial ON initial.target_user_id = u.id
SET u.is_initial_platform_admin = 1
WHERE EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = u.id AND r.role_code = 'platform_admin');
