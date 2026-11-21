import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { DEFAULT_FEEDS } from '../src/feeds.ts';
import { ingestFeeds } from '../src/ingest.ts';
import { createFakeDb } from './fake-db.ts';
import type { Env } from '../src/types.ts';

function rssFor(feedId: string): string {
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

function localEnv(
  overrides: Record<string, string | Response> = {},
): Pick<Env, 'ASSETS' | 'FEEDS'> {
  return {
    ASSETS: {
      fetch: async (input: RequestInfo | URL) => {
        const url = new URL(String(input));
        const id = url.pathname.slice(1, -4);
        const override = overrides[id];

        return override instanceof Response
          ? override
          : new Response(override ?? rssFor(id));
      },
    },
  };
}

function mockScoring(t: TestContext): void {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"score": 82}' } }],
        }),
        { status: 200 },
      ),
  );
}

test('stores parsed feed items in the database', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockScoring(t);
  const db = createFakeDb();

  const { inserted } = await ingestFeeds({ ...localEnv(), DB: db });

  assert.equal(inserted, DEFAULT_FEEDS.length);
  assert.equal(db.rows.size, DEFAULT_FEEDS.length);
  assert.ok(db.rows.has('https://example.com/tomshardware/story'));
});

test('writes a URL only once when several feeds share it', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockScoring(t);
  const db = createFakeDb();
  const sharedStory = rssFor('tomshardware');
  const env = {
    ...localEnv({ techpowerup: sharedStory }),
    DB: db,
  };

  const { inserted } = await ingestFeeds(env);

  assert.equal(inserted, DEFAULT_FEEDS.length - 1);
  assert.equal(db.rows.size, DEFAULT_FEEDS.length - 1);
  assert.equal(db.writes, DEFAULT_FEEDS.length);
});

test('does not store the same news URL twice', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockScoring(t);
  const db = createFakeDb();
  const env = { ...localEnv(), DB: db };

  await ingestFeeds(env);
  const { inserted } = await ingestFeeds(env);

  assert.equal(inserted, 0);
  assert.equal(db.rows.size, DEFAULT_FEEDS.length);
});

test('stores available feeds when one feed fails', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  mockScoring(t);
  const db = createFakeDb();
  const env = {
    ...localEnv({ techpowerup: new Response('missing', { status: 404 }) }),
    DB: db,
  };

  const { inserted } = await ingestFeeds(env);

  assert.equal(inserted, DEFAULT_FEEDS.length - 1);
  assert.equal(db.rows.size, DEFAULT_FEEDS.length - 1);
});

test('schedules ingested items within one 12 hour window', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockScoring(t);
  const db = createFakeDb();
  const { inserted } = await ingestFeeds({ ...localEnv(), DB: db });

  assert.equal(inserted, DEFAULT_FEEDS.length);

  const times = [...db.rows.values()].map((row) =>
    new Date(String(row.scheduled_at)).getTime(),
  );
  assert.equal(times.length, DEFAULT_FEEDS.length);
  const spread = Math.max(...times) - Math.min(...times);
  assert.ok(spread < 12 * 60 * 60 * 1000);
});
