export const FEEDS = [
  { id: 'tomshardware', name: "Tom's Hardware", url: 'https://www.tomshardware.com/feeds/all' },
  { id: 'techpowerup', name: 'TechPowerUp', url: 'https://www.techpowerup.com/rss/news' },
  { id: 'kitguru', name: 'KitGuru', url: 'https://www.kitguru.net/feed/' },
  { id: 'wccftech', name: 'Wccftech', url: 'https://wccftech.com/feed/' },
  { id: 'guru3d', name: 'Guru3D', url: 'https://www.guru3d.com/rss.xml' },
];

const ITEMS_PER_FEED = 5;

export const FEED_REQUEST_INIT = {
  headers: {
    accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    'user-agent': 'Mozilla/5.0 (compatible; hinews-cf/0.1)',
  },
  cf: { cacheEverything: true, cacheTtl: 300 },
};

const ITEM_PATTERN = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;

const NAMED_ENTITIES = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/**
 * Loads and parses one RSS feed, from local storage when available.
 *
 * @param {{ id: string, name: string, url: string }} feed
 * @param {Record<string, unknown>} env
 * @param {Request} request
 * @returns {Promise<{ name: string, url: string, items: Array<{ title: string, link: string, publishedAt: string }> }>}
 */
async function loadFeed(feed, env, request) {
  const xml = env.ASSETS
    ? await readLocalFeed(env.ASSETS, feed, request)
    : await fetchRemoteFeed(feed);

  return { ...feed, items: parseRssItems(xml) };
}

/**
 * Reads a downloaded feed from the local static assets binding.
 *
 * @param {{ fetch: (input: URL) => Promise<Response> }} assets
 * @param {{ id: string }} feed
 * @param {Request} request
 * @returns {Promise<string>}
 */
async function readLocalFeed(assets, feed, request) {
  const response = await assets.fetch(new URL(`/${feed.id}.xml`, request.url));

  if (!response.ok) {
    throw new Error(`Local feed ${feed.id}.xml not found (HTTP ${response.status})`);
  }

  return response.text();
}

/**
 * Fetches a feed from its remote site.
 *
 * @param {{ name: string, url: string }} feed
 * @returns {Promise<string>}
 */
async function fetchRemoteFeed(feed) {
  const response = await fetch(feed.url, FEED_REQUEST_INIT);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }

  return response.text();
}

/**
 * Extracts up to ITEMS_PER_FEED items from an RSS document.
 *
 * @param {string} xml
 * @returns {Array<{ title: string, link: string, publishedAt: string }>}
 */
function parseRssItems(xml) {
  return [...xml.matchAll(ITEM_PATTERN)]
    .map(([, body]) => ({
      title: readTag(body, 'title'),
      link: readTag(body, 'link'),
      publishedAt: readTag(body, 'pubDate'),
    }))
    .filter(({ title, link }) => title && link)
    .slice(0, ITEMS_PER_FEED);
}

/**
 * Reads and decodes the text content of the first matching XML tag.
 *
 * @param {string} xml
 * @param {string} tag
 * @returns {string}
 */
function readTag(xml, tag) {
  const match = xml.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));

  return match ? decodeXml(match[1]) : '';
}

/**
 * Turns XML text into plain text: strips CDATA wrappers and nested markup,
 * then decodes numeric and named entities.
 *
 * @param {string} value
 * @returns {string}
 */
function decodeXml(value) {
  return value
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => decodeCodePoint(code))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED_ENTITIES[name.toLowerCase()] ?? entity)
    .trim();
}

/**
 * @param {string} code Decimal digits or a hexadecimal number prefixed with "x".
 * @returns {string}
 */
function decodeCodePoint(code) {
  const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);

  try {
    return String.fromCodePoint(value);
  } catch {
    return '';
  }
}

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
 * @param {string} value
 * @returns {string}
 */
function formatDate(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime())
    ? ''
    : date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * @param {{ title: string, link: string, publishedAt: string }} item
 * @returns {string}
 */
function renderItem(item) {
  const published = formatDate(item.publishedAt);
  const time = published ? `<time>${escapeHtml(published)}</time>` : '';

  return `<li><a href="${escapeHtml(safeUrl(item.link))}">${escapeHtml(item.title)}</a>${time}</li>`;
}

/**
 * @param {{ name: string, url: string, items: Array<{ title: string, link: string, publishedAt: string }>, error?: string }} feed
 * @returns {string}
 */
function renderFeed(feed) {
  const error = feed.error
    ? `<p class="error">Could not load feed: ${escapeHtml(feed.error)}</p>`
    : '';
  const items = feed.items.length
    ? `<ul>${feed.items.map(renderItem).join('')}</ul>`
    : '<p class="empty">No items found.</p>';

  return `<section class="feed">
  <h2><a href="${escapeHtml(safeUrl(feed.url))}">${escapeHtml(feed.name)}</a></h2>
  ${error}
  ${items}
</section>`;
}

/**
 * @param {Array<{ name: string, url: string, items: Array<{ title: string, link: string, publishedAt: string }>, error?: string }>} feeds
 * @returns {string}
 */
function renderPage(feeds) {
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
    .error { color: #b00020; }
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
    <p class="subtitle">Latest hardware headlines from ${feeds.length} RSS feeds.</p>
  </header>
  <main class="feeds">
    ${feeds.map(renderFeed).join('\n    ')}
  </main>
</body>
</html>`;
}

async function handleRequest(request, env = {}) {
  const results = await Promise.allSettled(
    FEEDS.map((feed) => loadFeed(feed, env, request)),
  );

  const feeds = results.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          ...FEEDS[index],
          items: [],
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
        },
  );

  return new Response(renderPage(feeds), {
    headers: { 'content-type': 'text/html;charset=UTF-8' },
  });
}

export default {
  fetch: handleRequest,
};
