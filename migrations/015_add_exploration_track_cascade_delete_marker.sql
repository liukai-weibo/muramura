ALTER TABLE items
  ADD COLUMN exploration_track_cascade_deleted_at DATETIME(3) NULL AFTER deleted_at,
  ADD KEY items_exploration_track_cascade_deleted_idx (exploration_track_id, exploration_track_cascade_deleted_at, id);
