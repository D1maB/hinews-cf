import { loadFeeds, toIsoDate } from './feeds.js';
import { saveItems } from './store.js';

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
    })),
  );

  const inserted = await saveItems(env.DB, items);

  console.log(`Stored ${inserted} new item(s) from ${feeds.length} feeds`);

  return { inserted, feeds };
}
