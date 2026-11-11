import { normalizeTitle } from './dedup.js';
import { scoreTitle, MIN_SCORE } from './score.js';

const SCHEDULE_WINDOW_MINUTES = 12 * 60;

const INSERT_ITEM = `
  INSERT OR IGNORE INTO items (feed_id, feed_name, title, url, published_at, score, status, scheduled_at, description)
  VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
`;

const LIST_ITEMS = `
  SELECT feed_id, feed_name, title, url, published_at, score, status, scheduled_at, description
  FROM items
  ORDER BY id
`;

export const SELECT_ITEM_BY_URL = `
  SELECT feed_id, feed_name, title, url, published_at, score, status, scheduled_at, description
  FROM items
  WHERE url = ?
  LIMIT 1
`;

export const SELECT_ITEM_BY_ID = `
  SELECT feed_id, feed_name, title, url, published_at, score, status, scheduled_at, description
  FROM items
  WHERE id = ?
  LIMIT 1
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
      .bind(item.feedId, item.feedName, item.title, item.url, item.publishedAt, item.score, item.scheduledAt ?? null, item.description ?? null),
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

const SELECT_SCHEDULED_AT = `
  SELECT scheduled_at
  FROM items
`;

/**
 * Returns the latest scheduled timestamp currently stored, if any.
 *
 * @param {D1Database} db
 * @returns {Promise<string | null>}
 */
export async function getLastScheduledAt(db) {
  const { results = [] } = await db.prepare(SELECT_SCHEDULED_AT).all();
  const values = results.map((row) => row.scheduled_at).filter(Boolean);
  if (values.length === 0) {
    return null;
  }
  return values.reduce((latest, value) => (value > latest ? value : latest));
}

/**
 * Returns scheduled items whose scheduled time has passed.
 *
 * @param {D1Database} db
 * @returns {Promise<Array<{ feed_id: string, feed_name: string, title: string, url: string, published_at: string | null, score: number | null, status: string | null, scheduled_at: string | null }>>}
 */
export async function getDueItems(db) {
  const items = await listItems(db);
  const now = new Date().toISOString();
  return items.filter((item) => item.status === 'scheduled' && item.scheduled_at && item.scheduled_at <= now);
}

/**
 * Returns the stored item with the given unique URL, if any.
 *
 * @param {D1Database} db
 * @param {string} url
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function getItemByUrl(db, url) {
  return db.prepare(SELECT_ITEM_BY_URL).bind(url).first();
}

/**
 * Returns the stored item with the given primary key, if any.
 *
 * @param {D1Database} db
 * @param {number | string} id
 * @returns {Promise<Record<string, unknown> | null>}
 */
export async function getItemById(db, id) {
  return db.prepare(SELECT_ITEM_BY_ID).bind(id).first();
}

export const MARK_ITEM_PUBLISHED = "UPDATE items SET status = 'published' WHERE url = ?";

/**
 * Marks an item as published to social.
 *
 * @param {D1Database} db
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function markPublished(db, url) {
  await db.prepare(MARK_ITEM_PUBLISHED).bind(url).run();
}

/**
 * Computes the scheduled time for the item at the given index, spreading the
 * items evenly across a single 12 hour window starting at baseTime.
 *
 * @param {number} baseTime
 * @param {number} index
 * @param {number} itemCount
 * @returns {string}
 */
export function buildScheduledAt(baseTime, index, itemCount) {
  const slotMinutes = itemCount > 0 ? SCHEDULE_WINDOW_MINUTES / itemCount : 0;
  const scheduledTime = new Date(baseTime + (index + 1) * slotMinutes * 60 * 1000);
  return scheduledTime.toISOString();
}

const SELECT_UNSCORED = `
  SELECT url, title
  FROM items
  WHERE score IS NULL
`;

const CLEAR_ITEMS = 'DELETE FROM items';

const DELETE_PUBLISHED = "DELETE FROM items WHERE status = 'published'";

const UPDATE_SCORE = `
  UPDATE items
  SET score = ?
  WHERE url = ?
`;

/**
 * Removes every stored item, so the next ingestion run starts from a clean slate.
 *
 * @param {D1Database} db
 * @returns {Promise<void>}
 */
export async function clearItems(db) {
  await db.prepare(CLEAR_ITEMS).run();
}

/**
 * Removes all items with status 'published' from the database.
 *
 * @param {D1Database} db
 * @returns {Promise<number>} Number of deleted rows.
 */
export async function deletePublished(db) {
  const result = await db.prepare(DELETE_PUBLISHED).run();
  return result.meta?.changes ?? 0;
}

/**
 * Backfills scores for rows that were stored before scoring existed, then
 * schedules every unscheduled item across a single 12-hour window. Items pick
 * a random minute from sequential buckets (1-7, 8-15, 16-23, ...) anchored at
 * the last scheduled time, so publishing happens at the scheduled moment.
 *
 * @param {D1Database} db
 * @returns {Promise<void>}
 */
export async function backfillScores(db) {
  const { results = [] } = await db.prepare(SELECT_UNSCORED).all();

  for (const row of results) {
    await db.prepare(UPDATE_SCORE).bind(scoreTitle(row.title), row.url).run();
  }

  await db.prepare('DELETE FROM items WHERE score IS NOT NULL AND score <= ?').bind(MIN_SCORE).run();

  await db.prepare("UPDATE items SET status = 'scheduled' WHERE status IS NULL OR status = 'new'").run();

  const { results: allRows = [] } = await db.prepare('SELECT url, scheduled_at FROM items').all();
  const unscheduled = allRows.filter((row) => !row.scheduled_at);
  const last = await getLastScheduledAt(db);
  const baseTime = last ? new Date(last).getTime() : Date.now();
  for (let index = 0; index < unscheduled.length; index += 1) {
    const scheduledAt = buildScheduledAt(baseTime, index, unscheduled.length);
    await db.prepare("UPDATE items SET scheduled_at = ? WHERE url = ?").bind(scheduledAt, unscheduled[index].url).run();
  }
}
