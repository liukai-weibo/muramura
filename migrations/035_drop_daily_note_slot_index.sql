-- 手记视图改为「文本视图 + 时间轴视图」后，记录的位置由 recorded_at 的真实分钟决定，
-- 不再按两小时时段分段；slot_index 成了无人读取的冗余列，留着会让两套定位规则漂移。
-- 该值随时可由 recorded_at 推导，条目 API 也从未随任何客户端发布，删除无兼容风险。
--
-- 依赖顺序不能改：
--   1. dne_note_slot_idx 同时承担 dne_daily_note_fk 的索引，先补一个以 daily_note_id
--      开头的索引（正好对应按篇取条目后按时间排序的读法），外键才允许释放旧索引；
--   2. CHECK 约束引用 slot_index，必须先删；
--   3. 再删旧索引与列。

ALTER TABLE daily_note_entries ADD INDEX dne_note_recorded_idx (daily_note_id, recorded_at);

ALTER TABLE daily_note_entries DROP CHECK dne_slot_index_check;

ALTER TABLE daily_note_entries DROP INDEX dne_note_slot_idx;

ALTER TABLE daily_note_entries DROP COLUMN slot_index;
