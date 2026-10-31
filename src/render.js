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
  const scoreValue = item.score != null ? Number(item.score) : null;
  const scoreClass = scoreValue == null ? '' : scoreValue >= 80 ? ' high' : scoreValue >= 60 ? ' mid' : '';
  const score = scoreValue != null ? `<span class="score${scoreClass}">${escapeHtml(String(scoreValue))}</span>` : '';
  const time = published ? `<time>${escapeHtml(published)}</time>` : '';

  return `<li>
  <a href="${escapeHtml(safeUrl(item.url))}">${escapeHtml(item.title)}</a>
  <div class="meta">${score}${time}</div>
</li>`;
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
    :root {
      color-scheme: light dark;
      --bg: #f6f7f9;
      --card: #ffffff;
      --text: #1f2937;
      --muted: #6b7280;
      --border: #e5e7eb;
      --accent: #2563eb;
      --score-bg: #e0e7ff;
      --score-text: #1e3a8a;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f172a;
        --card: #1e293b;
        --text: #e2e8f0;
        --muted: #94a3b8;
        --border: #334155;
        --accent: #60a5fa;
        --score-bg: #1e3a8a;
        --score-text: #bfdbfe;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      background: var(--bg);
      color: var(--text);
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
      line-height: 1.5;
    }
    .container { max-width: 72rem; margin: 0 auto; padding: 2.5rem 1.25rem 4rem; }
    header { margin-bottom: 2rem; }
    h1 { margin: 0 0 0.25rem; font-size: 2rem; font-weight: 700; letter-spacing: -0.02em; }
    .subtitle { margin: 0; color: var(--muted); font-size: 0.95rem; }
    .sync { margin: 0.5rem 0 0; color: var(--muted); font-size: 0.8rem; }
    .feeds { display: flex; flex-direction: column; gap: 1.5rem; }
    .feed {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 0.75rem;
      padding: 1.25rem 1.5rem;
      box-shadow: 0 1px 2px rgba(0,0,0,0.04);
    }
    .feed h2 { margin: 0 0 0.75rem; font-size: 1.1rem; font-weight: 600; }
    .feed h2 a { color: var(--accent); text-decoration: none; }
    .feed h2 a:hover { text-decoration: underline; }
    ul { list-style: none; padding: 0; margin: 0; columns: 2; column-gap: 1rem; }
    li { break-inside: avoid; margin-bottom: 0.75rem; }
    li {
      padding: 0.6rem 0.75rem;
      border: 1px solid var(--border);
      border-radius: 0.5rem;
    }
    li:first-child { border-top: none; padding-top: 0; }
    li a { color: var(--text); text-decoration: none; font-weight: 500; }
    li a:hover { color: var(--accent); }
    .meta { display: flex; align-items: center; gap: 0.5rem; margin-top: 0.25rem; }
    .score {
      display: inline-block;
      padding: 0.15rem 0.55rem;
      border-radius: 999px;
      background: var(--score-bg);
      color: var(--score-text);
      font-size: 0.75rem;
      font-weight: 600;
    }
    .score.high { background: #dcfce7; color: #166534; }
    .score.mid { background: #fef9c3; color: #854d0e; }
    @media (prefers-color-scheme: dark) {
      .score.high { background: #14532d; color: #bbf7d0; }
      .score.mid { background: #713f12; color: #fef08a; }
    }
    time { color: var(--muted); font-size: 0.8rem; }
    .empty { color: var(--muted); font-style: italic; margin: 0; }
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>News</h1>
      <p class="subtitle">${total} stored headline${total === 1 ? '' : 's'} from ${feeds.length} RSS feeds.</p>
      <p class="sync">Last sync: ${escapeHtml(lastSync ?? 'never')}</p>
    </header>
    <main class="feeds">
      ${feeds.map(renderFeed).join('\n    ')}
    </main>
  </div>
</body>
</html>`;
}