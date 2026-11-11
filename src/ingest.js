import { loadFeeds, toIsoDate } from './feeds.js';
import { MIN_SCORE } from './score.js';
import { saveItems, setLastSync, getLastScheduledAt, buildScheduledAt } from './store.js';
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
      description: item.description,
    })),
  );

  const SPONSORED_REGEX = /\b(pr|ad|collab|sponsored)\b/i;

  const deduped = dedupItems(items).filter((item) => {
    if (item.score <= MIN_SCORE) return false;
    const textToCheck = `${item.title} ${item.description ?? ''}`;
    return !SPONSORED_REGEX.test(textToCheck);
  });

  const lastScheduledAt = await getLastScheduledAt(env.DB);
  const baseTime = lastScheduledAt ? new Date(lastScheduledAt).getTime() : Date.now();
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


