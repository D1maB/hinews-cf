import type { Database, NewItem, PublishTarget, StoredItem } from './types.js';

const SCHEDULE_WINDOW_MINUTES = 12 * 60;

const INSERT_ITEM = `
  INSERT OR IGNORE INTO items (feed_id, feed_name, title, url, published_at, score, status, scheduled_at, description)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const LIST_ITEMS = `
  SELECT feed_id, feed_name, title, url, published_at, score, status, scheduled_at, description, telegram_published, bsky_published
  FROM items
  ORDER BY id
`;

const LIST_NEW_ITEMS = `
  SELECT feed_id, feed_name, title, url, published_at, score, status, scheduled_at, description, telegram_published, bsky_published
  FROM items
  WHERE status = 'new'
  ORDER BY id
`;

const SELECT_URLS = `SELECT url FROM items`;

const GET_META = `SELECT value FROM meta WHERE key = ?`;
const SET_META = `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

const SELECT_SCHEDULED_AT = `SELECT scheduled_at FROM items`;
const DELETE_PUBLISHED = "DELETE FROM items WHERE status = 'published'";
const MARK_ITEM_PUBLISHED =
  "UPDATE items SET status = 'published' WHERE url = ? AND status = 'scheduled'";

const MARK_TARGET_PUBLISHED: Record<PublishTarget, string> = {
  telegram: `UPDATE items SET telegram_published = 1 WHERE url = ?`,
  bluesky: `UPDATE items SET bsky_published = 1 WHERE url = ?`,
};

const SCORE_AND_SCHEDULE_ITEM = `
  UPDATE items
  SET score = ?, scheduled_at = ?, status = 'scheduled'
  WHERE url = ? AND status = 'new'
`;

/**
 * Store new items, skipping URLs that already exist in the database.
 * Duplicate titles are still ignored by the database's unique constraint.
 * Returns the number of rows actually inserted.
 */
export async function saveItems(
  db: Database,
  items: NewItem[],
): Promise<number> {
  if (items.length === 0) return 0;

  const { results } = await db.prepare(SELECT_URLS).all<{ url: string }>();
  const seenUrls = new Set(results.map((row) => row.url));
  const newItems = items.filter((item) => {
    if (seenUrls.has(item.url)) return false;
    seenUrls.add(item.url);
    return true;
  });

  if (newItems.length === 0) return 0;

  const statements = newItems.map((item) => {
    const scheduledAt = item.scheduledAt ?? null;
    const status = scheduledAt ? 'scheduled' : 'new';
    return db
      .prepare(INSERT_ITEM)
      .bind(
        item.feedId,
        item.feedName,
        item.title,
        item.url,
        item.publishedAt,
        item.score,
        status,
        scheduledAt,
        item.description ?? null,
      );
  });

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

export async function listNewItems(db: Database): Promise<StoredItem[]> {
  const { results } = await db.prepare(LIST_NEW_ITEMS).all<StoredItem>();
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

export interface ScoredScheduleUpdate {
  url: string;
  score: number;
  scheduledAt: string;
}

/** Save AI scores and move new items into the scheduled state. */
export async function scheduleScoredItems(
  db: Database,
  updates: ScoredScheduleUpdate[],
): Promise<number> {
  if (updates.length === 0) return 0;

  const statements = updates.map((update) =>
    db
      .prepare(SCORE_AND_SCHEDULE_ITEM)
      .bind(update.score, update.scheduledAt, update.url),
  );
  const results = await db.batch(statements);
  return results.reduce(
    (total, result) => total + (result.meta.changes ?? 0),
    0,
  );
}

/** Spread `itemCount` items randomly across the next 12-hour window. */
export function buildScheduledAt(baseTime: number, itemCount: number): string {
  const offsetMinutes =
    itemCount > 0 ? Math.random() * SCHEDULE_WINDOW_MINUTES : 0;
  const scheduledTime = new Date(baseTime + offsetMinutes * 60 * 1000);
  return scheduledTime.toISOString();
}

/** Delete items that have already been published to their destinations. */
export async function deletePublished(db: Database): Promise<number> {
  const result = await db.prepare(DELETE_PUBLISHED).run();
  return result.meta.changes ?? 0;
}

/** Sort stored items by scheduled publication time. */
export function sortByScheduled(items: StoredItem[]): StoredItem[] {
  return [...items].sort((a, b) =>
    (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''),
  );
}
