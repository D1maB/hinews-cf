const INSERT_SQL = 'INSERT OR IGNORE INTO items';
const EXISTS_SQL = 'LIMIT 1';

class FakeStatement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.args = [];
  }

  bind(...args) {
    this.args = args;
    return this;
  }

  async first() {
    this.database.reads += 1;

    if (this.sql.toLowerCase().includes('meta')) {
      const key = this.args[0];
      const value = this.database.meta.get(key);
      if (value == null) {
        return null;
      }
      this.database.scans += 1;
      return { value };
    }

    if (this.sql.toLowerCase().includes('from items') && this.sql.toLowerCase().includes('where')) {
      const key = this.args[0];
      const rows = [...this.database.rows.values()];
      const row = this.database.rows.get(String(key)) ?? rows.find((candidate) => String(candidate.id) === String(key)) ?? null;
      if (row) {
        this.database.scans += 1;
      }
      return row ?? null;
    }

    if (!this.sql.includes(EXISTS_SQL)) {
      throw new Error(`Unexpected SQL: ${this.sql}`);
    }

    if (this.database.rows.size > 0) {
      this.database.scans += 1;
      return { present: 1 };
    }
    return null;
  }

  async all() {
    this.database.reads += 1;

    if (this.sql.toLowerCase().includes('meta')) {
      const results = [...this.database.meta.entries()].map(([key, value]) => ({ key, value }));
      this.database.scans += results.length;
      return { results };
    }

    const results = [...this.database.rows.values()].sort(
      (left, right) =>
        left.feed_id.localeCompare(right.feed_id) ||
        String(right.published_at ?? '').localeCompare(String(left.published_at ?? '')),
    );

    this.database.scans += results.length;

    return { results };
  }

  async run() {
    if (this.sql.toLowerCase().includes('meta')) {
      const [key, value] = this.args;
      this.database.writes += 1;
      this.database.meta.set(key, value);
      return { meta: { changes: 1 } };
    }

    if (this.sql.toLowerCase().includes('delete')) {
      const sql = this.sql.toLowerCase();
      if (sql === 'delete from items') {
        const changes = this.database.rows.size;
        this.database.rows.clear();
        this.database.writes += 1;
        return { meta: { changes } };
      }
      if (sql === "delete from items where status = 'published'") {
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
      if (sql.includes('id')) {
        const [id] = this.args;
        for (const [url, row] of [...this.database.rows.entries()]) {
          if (row.id === id) {
            this.database.rows.delete(url);
            this.database.writes += 1;
            return { meta: { changes: 1 } };
          }
        }
        return { meta: { changes: 0 } };
      }

      const threshold = this.args[0];
      for (const [url, row] of [...this.database.rows.entries()]) {
        if (row.score != null && row.score <= threshold) {
          this.database.rows.delete(url);
        }
      }
      this.database.writes += 1;
      return { meta: { changes: 1 } };
    }

    if (this.sql.toLowerCase().includes('update') && this.sql.toLowerCase().includes('scheduled_at')) {
      const [scheduledAt, url] = this.args;
      const row = this.database.rows.get(url);
      if (row) {
        row.scheduled_at = scheduledAt;
        this.database.writes += 1;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }

    if (this.sql.toLowerCase().includes('update') && this.sql.toLowerCase().includes('published')) {
      const [url] = this.args;
      const row = this.database.rows.get(url);
      if (row) {
        row.status = 'published';
        this.database.writes += 1;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }

    if (this.sql.toLowerCase().includes('update') && this.sql.toLowerCase().includes('status')) {
      for (const row of this.database.rows.values()) {
        if (row.status == null || row.status === 'new') {
          row.status = 'scheduled';
        }
      }
      this.database.writes += 1;
      return { meta: { changes: 1 } };
    }

    if (this.sql.toLowerCase().includes('update')) {
      const [score, url] = this.args;
      const row = this.database.rows.get(url);
      if (row) {
        row.score = score;
        this.database.writes += 1;
      }
      return { meta: { changes: row ? 1 : 0 } };
    }

    if (!this.sql.includes(INSERT_SQL)) {
      throw new Error(`Unexpected SQL: ${this.sql}`);
    }

    const [feedId, feedName, title, url, publishedAt, score, scheduledAt] = this.args;

    if (this.database.rows.has(url)) {
      return { meta: { changes: 0 } };
    }

    for (const row of this.database.rows.values()) {
      if (String(row.title ?? '').trim().toLowerCase() === String(title ?? '').trim().toLowerCase()) {
        return { meta: { changes: 0 } };
      }
    }

    this.database.writes += 1;
    this.database.rows.set(url, {
      id: this.database.rows.size + 1,
      feed_id: feedId,
      feed_name: feedName,
      title,
      url,
      published_at: publishedAt,
      score,
      status: 'scheduled',
      scheduled_at: scheduledAt,
    });

    return { meta: { changes: 1 } };
  }
}

/**
 * Minimal in-memory D1 stand-in that implements the statements the store uses.
 *
 * @param {Array<Record<string, unknown>>} [rows]
 * @returns {{ rows: Map<string, Record<string, unknown>>, prepare: (sql: string) => FakeStatement, batch: (statements: FakeStatement[]) => Promise<Array<{ meta: { changes: number } }>> }}
 */
export function createFakeDb(rows = []) {
  const db = {
    rows: new Map(rows.map((row) => [row.url, { ...row }])),
    meta: new Map(),
    writes: 0,
    reads: 0,
    scans: 0,
    prepare: (sql) => new FakeStatement(db, sql),
    batch: (statements) => Promise.all(statements.map((statement) => statement.run())),
  };

  return db;
}
