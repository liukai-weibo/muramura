-- 任务升级：紧急/重要两个维度（四象限）+ 可折叠详情。
-- 默认「重要不紧急」：新建任务先落在该做但不急这一格，紧急由用户手动标。
ALTER TABLE tasks
  ADD COLUMN is_urgent TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN is_important TINYINT(1) NOT NULL DEFAULT 1,
  ADD COLUMN detail TEXT NULL;
