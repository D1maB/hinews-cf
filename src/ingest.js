import { loadFeeds, toIsoDate } from './feeds.js';
import { MIN_SCORE } from './score.js';
import { saveItems, setLastSync, getLastScheduledAt } from './store.js';
import { dedupItems } from './dedup.js';

/**
 * Parses every feed and persists its items. Duplicate URLs are ignored by the
 * database, so repeated runs only add new stories.
 *
 * @param {Record<string, unknown>} env
 * @returns {Promise<{ inserted: number, feeds: Awaited<ReturnType<typeof loadFeeds>> }>}
 */
export async function ingestFeeds(env) {
  const feeds = await loadFeeds(env);

  for (const feed of feeds) {
    if (feed.error) {
      console.error(`Failed to load ${feed.name}: ${feed.error}`);
    }
  }

  const items = feeds.flatMap((feed) =>
    feed.items.map((item) => ({
      feedId: feed.id,
      feedName: feed.name,
      title: item.title,
      url: item.link,
      publishedAt: toIsoDate(item.publishedAt),
      score: item.score,
    })),
  );

  const deduped = dedupItems(items).filter((item) => item.score > MIN_SCORE);

  let lastScheduledAt = await getLastScheduledAt(env.DB);
  const prepared = deduped.map((item) => {
    const baseTime = lastScheduledAt ? new Date(lastScheduledAt).getTime() : Date.now();
    const randomMinutes = 10 + Math.floor(Math.random() * 16);
    const intervalMinutes = 20 + randomMinutes;
    const next = new Date(baseTime + intervalMinutes * 60 * 1000);
    const scheduledAt = next.toISOString();
    lastScheduledAt = scheduledAt;
    return { ...item, scheduledAt };
  });

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
    })),
  };
}


