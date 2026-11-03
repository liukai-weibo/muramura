-- 手记条目化：一天由 12 个两小时时段组成，每段可容纳多条带分钟精度的记录。
-- 原实现把 HH:MM 当纯文本拼进 daily_notes.content，事后无法解析；appendToday 又只写当天。
-- 本迁移只做结构建立与旧数据整体搬运，不做启发式分块（不按 HH:MM 猜测切分）：
-- 每篇非空旧手记整体转为 1 条 time_precision='day' 条目，recorded_at 取该篇 created_at，
-- 文本逐字保留，既不丢内容也不会因猜测而错位。
-- daily_notes 表结构不变，其 content 列冻结为旧数据快照，不再作为写入源；
-- 对外 API 的 content 字段改为由条目实时合成，旧客户端契约保持不变。
-- 幂等：若该篇已存在条目则跳过，重复执行不会产生重复行。

CREATE TABLE daily_note_entries (
  id CHAR(36) NOT NULL,
  owner_user_id CHAR(36) NOT NULL,
  daily_note_id CHAR(36) NOT NULL,
  entry_date DATE NOT NULL,
  slot_index TINYINT UNSIGNED NOT NULL COMMENT '两小时时段序号 0..11，由 recorded_at 的东八区小时 / 2 推导',
  recorded_at DATETIME(3) NOT NULL COMMENT 'UTC，分钟精度',
  time_precision VARCHAR(8) NOT NULL COMMENT 'minute=可选分钟；day=旧数据整体迁移，不落具体时段',
  content MEDIUMTEXT NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  PRIMARY KEY (id),
  KEY dne_note_slot_idx (daily_note_id, slot_index, recorded_at),
  KEY dne_owner_date_idx (owner_user_id, entry_date, recorded_at),
  CONSTRAINT dne_owner_user_fk FOREIGN KEY (owner_user_id) REFERENCES users(id),
  CONSTRAINT dne_daily_note_fk FOREIGN KEY (daily_note_id) REFERENCES daily_notes(id) ON DELETE CASCADE,
  CONSTRAINT dne_time_precision_check CHECK (time_precision IN ('minute', 'day')),
  CONSTRAINT dne_slot_index_check CHECK (slot_index BETWEEN 0 AND 11)
) ENGINE=InnoDB;

INSERT INTO daily_note_entries(id, owner_user_id, daily_note_id, entry_date, slot_index, recorded_at, time_precision, content, created_at, updated_at)
SELECT UUID(), source.owner_user_id, source.id, source.entry_date,
  FLOOR(HOUR(CONVERT_TZ(source.created_at, '+00:00', '+08:00')) / 2),
  source.created_at, 'day', source.content, source.created_at, source.updated_at
FROM daily_notes AS source
WHERE CHAR_LENGTH(TRIM(source.content)) > 0
  AND NOT EXISTS (SELECT 1 FROM daily_note_entries AS existing WHERE existing.daily_note_id = source.id);
