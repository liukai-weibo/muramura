-- 今日饮食推荐 · 个人档案（服务端存储 + 审计）
-- 每用户单行：用户可配置身高/体重/年龄/性别/目标/日常活动量/健康状态，保存后后端记录审计（module=daily_diet, action=update）。

CREATE TABLE user_diet_profiles (
  owner_user_id CHAR(36) NOT NULL,
  height_cm SMALLINT UNSIGNED NULL,
  weight_kg SMALLINT UNSIGNED NULL,
  age SMALLINT UNSIGNED NULL,
  gender VARCHAR(16) NULL,
  goal VARCHAR(16) NULL,
  activity VARCHAR(16) NULL,
  health_note VARCHAR(500) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  PRIMARY KEY (owner_user_id),
  CONSTRAINT user_diet_profiles_owner_fk FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT user_diet_profiles_gender_check CHECK (gender IN ('male','female','other')),
  CONSTRAINT user_diet_profiles_goal_check CHECK (goal IN ('lose_fat','gain_muscle','maintain','other')),
  CONSTRAINT user_diet_profiles_activity_check CHECK (activity IN ('sedentary','light','moderate','high'))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
