import { FEEDS, getFeeds } from './feeds.js';

/**
 * Newest first; undated items go last.
 *
 * @param {{ published_at: string | null }} left
 * @param {{ published_at: string | null }} right
 * @returns {number}
 */
export function compareByPublished(left, right) {
  if (left.published_at === right.published_at) {
    return 0;
  }

  if (!left.published_at) {
    return 1;
  }

  if (!right.published_at) {
    return -1;
  }

  return right.published_at.localeCompare(left.published_at);
}

/**
 * Groups stored rows into the configured feed order, newest item first.
 *
 * @param {Array<{ feed_id: string, title: string, url: string, published_at: string | null }>} items
 * @returns {Array<{ id: string, name: string, url: string, items: typeof items }>}
 */
export function groupItems(items, feeds) {
  const feedList = feeds ?? getFeeds();
  const itemsByFeed = new Map(feedList.map((feed) => [feed.id, []]));

  for (const item of items) {
    itemsByFeed.get(item.feed_id)?.push(item);
  }

  for (const feedItems of itemsByFeed.values()) {
    feedItems.sort(compareByPublished);
  }

  return feedList.map((feed) => ({ ...feed, items: itemsByFeed.get(feed.id) ?? [] }));
}