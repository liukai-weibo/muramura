-- Workflow normalization: only doing/reviewed are current statuses.
-- The migration runner wraps this migration in a transaction.
CREATE TEMPORARY TABLE legacy_unreviewed_items AS
  SELECT i.id FROM items i
  LEFT JOIN reviews r ON r.item_id = i.id
  WHERE r.id IS NULL
    AND i.status <> 'reviewed'
    AND i.exploration_track_id IS NULL;

DELETE il FROM item_links il JOIN legacy_unreviewed_items x ON x.id = il.target_item_id;
DELETE ma FROM method_applications ma JOIN legacy_unreviewed_items x ON x.id = ma.item_id;
DELETE se FROM item_status_events se JOIN legacy_unreviewed_items x ON x.id = se.item_id;
DELETE i FROM items i JOIN legacy_unreviewed_items x ON x.id = i.id;

UPDATE items i
LEFT JOIN reviews r ON r.item_id = i.id
SET i.status = 'doing', i.updated_at = UTC_TIMESTAMP(3)
WHERE r.id IS NULL AND i.status <> 'reviewed' AND i.exploration_track_id IS NOT NULL;

UPDATE items i SET i.status = 'reviewed' WHERE EXISTS (SELECT 1 FROM reviews r WHERE r.item_id = i.id);
DROP TEMPORARY TABLE legacy_unreviewed_items;
