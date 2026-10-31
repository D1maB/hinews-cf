const INSERT_ITEM = `
  INSERT OR IGNORE INTO items (feed_id, feed_name, title, url, published_at)
  VALUES (?, ?, ?, ?, ?)
`;

const LIST_ITEMS = `
  SELECT feed_id, feed_name, title, url, published_at
  FROM items
  ORDER BY COALESCE(published_at, first_seen_at) DESC, id DESC
`;

const COUNT_ITEMS = 'SELECT COUNT(*) AS count FROM items';

/**
 * Stores parsed items, skipping any URL that is already in the database.
 *
 * @param {D1Database} db
 * @param {Array<{ feedId: string, feedName: string, title: string, url: string, publishedAt: string | null }>} items
 * @returns {Promise<number>} Number of newly inserted rows.
 */
export async function saveItems(db, items) {
  if (items.length === 0) {
    return 0;
  }

  const statements = items.map((item) =>
    db
      .prepare(INSERT_ITEM)
      .bind(item.feedId, item.feedName, item.title, item.url, item.publishedAt),
  );

  const results = await db.batch(statements);

  return results.reduce((total, result) => total + (result.meta?.changes ?? 0), 0);
}

/**
 * @param {D1Database} db
 * @returns {Promise<number>}
 */
export async function countItems(db) {
  const row = await db.prepare(COUNT_ITEMS).first();

  return row?.count ?? 0;
}

/**
 * Reads every stored item, newest first.
 *
 * @param {D1Database} db
 * @returns {Promise<Array<{ feed_id: string, feed_name: string, title: string, url: string, published_at: string | null }>>}
 */
export async function listItems(db) {
  const { results = [] } = await db.prepare(LIST_ITEMS).all();

  return results;
}
