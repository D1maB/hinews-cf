import type { Database, DbRunResult, DbStatement } from '../src/types.js';

const INSERT_SQL = 'insert or ignore into items';

export interface FakeRow {
  id?: number;
  feed_id?: string;
  feed_name?: string;
  title: string;
  url: string;
  published_at?: string | null;
  score?: number | null;
  status?: string;
  scheduled_at?: string | null;
  description?: string | null;
  telegram_published?: number;
  bsky_published?: number;
}

export interface FakeDatabase extends Database {
  rows: Map<string, FakeRow>;
  meta: Map<string, string>;
  writes: number;
  reads: number;
  scans: number;
}

class FakeStatement implements DbStatement {
  private args: unknown[] = [];

  constructor(
    private readonly database: FakeDatabase,
    private readonly sql: string,
  ) {}

  bind(...args: unknown[]): DbStatement {
    this.args = args;
    return this;
  }

  async first<T = unknown>(): Promise<T | null> {
    const sql = this.sql.toLowerCase();
    this.database.reads += 1;

    if (sql.includes('meta')) {
      const key = String(this.args[0]);
      const value = this.database.meta.get(key);
      if (value == null) return null;
      this.database.scans += 1;
      return { value } as T;
    }

    if (sql.includes('from items') && sql.includes('where')) {
      const key = String(this.args[0]);
      const row =
        this.database.rows.get(key) ??
        [...this.database.rows.values()].find(
          (candidate) => String(candidate.id) === key,
        ) ??
        null;
      if (row) this.database.scans += 1;
      return row as T | null;
    }

    throw new Error(`Unexpected SQL: ${this.sql}`);
  }

  async all<T = unknown>(): Promise<{ results: T[] }> {
    const sql = this.sql.toLowerCase();
    this.database.reads += 1;

    if (sql.includes('meta')) {
      const results = [...this.database.meta.entries()].map(([key, value]) => ({
        key,
        value,
      }));
      this.database.scans += results.length;
      return { results: results as unknown as T[] };
    }

    let rows = [...this.database.rows.values()];
    if (sql.includes('where score is null')) {
      rows = rows.filter((row) => row.score == null);
    }
    const results = rows.sort(
      (left, right) =>
        String(left.feed_id ?? '').localeCompare(String(right.feed_id ?? '')) ||
        String(right.published_at ?? '').localeCompare(
          String(left.published_at ?? ''),
        ),
    );
    this.database.scans += results.length;
    return { results: results as unknown as T[] };
  }

  async run(): Promise<DbRunResult> {
    const sql = this.sql.toLowerCase();

    if (sql.includes('meta')) {
      const [key, value] = this.args;
      this.database.writes += 1;
      this.database.meta.set(String(key), String(value));
      return { meta: { changes: 1 } };
    }

    if (
      sql.includes('update') &&
      (sql.includes('telegram_published') || sql.includes('bsky_published'))
    ) {
      const url = String(this.args[0]);
      const row = this.database.rows.get(url);
      if (!row) return { meta: { changes: 0 } };
      if (sql.includes('telegram_published')) {
        row.telegram_published = 1;
      } else {
        row.bsky_published = 1;
      }
      this.database.writes += 1;
      return { meta: { changes: 1 } };
    }

    if (sql.includes('delete')) {
      if (sql === 'delete from items') {
        const changes = this.database.rows.size;
        this.database.rows.clear();
        this.database.writes += 1;
        return { meta: { changes } };
      }
      if (sql.includes("status = 'published'")) {
        let changes = 0;
        for (const [url, row] of [...this.database.rows.entries()]) {
          if (row.status === 'published') {
            this.database.rows.delete(url);
            changes += 1;
          }
        }
        this.database.writes += 1;
        return { meta: { changes } };
      }
      if (sql.includes('score <=')) {
        const threshold = Number(this.args[0]);
        let changes = 0;
        for (const [url, row] of [...this.database.rows.entries()]) {
          if (row.score != null && row.score <= threshold) {
            this.database.rows.delete(url);
            changes += 1;
          }
        }
        this.database.writes += 1;
        return { meta: { changes } };
      }
      throw new Error(`Unexpected SQL: ${this.sql}`);
    }

    if (sql.includes('update') && sql.includes('scheduled_at = ?')) {
      const [scheduledAt, url] = this.args;
      const row = this.database.rows.get(String(url));
      if (!row) return { meta: { changes: 0 } };
      row.scheduled_at = String(scheduledAt);
      this.database.writes += 1;
      return { meta: { changes: 1 } };
    }

    if (sql.includes('update') && sql.includes("status = 'published'")) {
      const url = String(this.args[0]);
      const row = this.database.rows.get(url);
      if (!row || row.status !== 'scheduled') {
        return { meta: { changes: 0 } };
      }
      row.status = 'published';
      this.database.writes += 1;
      return { meta: { changes: 1 } };
    }

    if (sql.includes('update') && sql.includes("status = 'scheduled'")) {
      let changes = 0;
      for (const row of this.database.rows.values()) {
        if (row.status == null || row.status === 'new') {
          row.status = 'scheduled';
          changes += 1;
        }
      }
      this.database.writes += 1;
      return { meta: { changes } };
    }

    if (sql.includes('update') && sql.includes('score = ?')) {
      const [score, url] = this.args;
      const row = this.database.rows.get(String(url));
      if (!row) return { meta: { changes: 0 } };
      row.score =
        score == null || Number.isNaN(Number(score)) ? null : Number(score);
      this.database.writes += 1;
      return { meta: { changes: 1 } };
    }

    if (!sql.includes(INSERT_SQL)) {
      throw new Error(`Unexpected SQL: ${this.sql}`);
    }

    const [
      feedId,
      feedName,
      title,
      url,
      publishedAt,
      score,
      scheduledAt,
      description,
    ] = this.args;
    const rowUrl = String(url);
    const rowTitle = String(title);

    if (this.database.rows.has(rowUrl)) {
      return { meta: { changes: 0 } };
    }

    for (const row of this.database.rows.values()) {
      if (
        String(row.title ?? '')
          .trim()
          .toLowerCase() === rowTitle.trim().toLowerCase()
      ) {
        return { meta: { changes: 0 } };
      }
    }

    this.database.writes += 1;
    this.database.rows.set(rowUrl, {
      id: this.database.rows.size + 1,
      feed_id: String(feedId),
      feed_name: String(feedName),
      title: rowTitle,
      url: rowUrl,
      published_at: publishedAt == null ? null : String(publishedAt),
      score: typeof score === 'number' ? score : null,
      status: 'scheduled',
      scheduled_at: scheduledAt == null ? null : String(scheduledAt),
      description: description == null ? null : String(description),
      telegram_published: 0,
      bsky_published: 0,
    });

    return { meta: { changes: 1 } };
  }
}

/**
 * Minimal in-memory D1 stand-in that implements the statements the store uses.
 */
export function createFakeDb(rows: FakeRow[] = []): FakeDatabase {
  const db: FakeDatabase = {
    rows: new Map(
      rows.map((row) => [
        row.url,
        {
          ...row,
          telegram_published: row.telegram_published ?? 0,
          bsky_published: row.bsky_published ?? 0,
        },
      ]),
    ),
    meta: new Map(),
    writes: 0,
    reads: 0,
    scans: 0,
    prepare: (sql) => new FakeStatement(db, sql),
    batch: (statements) =>
      Promise.all(statements.map((statement) => statement.run())),
  };

  return db;
}
