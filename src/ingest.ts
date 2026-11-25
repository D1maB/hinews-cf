import { getFeeds, isUrlValid } from './feeds.js';
import { fetchRssItems, parseFeedItemLimit } from './rss.js';
import { scoreItems } from './score.js';
import {
  buildScheduledAt,
  getExistingUrls,
  getLastScheduledAt,
  listNewItems,
  saveItems,
  scheduleScoredItems,
  setLastSync,
} from './store.js';
import type { Env, FeedConfig, NewItem } from './types.js';

const SPONSORED_REGEX = /\b(pr|ad|collab|sponsored)\b/i;

export interface IngestResult {
  inserted: number;
  sources: FeedConfig[];
  items: Array<{
    feed_id: string;
    feed_name: string;
    title: string;
    url: string;
    published_at: string;
    score: number | null;
    description?: string;
  }>;
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}

/** Match an AI result to one of the configured source sites. */
function resolveSource(
  name: string,
  url: string,
  sources: FeedConfig[],
): FeedConfig {
  const lowerName = name.toLowerCase();
  const byName = sources.find(
    (source) => source.name.toLowerCase() === lowerName,
  );
  if (byName) return byName;

  const host = hostOf(url);
  const byHost = sources.find((source) => hostOf(source.url) === host);
  if (byHost) return byHost;

  const fallbackName = name || host || 'Unknown';
  return { id: slugify(fallbackName), name: fallbackName, url };
}

function logAppEnv(env: Env): void {
  const safeEnv = {
    LOCAL_FEEDS_URL: env.LOCAL_FEEDS_URL?.trim() || '',
    FEED_ITEM_LIMIT: env.FEED_ITEM_LIMIT?.trim() || '',
    FEEDS: env.FEEDS ? '[configured]' : '',
    TELEGRAM_ENABLED: String(env.TELEGRAM_ENABLED ?? ''),
    TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN ? '[set]' : '',
    TELEGRAM_CHAT_ID: env.TELEGRAM_CHAT_ID ? '[set]' : '',
    BSKY_ENABLED: String(env.BSKY_ENABLED ?? ''),
    BSKY_HANDLE: env.BSKY_HANDLE ? '[set]' : '',
    BSKY_APP_PASSWORD: env.BSKY_APP_PASSWORD ? '[set]' : '',
    DB: env.DB ? '[bound]' : '',
  };
  console.log('App env:', safeEnv);
}

/** Fetch the latest news from RSS feeds and store new headlines. */
export async function ingestNews(env: Env): Promise<IngestResult> {
  logAppEnv(env);
  const sources = getFeeds(env);
  const feedItemLimit = parseFeedItemLimit(env.FEED_ITEM_LIMIT);
  console.log(
    env.LOCAL_FEEDS_URL?.trim()
      ? `Using local feeds: ${env.LOCAL_FEEDS_URL}`
      : 'Using online feeds',
  );
  console.log(`Feed item limit: ${feedItemLimit}`);
  const found = await fetchRssItems(sources, feedItemLimit);
  console.log(`Fetched ${found.length} feed item(s) total`);

  const items: NewItem[] = found.map((item) => {
    const source = resolveSource(item.source, item.url, sources);
    return {
      feedId: source.id,
      feedName: source.name,
      title: item.title,
      url: item.url,
      publishedAt: item.publishedAt ?? new Date().toISOString(),
      score: item.score,
      description: item.description || undefined,
    };
  });

  const candidates = items.filter((item) => {
    const textToCheck = `${item.title} ${item.description ?? ''}`;
    return !SPONSORED_REGEX.test(textToCheck);
  });

  const existingUrls = await getExistingUrls(env.DB);
  const newCandidates = candidates.filter((item) => !existingUrls.has(item.url));
  console.log(
    `Skipped ${candidates.length - newCandidates.length} already-stored item(s)`,
  );

  // Filter out items with inaccessible URLs (e.g. 404 pages).
  const urlValidity = await Promise.all(
    newCandidates.map((item) => isUrlValid(item.url)),
  );
  const freshCandidates = newCandidates.filter(
    (_, index) => urlValidity[index],
  );

  let prepared: Array<NewItem & { scheduledAt: string }> = [];
  let inserted = 0;

  if (freshCandidates.length > 0) {
    try {
      const scores = await scoreItems(
        env,
        freshCandidates.map((item) => ({ title: item.title, url: item.url })),
      );
      const lastScheduledAt = await getLastScheduledAt(env.DB);
      const baseTime = lastScheduledAt
        ? new Date(lastScheduledAt).getTime()
        : Date.now();

      prepared = freshCandidates.map((item) => ({
        ...item,
        score: scores.get(item.url) ?? 0,
        scheduledAt: buildScheduledAt(baseTime, freshCandidates.length),
      }));

      inserted = await saveItems(env.DB, prepared);
      console.log(`Saved ${inserted} new item(s) to DB`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Can't score items, skipping save: ${message}`);
    }
  }

  const pendingNewItems = await listNewItems(env.DB);
  if (pendingNewItems.length > 0) {
    try {
      const scores = await scoreItems(env, pendingNewItems);
      const lastScheduledAt = await getLastScheduledAt(env.DB);
      const baseTime = lastScheduledAt
        ? new Date(lastScheduledAt).getTime()
        : Date.now();
      const updates = pendingNewItems.map((item) => ({
        url: item.url,
        score: scores.get(item.url) ?? 0,
        scheduledAt: buildScheduledAt(baseTime, pendingNewItems.length),
      }));
      const scheduled = await scheduleScoredItems(env.DB, updates);
      console.log(`Scored and scheduled ${scheduled} pending item(s)`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`Can't score pending items: ${message}`);
    }
  }

  await setLastSync(env.DB, new Date().toISOString());

  return {
    inserted,
    sources,
    items: prepared.map((item) => ({
      feed_id: item.feedId,
      feed_name: item.feedName,
      title: item.title,
      url: item.url,
      published_at: item.publishedAt,
      score: item.score,
      description: item.description,
    })),
  };
}
