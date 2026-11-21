-- Track each publishing destination separately so a partial failure can be
-- retried without reposting to the destination that already succeeded.
ALTER TABLE items ADD COLUMN telegram_published INTEGER NOT NULL DEFAULT 0;
ALTER TABLE items ADD COLUMN bsky_published INTEGER NOT NULL DEFAULT 0;
