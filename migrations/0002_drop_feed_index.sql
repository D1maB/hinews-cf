-- The page reads every row and sorts in memory, so the covering feed index only
-- added write and scan overhead.
DROP INDEX IF EXISTS idx_items_feed;
