export interface FeedConfig {
  id: string;
  name: string;
  url: string;
}

/** A normalized news item parsed from a feed. */
export interface SearchItem {
  title: string;
  description: string;
  source: string;
  url: string;
  score: number;
  publishedAt?: string;
}

export interface NewItem {
  feedId: string;
  feedName: string;
  title: string;
  url: string;
  publishedAt: string;
  score: number | null;
  description?: string;
  scheduledAt?: string;
}

export type PublishTarget = 'telegram' | 'bluesky';

export interface StoredItem {
  feed_id: string;
  feed_name: string;
  title: string;
  url: string;
  published_at: string | null;
  score: number | null;
  status: string;
  scheduled_at: string | null;
  description: string | null;
  telegram_published: number;
  bsky_published: number;
}

/** Result returned by a `run` statement. */
export interface DbRunResult {
  meta: { changes?: number };
}

/** Minimal statement shape shared by D1 and the in-memory test database. */
export interface DbStatement {
  bind(...values: unknown[]): DbStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<{ results: T[] }>;
  run(): Promise<DbRunResult>;
}

/** Minimal database shape shared by D1 and the in-memory test database. */
export interface Database {
  prepare(query: string): DbStatement;
  batch(statements: DbStatement[]): Promise<DbRunResult[]>;
}

export interface Env {
  DB: Database;
  FEEDS?: string;
  LOCAL_FEEDS_URL?: string;
  FEED_ITEM_LIMIT?: string;
  AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  TELEGRAM_ENABLED?: string | boolean;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  BSKY_ENABLED?: string | boolean;
  BSKY_HANDLE?: string;
  BSKY_APP_PASSWORD?: string;
}
