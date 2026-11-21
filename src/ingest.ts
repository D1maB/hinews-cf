import { loadFeeds, toIsoDate } from './feeds.js';
import {
  saveItems,
  setLastSync,
  getLastScheduledAt,
  buildScheduledAt,
} from './store.js';
import { dedupItems } from './dedup.js';
import type { Env, LoadedFeed, NewItem } from './types.js';

const SPONSORED_REGEX = /\b(pr|ad|collab|sponsored)\b/i;

export interface IngestResult {
  inserted: number;
  feeds: LoadedFeed[];
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

/** Fetch all configured feeds, deduplicate, and store new headlines. */
export async function ingestFeeds(env: Env): Promise<IngestResult> {
  const feeds = await loadFeeds(env);

  for (const feed of feeds) {
    if (feed.status === 'error') {
      console.error(`Failed to load ${feed.name}: ${feed.error}`);
    }
  }

  const items: NewItem[] = feeds.flatMap((feed) =>
    feed.items.map((item) => ({
      feedId: feed.id,
      feedName: feed.name,
      title: item.title,
      url: item.link,
      publishedAt: toIsoDate(item.publishedAt),
      score: item.score,
      description: item.description,
    })),
  );

  const deduped = dedupItems(items).filter((item) => {
    const textToCheck = `${item.title} ${item.description ?? ''}`;
    return !SPONSORED_REGEX.test(textToCheck);
  });

  const lastScheduledAt = await getLastScheduledAt(env.DB);
  const baseTime = lastScheduledAt
    ? new Date(lastScheduledAt).getTime()
    : Date.now();
  const prepared = deduped.map((item, index) => ({
    ...item,
    scheduledAt: buildScheduledAt(baseTime, index, deduped.length),
  }));

  const inserted = await saveItems(env.DB, prepared);

  await setLastSync(env.DB, new Date().toISOString());

  console.log(`Stored ${inserted} new item(s) from ${feeds.length} feeds`);

  return {
    inserted,
    feeds,
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
