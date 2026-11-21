import { normalizeTitle } from './dedup.js';
import { scoreTitle, MIN_SCORE } from './score.js';
import type { ScoreConfig } from './score.js';
import type { Database, NewItem, PublishTarget, StoredItem } from './types.js';

const SCHEDULE_WINDOW_MINUTES = 12 * 60;

const INSERT_ITEM = `
  INSERT OR IGNORE INTO items (feed_id, feed_name, title, url, published_at, score, status, scheduled_at, description)
  VALUES (?, ?, ?, ?, ?, ?, 'scheduled', ?, ?)
`;

const LIST_ITEMS = `
  SELECT feed_id, feed_name, title, url, published_at, score, status, scheduled_at, description, telegram_published, bsky_published
  FROM items
  ORDER BY id
`;

const SELECT_URLS = `
  SELECT url, title
  FROM items
`;

const GET_META = `SELECT value FROM meta WHERE key = ?`;
const SET_META = `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

const SELECT_SCHEDULED_AT = `SELECT scheduled_at FROM items`;
const SELECT_UNSCORED = `SELECT url, title FROM items WHERE score IS NULL`;
const SELECT_SCHEDULE = `SELECT url, scheduled_at FROM items`;
const DELETE_LOW_SCORES = `DELETE FROM items WHERE score IS NOT NULL AND score <= ?`;
const NORMALIZE_STATUS = `UPDATE items SET status = 'scheduled' WHERE status IS NULL OR status = 'new'`;
const UPDATE_SCORE = `UPDATE items SET score = ? WHERE url = ?`;
const UPDATE_SCHEDULED_AT = `UPDATE items SET scheduled_at = ? WHERE url = ?`;
const DELETE_PUBLISHED = "DELETE FROM items WHERE status = 'published'";
const MARK_ITEM_PUBLISHED =
  "UPDATE items SET status = 'published' WHERE url = ? AND status = 'scheduled'";

const MARK_TARGET_PUBLISHED: Record<PublishTarget, string> = {
  telegram: `UPDATE items SET telegram_published = 1 WHERE url = ?`,
  bluesky: `UPDATE items SET bsky_published = 1 WHERE url = ?`,
};

/**
 * Store new items, skipping URLs and titles that already exist.
 * Returns the number of rows actually inserted.
 */
export async function saveItems(
  db: Database,
  items: NewItem[],
): Promise<number> {
  if (items.length === 0) return 0;

  const { results } = await db
    .prepare(SELECT_URLS)
    .all<{ url: string; title: string }>();
  const existingUrls = new Set(results.map((row) => row.url));
  const existingTitles = new Set(
    results.map((row) => normalizeTitle(row.title)),
  );

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const newItems = items.filter((item) => {
    const titleKey = normalizeTitle(item.title);
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

  if (newItems.length === 0) return 0;

  const statements = newItems.map((item) =>
    db
      .prepare(INSERT_ITEM)
      .bind(
        item.feedId,
        item.feedName,
        item.title,
        item.url,
        item.publishedAt,
        item.score,
        item.scheduledAt ?? null,
        item.description ?? null,
      ),
  );

  const results2 = await db.batch(statements);
  return results2.reduce(
    (total, result) => total + (result.meta.changes ?? 0),
    0,
  );
}

export async function listItems(db: Database): Promise<StoredItem[]> {
  const { results } = await db.prepare(LIST_ITEMS).all<StoredItem>();
  return results;
}

export async function getLastSync(db: Database): Promise<string | null> {
  const row = await db.prepare(GET_META).bind('last_sync_at').first<{
    value: string;
  }>();
  return row?.value ?? null;
}

export async function setLastSync(db: Database, value: string): Promise<void> {
  await db.prepare(SET_META).bind('last_sync_at', value).run();
}

export async function getLastScheduledAt(db: Database): Promise<string | null> {
  const { results } = await db
    .prepare(SELECT_SCHEDULED_AT)
    .all<{ scheduled_at: string | null }>();
  const values = results
    .map((row) => row.scheduled_at)
    .filter((value): value is string => Boolean(value));
  if (values.length === 0) return null;
  return values.reduce((latest, value) => (value > latest ? value : latest));
}

/** Items whose scheduled publication time has arrived. */
export async function getDueItems(db: Database): Promise<StoredItem[]> {
  const items = await listItems(db);
  const now = new Date().toISOString();
  return items.filter(
    (item) =>
      item.status === 'scheduled' &&
      item.scheduled_at !== null &&
      item.scheduled_at <= now,
  );
}

export async function markPublished(
  db: Database,
  url: string,
): Promise<number> {
  const result = await db.prepare(MARK_ITEM_PUBLISHED).bind(url).run();
  return result.meta.changes ?? 0;
}

/** Record that one publishing destination accepted an item. */
export async function markTargetPublished(
  db: Database,
  url: string,
  target: PublishTarget,
): Promise<number> {
  const result = await db
    .prepare(MARK_TARGET_PUBLISHED[target])
    .bind(url)
    .run();
  return result.meta.changes ?? 0;
}

/** Spread `itemCount` items across the next 12-hour window. */
export function buildScheduledAt(
  baseTime: number,
  index: number,
  itemCount: number,
): string {
  const slotMinutes = itemCount > 0 ? SCHEDULE_WINDOW_MINUTES / itemCount : 0;
  const scheduledTime = new Date(
    baseTime + (index + 1) * slotMinutes * 60 * 1000,
  );
  return scheduledTime.toISOString();
}

/** Delete items that have already been published to their destinations. */
export async function deletePublished(db: Database): Promise<number> {
  const result = await db.prepare(DELETE_PUBLISHED).run();
  return result.meta.changes ?? 0;
}

/**
 * Score unscheduled/unscored items, drop low-scoring ones, and assign
 * publication times using batched writes.
 */
export async function backfillScores(
  db: Database,
  options: Partial<ScoreConfig> = {},
): Promise<void> {
  const { results: unscored } = await db
    .prepare(SELECT_UNSCORED)
    .all<{ url: string; title: string }>();

  const scoreStatements = [];
  for (const row of unscored) {
    const score = await scoreTitle(row.title, options);
    scoreStatements.push(db.prepare(UPDATE_SCORE).bind(score, row.url));
  }
  if (scoreStatements.length > 0) {
    await db.batch(scoreStatements);
  }

  await db.batch([
    db.prepare(DELETE_LOW_SCORES).bind(MIN_SCORE),
    db.prepare(NORMALIZE_STATUS),
  ]);

  const { results: allRows } = await db
    .prepare(SELECT_SCHEDULE)
    .all<{ url: string; scheduled_at: string | null }>();
  const unscheduled = allRows.filter((row) => !row.scheduled_at);
  if (unscheduled.length === 0) return;

  const last = await getLastScheduledAt(db);
  const baseTime = last ? new Date(last).getTime() : Date.now();
  const scheduleStatements = unscheduled.map((row, index) =>
    db
      .prepare(UPDATE_SCHEDULED_AT)
      .bind(buildScheduledAt(baseTime, index, unscheduled.length), row.url),
  );
  await db.batch(scheduleStatements);
}
