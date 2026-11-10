import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';
import { FEEDS } from '../src/feeds.js';
import { createFakeDb } from './fake-db.js';

const REQUEST = new Request('https://example.com/');

/**
 * @param {string} feedId
 * @returns {string}
 */
function rssFor(feedId) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <item>
      <title>${feedId} PC GPU benchmark</title>
      <link>https://example.com/${feedId}/story</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;
}

/**
 * @returns {{ ASSETS: { fetch: (url: URL) => Promise<Response> }, fetches: () => number }}
 */
function localAssets() {
  let fetches = 0;

  return {
    ASSETS: {
      fetch: async (url) => {
        fetches += 1;
        return new Response(rssFor(url.pathname.slice(1, -4)));
      },
    },
    fetches: () => fetches,
  };
}

test('renders every stored item from the database', async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    feed_id: 'kitguru',
    feed_name: 'KitGuru',
    title: `Stored story ${index + 1} PC GPU benchmark`,
    url: `https://example.com/story-${index + 1}`,
    published_at: '2024-01-01T00:00:00.000Z',
  }));

  const response = await worker.fetch(REQUEST, { DB: createFakeDb(rows) });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.match(html, /7 stored headlines from 8 RSS feeds/);

  for (const row of rows) {
    assert.ok(html.includes(row.title), `missing ${row.title}`);
  }
});

test('renders all stored items in a single list with source notes sorted by scheduled time', async () => {
  const db = createFakeDb([
    {
      feed_id: 'wccftech',
      feed_name: 'Wccftech',
      title: '<script>alert(1)</script>',
      url: 'https://example.com/unsafe',
      published_at: '2024-01-02T00:00:00.000Z',
      scheduled_at: '2026-11-02T10:00:00.000Z',
    },
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'KitGuru story',
      url: 'https://example.com/kitguru',
      published_at: '2024-01-01T00:00:00.000Z',
      scheduled_at: '2026-11-02T12:34:00.000Z',
    },
  ]);

  const html = await (await worker.fetch(REQUEST, { DB: db })).text();

  assert.doesNotMatch(html, /<section class="feed">/);

  const items = [...html.matchAll(/<li>[\s\S]*?<\/li>/g)].map((match) => match[0]);
  assert.equal(items.length, 2);
  assert.match(items[0], /Source: Wccftech/);
  assert.match(items[0], /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(items[1], /KitGuru story/);
  assert.match(items[1], /Source: KitGuru/);
});

test('seeds the database on the first request and reuses it afterwards', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();
  const assets = localAssets();
  const env = { ...assets, DB: db };

  const first = await (await worker.fetch(REQUEST, env)).text();
  const fetchesAfterFirstRequest = assets.fetches();

  assert.equal(db.rows.size, FEEDS.length);
  assert.match(first, /8 stored headlines/);
  assert.equal(fetchesAfterFirstRequest, FEEDS.length);
  assert.match(first, /Last sync: \d{1,2} [A-Za-z]+ \d{4} \d{2}:\d{2}/);

  await worker.fetch(REQUEST, env);

  assert.equal(assets.fetches(), fetchesAfterFirstRequest);
});

test('scheduled runs store fresh items', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();
  const env = { ...localAssets(), DB: db };
  let pending;

  worker.scheduled({ cron: '0 */12 * * *' }, env, {
    waitUntil: (promise) => {
      pending = promise;
    },
  });

  await pending;

  assert.equal(db.rows.size, FEEDS.length);
});

test('scheduled runs clear stored items before ingesting fresh news', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Old story',
      url: 'https://example.com/old',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'published',
      scheduled_at: '2026-11-01T10:00:00.000Z',
      score: 60,
    },
  ]);
  const env = { ...localAssets(), DB: db };
  let pending;

  worker.scheduled({ cron: '0 */12 * * *' }, env, {
    waitUntil: (promise) => {
      pending = promise;
    },
  });

  await pending;

  assert.equal(db.rows.size, FEEDS.length);
});

test('admin api login validates the token', async () => {
  const okResponse = await worker.fetch(
    new Request('https://example.com/api/login', { method: 'POST', body: JSON.stringify({ token: 'test-token' }) }),
    { ADMIN_TOKEN: 'test-token' },
  );
  assert.equal(okResponse.status, 200);

  const badResponse = await worker.fetch(
    new Request('https://example.com/api/login', { method: 'POST', body: JSON.stringify({ token: 'wrong' }) }),
    { ADMIN_TOKEN: 'test-token' },
  );
  assert.equal(badResponse.status, 401);
});

test('admin api rejects unauthenticated feed requests', async () => {
  const response = await worker.fetch(new Request('https://example.com/api/feeds'), { DB: createFakeDb(), ADMIN_TOKEN: 'test-token' });

  assert.equal(response.status, 401);
});

test('admin api lists stored feeds when authorized', async () => {
  const db = createFakeDb();
  db.rows.set('testfeed', { id: 'testfeed', feed_id: 'testfeed', feed_name: 'Test Feed', title: '', url: 'https://example.com/feed', published_at: null, score: null, status: 'scheduled', scheduled_at: null });
  const env = { DB: db, ADMIN_TOKEN: 'test-token' };
  const response = await worker.fetch(new Request('https://example.com/api/feeds', { headers: { 'x-admin-token': 'test-token' } }), env);

  assert.equal(response.status, 200);
  const data = await response.json();
  assert.equal(data.feeds.length, 1);
  assert.equal(data.feeds[0].id, 'testfeed');
});

test('admin api creates and deletes feeds', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();
  const env = { DB: db, ADMIN_TOKEN: 'test-token' };
  const headers = { 'x-admin-token': 'test-token', 'content-type': 'application/json' };

  const createResponse = await worker.fetch(
    new Request('https://example.com/api/feeds', { method: 'POST', headers, body: JSON.stringify({ id: 'newfeed', name: 'New Feed', url: 'https://example.com/new' }) }),
    env,
  );
  assert.equal(createResponse.status, 200);

  const listResponse = await worker.fetch(new Request('https://example.com/api/feeds', { headers }), env);
  const listData = await listResponse.json();
  assert.ok(listData.feeds.some((feed) => feed.id === 'newfeed'));

  const deleteResponse = await worker.fetch(new Request('https://example.com/api/feeds/newfeed', { method: 'DELETE', headers }), env);
  assert.equal(deleteResponse.status, 200);

  const afterDeleteResponse = await worker.fetch(new Request('https://example.com/api/feeds', { headers }), env);
  const afterDeleteData = await afterDeleteResponse.json();
  assert.ok(!afterDeleteData.feeds.some((feed) => feed.id === 'newfeed'));
});

test('admin api creates and deletes items', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();
  const env = { DB: db, ADMIN_TOKEN: 'test-token' };
  const headers = { 'x-admin-token': 'test-token', 'content-type': 'application/json' };

  const createResponse = await worker.fetch(
    new Request('https://example.com/api/items', { method: 'POST', headers, body: JSON.stringify({ feedId: 'kitguru', feedName: 'KitGuru', title: 'KitGuru pc gpu benchmark', url: 'https://example.com/story', publishedAt: '2024-01-01T00:00:00.000Z', score: 60 }) }),
    env,
  );
  assert.equal(createResponse.status, 200);

  const listResponse = await worker.fetch(new Request('https://example.com/api/items', { headers }), env);
  const listData = await listResponse.json();
  assert.ok(listData.items.some((item) => item.url === 'https://example.com/story'));

  const deleteResponse = await worker.fetch(new Request('https://example.com/api/items?url=' + encodeURIComponent('https://example.com/story'), { method: 'DELETE', headers }), env);
  assert.equal(deleteResponse.status, 200);

  const afterDeleteResponse = await worker.fetch(new Request('https://example.com/api/items', { headers }), env);
  const afterDeleteData = await afterDeleteResponse.json();
  assert.ok(!afterDeleteData.items.some((item) => item.url === 'https://example.com/story'));
});
