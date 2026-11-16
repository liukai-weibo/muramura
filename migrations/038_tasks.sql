-- 任务系统：今日任务 + 任务池。
--
-- 状态机：
--   active（今日） / pool（任务池） --领取--> active --完成--> completed（界面隐藏）
--   active --放弃--> pool（可再次领取）
-- 完成时间只对 completed 有值，保留给未来的积分/统计。

CREATE TABLE tasks (
  id CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NOT NULL,
  title VARCHAR(120) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  completed_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY tasks_owner_status_updated (owner_user_id, status, updated_at),
  CONSTRAINT tasks_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT tasks_status_check CHECK (status IN ('active', 'pool', 'completed')),
  CONSTRAINT tasks_completed_check CHECK (
    (status = 'completed' AND completed_at IS NOT NULL)
    OR (status <> 'completed' AND completed_at IS NULL)
  )
) ENGINE=InnoDB;
