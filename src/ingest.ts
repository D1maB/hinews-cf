import { loadFeeds, toIsoDate } from './feeds.js';
import {
  saveItems,
  setLastSync,
  getLastScheduledAt,
  buildScheduledAt,
} from './store.js';
import { dedupItems } from './dedup.js';

export async function ingestFeeds(
  env: Record<string, unknown>,
): Promise<{ inserted: number; feeds: any; items: any[] }> {
  const feeds = await loadFeeds(env);

  for (const feed of feeds) {
    if (feed.error) {
      console.error(`Failed to load ${feed.name}: ${feed.error}`);
    }
  }

  const items = feeds.flatMap((feed: any) =>
    feed.items.map((item: any) => ({
      feedId: feed.id,
      feedName: feed.name,
      title: item.title,
      url: item.link,
      publishedAt: toIsoDate(item.publishedAt),
      score: item.score,
      description: item.description,
    })),
  );

  const SPONSORED_REGEX = /\b(pr|ad|collab|sponsored)\b/i;

  const deduped = dedupItems(items).filter((item: any) => {
    const textToCheck = `${item.title} ${item.description ?? ''}`;
    return !SPONSORED_REGEX.test(textToCheck);
  });

  const lastScheduledAt = await getLastScheduledAt(env.DB as any);
  const baseTime = lastScheduledAt
    ? new Date(lastScheduledAt).getTime()
    : Date.now();
  const prepared = deduped.map((item: any, index: number) => ({
    ...item,
    scheduledAt: buildScheduledAt(baseTime, index, deduped.length),
  }));

  const inserted = await saveItems(env.DB as any, prepared);

  await setLastSync(env.DB as any, new Date().toISOString());

  console.log(`Stored ${inserted} new item(s) from ${feeds.length} feeds`);

  return {
    inserted,
    feeds,
    items: prepared.map((item: any) => ({
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
