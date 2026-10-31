const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * @param {string} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Returns the URL only when it uses a safe protocol.
 *
 * @param {string} value
 * @returns {string}
 */
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : '#';
  } catch {
    return '#';
  }
}

/**
 * @param {string | null} value
 * @returns {string}
 */
export function formatDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * @param {{ title: string, url: string, published_at: string | null, score?: number | null }} item
 * @returns {string}
 */
export function renderItem(item) {
  const published = formatDate(item.published_at);
  const time = published ? `<time>${escapeHtml(published)}</time>` : '';
  const score = item.score != null ? `<span class="score">${escapeHtml(String(item.score))}</span>` : '';

  return `<li><a href="${escapeHtml(safeUrl(item.url))}">${escapeHtml(item.title)}</a>${score}${time}</li>`;
}

/**
 * @param {{ name: string, url: string, items: Array<{ title: string, url: string, published_at: string | null }> }} feed
 * @returns {string}
 */
export function renderFeed(feed) {
  const items = feed.items.length
    ? `<ul>${feed.items.map(renderItem).join('')}</ul>`
    : '<p class="empty">No stored items yet.</p>';

  return `<section class="feed">
  <h2><a href="${escapeHtml(safeUrl(feed.url))}">${escapeHtml(feed.name)}</a></h2>
  ${items}
</section>`;
}

/**
 * @param {Array<{ name: string, url: string, items: Array<{ title: string, url: string, published_at: string | null }> }>} feeds
 * @param {number} total
 * @param {string | null} [lastSync]
 * @returns {string}
 */
export function renderPage(feeds, total, lastSync = null) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>News</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0 auto; max-width: 60rem; padding: 2rem 1rem; line-height: 1.5; }
    h1 { margin-bottom: 0.25rem; }
    .subtitle { color: #666; margin-top: 0; }
    .feeds { display: grid; gap: 1.5rem; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); }
    .feed { border: 1px solid #ddd; border-radius: 0.5rem; padding: 1rem 1.25rem; }
    .feed h2 { font-size: 1.1rem; margin-top: 0; }
    ul { padding-left: 1.1rem; }
    li { margin-bottom: 0.6rem; }
    time { display: block; color: #666; font-size: 0.85rem; }
    .score { display: inline-block; margin-left: 0.5rem; padding: 0 0.4rem; border-radius: 0.25rem; background: #eee; font-size: 0.8rem; }
    .empty { color: #666; }
    @media (prefers-color-scheme: dark) {
      .feed { border-color: #444; }
      .subtitle, time, .empty { color: #aaa; }
      .score { background: #333; }
    }
  </style>
</head>
<body>
  <header>
    <h1>News</h1>
    <p class="subtitle">${total} stored headline${total === 1 ? '' : 's'} from ${feeds.length} RSS feeds.</p>
    <p class="sync">Last sync: ${escapeHtml(lastSync ?? 'never')}</p>
  </header>
  <main class="feeds">
    ${feeds.map(renderFeed).join('\n    ')}
  </main>
</body>
</html>`;
}