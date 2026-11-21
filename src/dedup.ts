export function normalizeTitle(title: unknown): string {
  return String(title ?? '')
    .trim()
    .toLowerCase();
}

export function dedupByTitle<T extends { title: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const key = normalizeTitle(item.title);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function dedupByUrl<T extends { url: string }>(items: T[]): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    if (seen.has(item.url)) return false;
    seen.add(item.url);
    return true;
  });
}

export function dedupItems<T extends { url: string; title: string }>(
  items: T[],
): T[] {
  const seenUrls = new Set<string>();
  const seenTitles = new Set<string>();
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
