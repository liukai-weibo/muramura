CREATE TABLE exploration_tracks (
  id VARCHAR(128) NOT NULL,
  name VARCHAR(80) NOT NULL,
  normalized_name VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NOT NULL,
  deleted_at DATETIME(3) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY exploration_tracks_normalized_name_unique (normalized_name),
  KEY exploration_tracks_active_updated_idx (deleted_at, updated_at DESC)
) ENGINE=InnoDB;

ALTER TABLE items
  ADD COLUMN exploration_track_id VARCHAR(128) NULL,
  ADD KEY items_exploration_track_created_idx (exploration_track_id, created_at DESC),
  ADD CONSTRAINT items_exploration_track_fk
    FOREIGN KEY (exploration_track_id) REFERENCES exploration_tracks(id);
