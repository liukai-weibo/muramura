-- 睡眠记录与提醒设置。
--
-- 一条睡眠 = 入睡时间 + 起床时间；起床可以暂时为空（晚上先记入睡，次日补起床）。
-- sleep_date 是「起床那天的东八区日期」，与手记日界一致；时刻按 UTC 存储。
-- 设置每用户单行：提醒开关、提醒时间段（本地分钟数）、输入精度、当天是否已提醒过。

CREATE TABLE sleep_entries (
  id CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NOT NULL,
  sleep_date DATE NOT NULL COMMENT '起床日的东八区日期',
  bed_at DATETIME(3) NOT NULL COMMENT 'UTC，入睡时刻',
  wake_at DATETIME(3) NULL COMMENT 'UTC，起床时刻；NULL=还没记起床',
  note VARCHAR(200) NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY se_owner_date_uq (owner_user_id, sleep_date),
  CONSTRAINT se_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT se_range_check CHECK (wake_at IS NULL OR wake_at > bed_at)
) ENGINE=InnoDB;

CREATE TABLE user_sleep_settings (
  owner_user_id CHAR(36) NOT NULL,
  remind_enabled TINYINT(1) NOT NULL DEFAULT 1,
  remind_start_minute SMALLINT UNSIGNED NOT NULL DEFAULT 720 COMMENT '12:00',
  remind_end_minute SMALLINT UNSIGNED NOT NULL DEFAULT 1410 COMMENT '23:30',
  input_precision VARCHAR(8) NOT NULL DEFAULT 'hour' COMMENT 'hour=整点，minute=精确到分钟',
  last_prompted_date DATE NULL COMMENT '最近提醒/关闭提醒的东八区日期',
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (owner_user_id),
  CONSTRAINT uss_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT uss_window_check CHECK (remind_start_minute < remind_end_minute AND remind_end_minute <= 1439),
  CONSTRAINT uss_precision_check CHECK (input_precision IN ('hour', 'minute'))
) ENGINE=InnoDB;
