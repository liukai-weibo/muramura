-- 大项-小项重构：长期探索归档（大项 + 旗下子行动整体收拢，不删除）
ALTER TABLE exploration_tracks
  ADD COLUMN archived_at DATETIME(3) NULL,
  ADD KEY exploration_tracks_archived_idx (archived_at);

ALTER TABLE items
  ADD COLUMN archived_at DATETIME(3) NULL;
