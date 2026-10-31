-- Remove duplicate titles, keeping the earliest row for each.
DELETE FROM items
WHERE id NOT IN (
  SELECT MIN(id) FROM items GROUP BY LOWER(title)
);

-- Enforce uniqueness by (case-insensitive) title at the database level.
CREATE UNIQUE INDEX IF NOT EXISTS idx_items_title ON items (LOWER(title));