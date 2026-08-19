-- Workflow normalization: only doing/reviewed are current statuses.
-- The migration runner wraps this migration in a transaction. Avoid a temporary
-- table so the existing least-privilege migrator role can execute this migration.
DELETE il FROM item_links il
JOIN items i ON i.id = il.target_item_id
LEFT JOIN reviews r ON r.item_id = i.id
WHERE r.id IS NULL AND i.status <> 'reviewed' AND i.exploration_track_id IS NULL;

DELETE ma FROM method_applications ma
JOIN items i ON i.id = ma.item_id
LEFT JOIN reviews r ON r.item_id = i.id
WHERE r.id IS NULL AND i.status <> 'reviewed' AND i.exploration_track_id IS NULL;

DELETE se FROM item_status_events se
JOIN items i ON i.id = se.item_id
LEFT JOIN reviews r ON r.item_id = i.id
WHERE r.id IS NULL AND i.status <> 'reviewed' AND i.exploration_track_id IS NULL;

DELETE i FROM items i
LEFT JOIN reviews r ON r.item_id = i.id
WHERE r.id IS NULL AND i.status <> 'reviewed' AND i.exploration_track_id IS NULL;

UPDATE items i
LEFT JOIN reviews r ON r.item_id = i.id
SET i.status = 'doing', i.updated_at = UTC_TIMESTAMP(3)
WHERE r.id IS NULL AND i.status <> 'reviewed' AND i.exploration_track_id IS NOT NULL;

UPDATE items i SET i.status = 'reviewed' WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.item_id = i.id);
