import assert from 'node:assert/strict';
import test from 'node:test';

import { publishScheduled } from '../src/publish.ts';
import { createFakeDb } from './fake-db.ts';

const originalFetch = globalThis.fetch;

function mockFetch(responses) {
  globalThis.fetch = async () => {
    const response = responses.shift();
    if (!response) {
      throw new Error('No more mocked responses');
    }
    return response instanceof Response
      ? response
      : new Response(JSON.stringify(response), {
          status: response.status ?? 200,
          headers: { 'content-type': 'application/json' },
        });
  };
}

function restoreFetch() {
  globalThis.fetch = originalFetch;
}

test('publishScheduled posts to Telegram when configured', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Test story',
      url: 'https://example.com/test',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'scheduled',
      scheduled_at: '2020-01-01T00:00:00.000Z',
      score: 60,
    },
  ]);
  const env = {
    DB: db,
    TELEGRAM_ENABLED: true,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '123456',
  };

  mockFetch([{ ok: true, result: { message_id: 1 } }]);

  const result = await publishScheduled(env);

  assert.equal(result.published, 1);
  const item = db.rows.get('https://example.com/test');
  assert.equal(item.status, 'published');

  restoreFetch();
});

test('publishScheduled does nothing when no items are due', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();
  const env = {
    DB: db,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '123456',
  };

  const result = await publishScheduled(env);

  assert.equal(result.published, 0);
});

test('publishScheduled posts to Bluesky when configured', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Test story',
      url: 'https://example.com/test',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'scheduled',
      scheduled_at: '2020-01-01T00:00:00.000Z',
      score: 60,
      description: 'A description worth reading.',
    },
  ]);
  const env = {
    DB: db,
    BSKY_ENABLED: true,
    BSKY_HANDLE: 'hinews.bsky.social',
    BSKY_APP_PASSWORD: 'app-password',
  };

  const calls = [];
  globalThis.fetch = async (url, init) => {
    const callUrl = String(url);
    calls.push({ url: callUrl, init });

    if (callUrl.includes('app.bsky.actor.createSession')) {
      return new Response(
        JSON.stringify({
          accessJwt: 'bsky-access-token',
          refreshJwt: 'bsky-refresh-token',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    if (callUrl.includes('app.bsky.feed.post')) {
      return new Response(
        JSON.stringify({
          ok: true,
          result: {
            message: { uri: 'at://did:plc:test/app.bsky.feed.post/1' },
          },
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    throw new Error(`Unexpected fetch: ${callUrl}`);
  };

  const result = await publishScheduled(env);

  assert.equal(result.published, 1);
  assert.equal(calls.length, 2);

  assert.ok(calls[0].url.includes('app.bsky.actor.createSession'));
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(JSON.parse(calls[0].init.body), {
    identifier: 'hinews.bsky.social',
    password: 'app-password',
  });

  assert.ok(calls[1].url.includes('app.bsky.feed.post'));
  assert.equal(calls[1].init.method, 'POST');
  assert.equal(calls[1].init.headers.authorization, 'Bearer bsky-access-token');
  assert.equal(
    JSON.parse(calls[1].init.body).text,
    'Test story\n\nA description worth reading.\n\nhttps://example.com/test',
  );

  restoreFetch();
});

test('publishScheduled skips Telegram when not enabled', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Test story',
      url: 'https://example.com/test',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'scheduled',
      scheduled_at: '2020-01-01T00:00:00.000Z',
      score: 60,
    },
  ]);
  const env = {
    DB: db,
    TELEGRAM_ENABLED: false,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '123456',
  };

  mockFetch([]);

  const result = await publishScheduled(env);

  assert.equal(result.published, 0);
  const item = db.rows.get('https://example.com/test');
  assert.equal(item.status, 'scheduled');
});

test('publishScheduled skips Bluesky when not enabled', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Test story',
      url: 'https://example.com/test',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'scheduled',
      scheduled_at: '2020-01-01T00:00:00.000Z',
      score: 60,
      description: 'A description worth reading.',
    },
  ]);
  const env = {
    DB: db,
    BSKY_ENABLED: false,
    BSKY_HANDLE: 'hinews.bsky.social',
    BSKY_APP_PASSWORD: 'app-password',
  };

  mockFetch([]);

  const result = await publishScheduled(env);

  assert.equal(result.published, 0);
  const item = db.rows.get('https://example.com/test');
  assert.equal(item.status, 'scheduled');
});

test('publishScheduled does not mark published when Bluesky post fails', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Test story',
      url: 'https://example.com/test',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'scheduled',
      scheduled_at: '2020-01-01T00:00:00.000Z',
      score: 60,
      description: 'A description worth reading.',
    },
  ]);
  const env = {
    DB: db,
    BSKY_ENABLED: true,
    BSKY_HANDLE: 'hinews.bsky.social',
    BSKY_APP_PASSWORD: 'app-password',
  };

  globalThis.fetch = async (url) => {
    const callUrl = String(url);

    if (callUrl.includes('app.bsky.actor.createSession')) {
      return new Response(
        JSON.stringify({
          accessJwt: 'bsky-access-token',
          refreshJwt: 'bsky-refresh-token',
        }),
        {
          status: 200,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    return new Response(JSON.stringify({ error: 'Bluesky unavailable' }), {
      status: 503,
      headers: { 'content-type': 'application/json' },
    });
  };

  const result = await publishScheduled(env);

  assert.equal(result.published, 0);
  const item = db.rows.get('https://example.com/test');
  assert.equal(item.status, 'scheduled');

  restoreFetch();
});
