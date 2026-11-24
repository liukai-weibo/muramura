-- 完成任务后可以派生的「下一步」：记录它承接自哪个任务。
-- 父任务必然已完成，而已完成任务不允许删除，因此 ON DELETE SET NULL 只是兜底。
ALTER TABLE tasks
  ADD COLUMN parent_task_id CHAR(36) NULL AFTER title,
  ADD KEY tasks_parent_idx (parent_task_id),
  ADD CONSTRAINT tasks_parent_fk FOREIGN KEY (parent_task_id) REFERENCES tasks(id) ON DELETE SET NULL;
