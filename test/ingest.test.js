import assert from 'node:assert/strict';
import test from 'node:test';

import { FEEDS } from '../src/feeds.js';
import { ingestFeeds } from '../src/ingest.js';
import { createFakeDb } from './fake-db.js';

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
 * @param {Record<string, string | Response>} [overrides]
 * @returns {{ ASSETS: { fetch: (url: URL) => Promise<Response> } }}
 */
function localEnv(overrides = {}) {
  return {
    ASSETS: {
      fetch: async (url) => {
        const id = url.pathname.slice(1, -4);
        const override = overrides[id];

        return override instanceof Response ? override : new Response(override ?? rssFor(id));
      },
    },
  };
}

test('stores parsed feed items in the database', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();

  const { inserted } = await ingestFeeds({ ...localEnv(), DB: db });

  assert.equal(inserted, FEEDS.length);
  assert.equal(db.rows.size, FEEDS.length);
  assert.ok(db.rows.has('https://example.com/tomshardware/story'));
});

test('writes a URL only once when several feeds share it', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();
  const sharedStory = rssFor('tomshardware');
  const env = {
    ...localEnv({ techpowerup: sharedStory }),
    DB: db,
  };

  const { inserted } = await ingestFeeds(env);

  assert.equal(inserted, FEEDS.length - 1);
  assert.equal(db.rows.size, FEEDS.length - 1);
  assert.equal(db.writes, FEEDS.length);
});

test('does not store the same news URL twice', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();
  const env = { ...localEnv(), DB: db };

  await ingestFeeds(env);
  const { inserted } = await ingestFeeds(env);

  assert.equal(inserted, 0);
  assert.equal(db.rows.size, FEEDS.length);
});

test('stores available feeds when one feed fails', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const db = createFakeDb();
  const env = {
    ...localEnv({ techpowerup: new Response('missing', { status: 404 }) }),
    DB: db,
  };

  const { inserted } = await ingestFeeds(env);

  assert.equal(inserted, FEEDS.length - 1);
  assert.equal(db.rows.size, FEEDS.length - 1);
});

test('schedules ingested items within one 12 hour window', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();
  const { inserted } = await ingestFeeds({ ...localEnv(), DB: db });

  assert.equal(inserted, FEEDS.length);

  const times = [...db.rows.values()].map((row) => new Date(row.scheduled_at).getTime());
  assert.equal(times.length, FEEDS.length);
  const spread = Math.max(...times) - Math.min(...times);
  assert.ok(spread < 12 * 60 * 60 * 1000);
});
