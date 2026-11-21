export interface FeedConfig {
  id: string;
  name: string;
  url: string;
}

export interface ParsedItem {
  title: string;
  link: string;
  publishedAt: string;
  score: number | null;
  description?: string;
}

export type LoadedFeed =
  | (FeedConfig & { status: 'ok'; items: ParsedItem[] })
  | (FeedConfig & { status: 'error'; items: []; error: string });

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

export interface AssetFetcher {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
}

export interface Env {
  DB: Database;
  ASSETS?: AssetFetcher;
  FEEDS?: string;
  SCORE_BASE_URL?: string;
  SCORE_MODEL?: string;
  SCORE_API_KEY?: string;
  TELEGRAM_ENABLED?: string | boolean;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  BSKY_ENABLED?: string | boolean;
  BSKY_HANDLE?: string;
  BSKY_APP_PASSWORD?: string;
}
