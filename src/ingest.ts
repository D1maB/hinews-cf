import { getFeeds, isUrlValid } from './feeds.js';
import { fetchRssItems } from './rss.js';
import {
  saveItems,
  setLastSync,
  getLastScheduledAt,
  buildScheduledAt,
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

/** Fetch the latest news from RSS feeds and store new headlines. */
export async function ingestNews(env: Env): Promise<IngestResult> {
  const sources = getFeeds(env);
  const found = await fetchRssItems(sources);

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

  // Filter out items with inaccessible URLs (e.g. 404 pages).
  const urlValidity = await Promise.all(
    candidates.map((item) => isUrlValid(item.url)),
  );
  const validCandidates = candidates.filter((_, index) => urlValidity[index]);

  const lastScheduledAt = await getLastScheduledAt(env.DB);
  const baseTime = lastScheduledAt
    ? new Date(lastScheduledAt).getTime()
    : Date.now();
  const prepared = validCandidates.map((item) => ({
    ...item,
    scheduledAt: buildScheduledAt(baseTime, validCandidates.length),
  }));

  const inserted = await saveItems(env.DB, prepared);

  await setLastSync(env.DB, new Date().toISOString());

  console.log(`Stored ${inserted} new item(s) from RSS feeds`);

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
