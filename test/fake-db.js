const INSERT_SQL = 'INSERT OR IGNORE INTO items';
const COUNT_SQL = 'COUNT(*)';

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
    if (!this.sql.includes(COUNT_SQL)) {
      throw new Error(`Unexpected SQL: ${this.sql}`);
    }

    return { count: this.database.rows.size };
  }

  async all() {
    return { results: [...this.database.rows.values()] };
  }

  async run() {
    if (!this.sql.includes(INSERT_SQL)) {
      throw new Error(`Unexpected SQL: ${this.sql}`);
    }

    const [feedId, feedName, title, url, publishedAt] = this.args;

    if (this.database.rows.has(url)) {
      return { meta: { changes: 0 } };
    }

    this.database.rows.set(url, {
      id: this.database.rows.size + 1,
      feed_id: feedId,
      feed_name: feedName,
      title,
      url,
      published_at: publishedAt,
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
    prepare: (sql) => new FakeStatement(db, sql),
    batch: (statements) => Promise.all(statements.map((statement) => statement.run())),
  };

  return db;
}
