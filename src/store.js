import { normalizeTitle } from './dedup.js';
import { scoreTitle, MIN_SCORE } from './score.js';

const INSERT_ITEM = `
  INSERT OR IGNORE INTO items (feed_id, feed_name, title, url, published_at, score, status)
  VALUES (?, ?, ?, ?, ?, ?, 'new')
`;

const LIST_ITEMS = `
  SELECT feed_id, feed_name, title, url, published_at, score, status
  FROM items
  ORDER BY id
`;

const SELECT_URLS = `
  SELECT url, title
  FROM items
`;

/**
 * Stores parsed items, skipping any URL that is already in the database.
 *
 * A single read fetches the known URLs so already-stored stories do not
 * trigger write attempts; only genuinely new rows are inserted.
 *
 * @param {D1Database} db
 * @param {Array<{ feedId: string, feedName: string, title: string, url: string, publishedAt: string | null }>} items
 * @returns {Promise<number>} Number of newly inserted rows.
 */
export async function saveItems(db, items) {
  if (items.length === 0) {
    return 0;
  }

  const { results = [] } = await db.prepare(SELECT_URLS).all();
  const existingUrls = new Set(results.map((row) => row.url));
  const existingTitles = new Set(results.map((row) => normalizeTitle(row.title)));

  const seenUrls = new Set();
  const seenTitles = new Set();
  const newItems = items.filter((item) => {
    const titleKey = item.title.trim().toLowerCase();
    if (
      existingUrls.has(item.url) ||
      existingTitles.has(titleKey) ||
      seenUrls.has(item.url) ||
      seenTitles.has(titleKey)
    ) {
      return false;
    }
    seenUrls.add(item.url);
    seenTitles.add(titleKey);
    return true;
  });

  if (newItems.length === 0) {
    return 0;
  }

  const statements = newItems.map((item) =>
    db
      .prepare(INSERT_ITEM)
      .bind(item.feedId, item.feedName, item.title, item.url, item.publishedAt, item.score),
  );

  const results2 = await db.batch(statements);

  return results2.reduce((total, result) => total + (result.meta?.changes ?? 0), 0);
}

/**
 * Reads every stored item in insertion order. Ordering by the primary key is a
 * sequential scan; the page sorts the rows in memory while grouping by feed.
 *
 * @param {D1Database} db
 * @returns {Promise<Array<{ feed_id: string, feed_name: string, title: string, url: string, published_at: string | null }>>}
 */
export async function listItems(db) {
  const { results = [] } = await db.prepare(LIST_ITEMS).all();

  return results;
}

const GET_META = `
  SELECT value
  FROM meta
  WHERE key = ?
`;

const SET_META = `
  INSERT INTO meta (key, value)
  VALUES (?, ?)
  ON CONFLICT(key) DO UPDATE SET value = excluded.value
`;

/**
 * Reads the stored timestamp of the last successful ingestion run.
 *
 * @param {D1Database} db
 * @returns {Promise<string | null>}
 */
export async function getLastSync(db) {
  const row = await db.prepare(GET_META).bind('last_sync_at').first();

  return row?.value ?? null;
}

/**
 * Records the timestamp of the latest ingestion run.
 *
 * @param {D1Database} db
 * @param {string} value
 * @returns {Promise<void>}
 */
export async function setLastSync(db, value) {
  await db.prepare(SET_META).bind('last_sync_at', value).run();
}

const SELECT_UNSCORED = `
  SELECT url, title
  FROM items
  WHERE score IS NULL
`;

const UPDATE_SCORE = `
  UPDATE items
  SET score = ?
  WHERE url = ?
`;

/**
 * Backfills scores for rows that were stored before scoring existed.
 *
 * @param {D1Database} db
 * @returns {Promise<void>}
 */
export async function backfillScores(db) {
  const { results = [] } = await db.prepare(SELECT_UNSCORED).all();

  for (const row of results) {
    await db.prepare(UPDATE_SCORE).bind(scoreTitle(row.title), row.url).run();
  }

  await db.prepare('DELETE FROM items WHERE score IS NOT NULL AND score < ?').bind(MIN_SCORE).run();
}
