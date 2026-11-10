-- 睡眠语义调整：一条记录只描述「同一天」的起床与入睡，不再让单条记录跨天。
--
-- 旧模型：sleep_date=D 表示「D-1 晚入睡 + D 早起床」，一条记录跨两天。
-- 新模型：sleep_date=D 表示「D 早起床 + D 晚入睡」，入睡允许落到次日凌晨（00:00–11:59）。
-- 迁移做法：旧记录的起床留在 D，入睡移到 D-1；两个字段都可空，但至少要有一个。
-- 备注留在「起床」那一行（它代表一夜结束）。

ALTER TABLE sleep_entries MODIFY bed_at DATETIME(3) NULL;

ALTER TABLE sleep_entries DROP CHECK se_range_check;

ALTER TABLE sleep_entries ADD CONSTRAINT se_presence_check CHECK (bed_at IS NOT NULL OR wake_at IS NOT NULL);

-- 迁移账号没有 CREATE TEMPORARY TABLES 权限，这里用普通表做中转，结束后删除。
-- 重跑保护：上一次中途失败时可能留下中转表，先删掉再建。
DROP TABLE IF EXISTS sleep_migrate_037;

CREATE TABLE sleep_migrate_037 AS SELECT * FROM sleep_entries;

DELETE FROM sleep_entries;

INSERT INTO sleep_entries(id, owner_user_id, sleep_date, bed_at, wake_at, note, created_at, updated_at)
SELECT UUID(), owner_user_id, sleep_date, NULL, wake_at, note, created_at, updated_at
FROM sleep_migrate_037
WHERE wake_at IS NOT NULL
ON DUPLICATE KEY UPDATE wake_at=VALUES(wake_at), note=VALUES(note);

INSERT INTO sleep_entries(id, owner_user_id, sleep_date, bed_at, wake_at, note, created_at, updated_at)
SELECT UUID(), owner_user_id, DATE_SUB(sleep_date, INTERVAL 1 DAY), bed_at, NULL, NULL, created_at, updated_at
FROM sleep_migrate_037
WHERE bed_at IS NOT NULL
ON DUPLICATE KEY UPDATE bed_at=VALUES(bed_at);

DROP TABLE sleep_migrate_037;
