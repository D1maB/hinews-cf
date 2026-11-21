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

export async function saveItems(
  db: D1Database,
  items: unknown[],
): Promise<number> {
  if (items.length === 0) return 0;

  const { results = [] } = await db.prepare(SELECT_URLS).all();
  const existingUrls = new Set((results as unknown[]).map((row) => row.url));
  const existingTitles = new Set(
    (results as unknown[]).map((row) => normalizeTitle(row.title)),
  );

  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
  const newItems = items.filter((item: any) => {
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

  if (newItems.length === 0) return 0;

  const statements = newItems.map((item: any) =>
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
  return (results2 as any[]).reduce(
    (total: number, result: any) => total + (result.meta?.changes ?? 0),
    0,
  );
}

export async function listItems(db: D1Database): Promise<any[]> {
  const { results = [] } = await db.prepare(LIST_ITEMS).all();
  return results as any[];
}

const GET_META = `SELECT value FROM meta WHERE key = ?`;
const SET_META = `INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`;

export async function getLastSync(db: D1Database): Promise<string | null> {
  const row = await db.prepare(GET_META).bind('last_sync_at').first();
  return (row as any)?.value ?? null;
}

export async function setLastSync(
  db: D1Database,
  value: string,
): Promise<void> {
  await db.prepare(SET_META).bind('last_sync_at', value).run();
}

const SELECT_SCHEDULED_AT = `SELECT scheduled_at FROM items`;

export async function getLastScheduledAt(
  db: D1Database,
): Promise<string | null> {
  const { results = [] } = await db.prepare(SELECT_SCHEDULED_AT).all();
  const values = (results as unknown[])
    .map((row) => row.scheduled_at)
    .filter(Boolean);
  if (values.length === 0) return null;
  return values.reduce((latest: string, value: string) =>
    value > latest ? value : latest,
  );
}

export async function getDueItems(db: D1Database): Promise<any[]> {
  const items = await listItems(db);
  const now = new Date().toISOString();
  return items.filter(
    (item: any) =>
      item.status === 'scheduled' &&
      item.scheduled_at &&
      item.scheduled_at <= now,
  );
}

export async function getItemByUrl(db: D1Database, url: string): Promise<any> {
  return db.prepare(SELECT_ITEM_BY_URL).bind(url).first();
}

export async function getItemById(
  db: D1Database,
  id: number | string,
): Promise<any> {
  return db.prepare(SELECT_ITEM_BY_ID).bind(id).first();
}

export const MARK_ITEM_PUBLISHED =
  "UPDATE items SET status = 'published' WHERE url = ? AND status = 'scheduled'";

export async function markPublished(
  db: D1Database,
  url: string,
): Promise<number> {
  const result = await db.prepare(MARK_ITEM_PUBLISHED).bind(url).run();
  return result.meta?.changes ?? 0;
}

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

const SELECT_UNSCORED = `SELECT url, title FROM items WHERE score IS NULL`;
const CLEAR_ITEMS = 'DELETE FROM items';
const DELETE_PUBLISHED = "DELETE FROM items WHERE status = 'published'";
const UPDATE_SCORE = `UPDATE items SET score = ? WHERE url = ?`;

export async function clearItems(db: D1Database): Promise<void> {
  await db.prepare(CLEAR_ITEMS).run();
}

export async function deletePublished(db: D1Database): Promise<number> {
  const result = await db.prepare(DELETE_PUBLISHED).run();
  return result.meta?.changes ?? 0;
}

export async function backfillScores(
  db: D1Database,
  options: any = {},
): Promise<void> {
  const { results = [] } = await db.prepare(SELECT_UNSCORED).all();

  for (const row of results as any[]) {
    await db
      .prepare(UPDATE_SCORE)
      .bind(await scoreTitle(row.title, options), row.url)
      .run();
  }

  await db
    .prepare('DELETE FROM items WHERE score IS NOT NULL AND score <= ?')
    .bind(MIN_SCORE)
    .run();
  await db
    .prepare(
      "UPDATE items SET status = 'scheduled' WHERE status IS NULL OR status = 'new'",
    )
    .run();

  const { results: allRows = [] } = await db
    .prepare('SELECT url, scheduled_at FROM items')
    .all();
  const unscheduled = (allRows as any[]).filter((row) => !row.scheduled_at);
  const last = await getLastScheduledAt(db);
  const baseTime = last ? new Date(last).getTime() : Date.now();
  for (let index = 0; index < unscheduled.length; index += 1) {
    const scheduledAt = buildScheduledAt(baseTime, index, unscheduled.length);
    await db
      .prepare('UPDATE items SET scheduled_at = ? WHERE url = ?')
      .bind(scheduledAt, unscheduled[index].url)
      .run();
  }
}
