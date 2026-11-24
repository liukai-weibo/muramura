-- 三餐去掉「饱腹度」：先删掉引用该列的 CHECK，再删列。
-- 历史饱腹度值随列一起丢弃（产品确认该功能无价值），备份格式同步升级到 V15。
ALTER TABLE meal_entries DROP CHECK meal_entries_feeling_check;

ALTER TABLE meal_entries DROP COLUMN feeling;
