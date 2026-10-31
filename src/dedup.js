/**
 * Normalizes a title for duplicate comparison.
 *
 * @param {string} title
 * @returns {string}
 */
export function normalizeTitle(title) {
  return String(title ?? '').trim().toLowerCase();
}

/**
 * Drops items whose titles duplicate an earlier item.
 *
 * @template {{ title: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function dedupByTitle(items) {
  const seen = new Set();
  return items.filter((item) => {
    const key = normalizeTitle(item.title);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

/**
 * Drops items whose URLs duplicate an earlier item.
 *
 * @template {{ url: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function dedupByUrl(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (seen.has(item.url)) {
      return false;
    }
    seen.add(item.url);
    return true;
  });
}

/**
 * Drops items that duplicate an earlier item by URL or title.
 *
 * @template {{ url: string, title: string }} T
 * @param {T[]} items
 * @returns {T[]}
 */
export function dedupItems(items) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  return items.filter((item) => {
    const titleKey = normalizeTitle(item.title);
    if (seenUrls.has(item.url) || seenTitles.has(titleKey)) {
      return false;
    }
    seenUrls.add(item.url);
    seenTitles.add(titleKey);
    return true;
  });
}