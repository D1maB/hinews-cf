import { FEEDS } from './feeds.js';
import { ingestFeeds } from './ingest.js';
import { countItems, listItems } from './store.js';

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
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/**
 * Returns the URL only when it uses a safe protocol.
 *
 * @param {string} value
 * @returns {string}
 */
function safeUrl(value) {
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
function formatDate(value) {
  if (!value) {
    return '';
  }

  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * @param {{ title: string, url: string, published_at: string | null }} item
 * @returns {string}
 */
function renderItem(item) {
  const published = formatDate(item.published_at);
  const time = published ? `<time>${escapeHtml(published)}</time>` : '';

  return `<li><a href="${escapeHtml(safeUrl(item.url))}">${escapeHtml(item.title)}</a>${time}</li>`;
}

/**
 * @param {{ name: string, url: string, items: Array<{ title: string, url: string, published_at: string | null }> }} feed
 * @returns {string}
 */
function renderFeed(feed) {
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
 * @returns {string}
 */
function renderPage(feeds, total) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>PC parts news</title>
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
    .empty { color: #666; }
    @media (prefers-color-scheme: dark) {
      .feed { border-color: #444; }
      .subtitle, time, .empty { color: #aaa; }
    }
  </style>
</head>
<body>
  <header>
    <h1>PC parts news</h1>
    <p class="subtitle">${total} stored headline${total === 1 ? '' : 's'} from ${feeds.length} RSS feeds.</p>
  </header>
  <main class="feeds">
    ${feeds.map(renderFeed).join('\n    ')}
  </main>
</body>
</html>`;
}

/**
 * Groups stored rows into the configured feed order.
 *
 * @param {Array<{ feed_id: string, title: string, url: string, published_at: string | null }>} items
 * @returns {Array<{ id: string, name: string, url: string, items: typeof items }>}
 */
function groupItems(items) {
  const itemsByFeed = new Map(FEEDS.map((feed) => [feed.id, []]));

  for (const item of items) {
    itemsByFeed.get(item.feed_id)?.push(item);
  }

  return FEEDS.map((feed) => ({ ...feed, items: itemsByFeed.get(feed.id) ?? [] }));
}

/**
 * Renders the stored headlines, seeding the database on the first request.
 *
 * @param {Request} _request
 * @param {Record<string, unknown>} env
 * @returns {Promise<Response>}
 */
async function handleRequest(_request, env) {
  if ((await countItems(env.DB)) === 0) {
    await ingestFeeds(env);
  }

  const items = await listItems(env.DB);

  return new Response(renderPage(groupItems(items), items.length), {
    headers: { 'content-type': 'text/html;charset=UTF-8' },
  });
}

/**
 * Refreshes the database every 12 hours.
 *
 * @param {ScheduledController} _controller
 * @param {Record<string, unknown>} env
 * @param {ExecutionContext} ctx
 */
function handleScheduled(_controller, env, ctx) {
  ctx.waitUntil(ingestFeeds(env));
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
};
