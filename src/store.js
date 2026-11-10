import { normalizeTitle } from './dedup.js';
import { scoreTitle, MIN_SCORE } from './score.js';

const SCHEDULE_BUCKET_MINUTES = 7;

const INSERT_ITEM = `
  INSERT OR IGNORE INTO items (feed_id, feed_name, title, url, published_at, score, status, scheduled_at)
  VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?)
`;

const LIST_ITEMS = `
  SELECT feed_id, feed_name, title, url, published_at, score, status, scheduled_at
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
      .bind(item.feedId, item.feedName, item.title, item.url, item.publishedAt, item.score, item.scheduledAt ?? null),
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
 * Marks an item as published to social.
 *
 * @param {D1Database} db
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function markPublished(db, url) {
  await db.prepare("UPDATE items SET status = 'published' WHERE url = ?").bind(url).run();
}

/**
 * Computes the scheduled time for the item at the given bucket index, anchored at baseTime.
 *
 * @param {number} baseTime
 * @param {number} index
 * @returns {string}
 */
export function buildScheduledAt(baseTime, index) {
  const bucketStart = index * SCHEDULE_BUCKET_MINUTES + 1;
  const bucketEnd = (index + 1) * SCHEDULE_BUCKET_MINUTES;
  const randomMinutes = bucketStart + Math.floor(Math.random() * (bucketEnd - bucketStart + 1));
  return new Date(baseTime + randomMinutes * 60 * 1000).toISOString();
}

const SELECT_UNSCORED = `
  SELECT url, title
  FROM items
  WHERE score IS NULL
`;

const CLEAR_ITEMS = 'DELETE FROM items';

const LIST_FEEDS = `
  SELECT id, name, url
  FROM feeds
  ORDER BY id
`;

const INSERT_FEED = `
  INSERT OR IGNORE INTO feeds (id, name, url)
  VALUES (?, ?, ?)
`;

const UPDATE_FEED = `
  UPDATE feeds
  SET name = ?, url = ?
  WHERE id = ?
`;

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
 * Lists every stored feed.
 *
 * @param {D1Database} db
 * @returns {Promise<Array<{ id: string, name: string, url: string }>>
 */
export async function listFeeds(db) {
  const { results = [] } = await db.prepare(LIST_FEEDS).all();

  return results;
}

/**
 * Creates a new feed.
 *
 * @param {D1Database} db
 * @param {{ id: string, name: string, url: string }} feed
 * @returns {Promise<void>}
 */
export async function createFeed(db, feed) {
  await db.prepare(INSERT_FEED).bind(feed.id, feed.name, feed.url).run();
}

/**
 * Updates an existing feed.
 *
 * @param {D1Database} db
 * @param {string} id
 * @param {{ name: string, url: string }} feed
 * @returns {Promise<void>}
 */
export async function updateFeed(db, id, feed) {
  await db.prepare(UPDATE_FEED).bind(feed.name, feed.url, id).run();
}

/**
 * Removes a feed.
 *
 * @param {D1Database} db
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteFeed(db, id) {
  await db.prepare('DELETE FROM feeds WHERE id = ?').bind(id).run();
}

/**
 * Creates a new stored item.
 *
 * @param {D1Database} db
 * @param {{ feedId: string, feedName: string, title: string, url: string, publishedAt: string | null, score: number | null, scheduledAt?: string }} item
 * @returns {Promise<void>}
 */
export async function createItem(db, item) {
  await db.prepare(INSERT_ITEM).bind(item.feedId, item.feedName, item.title, item.url, item.publishedAt, item.score, item.scheduledAt ?? new Date().toISOString()).run();
}

/**
 * Removes a stored item by its URL.
 *
 * @param {D1Database} db
 * @param {string} url
 * @returns {Promise<void>}
 */
export async function deleteItem(db, url) {
  await db.prepare('DELETE FROM items WHERE url = ?').bind(url).run();
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
    const scheduledAt = buildScheduledAt(baseTime, index);
    await db.prepare("UPDATE items SET scheduled_at = ? WHERE url = ?").bind(scheduledAt, unscheduled[index].url).run();
  }
}
