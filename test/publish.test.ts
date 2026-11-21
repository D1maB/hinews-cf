import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { publishScheduled } from '../src/publish.ts';
import { createFakeDb } from './fake-db.ts';
import type { Env } from '../src/types.ts';

type FetchHandler = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

function installFetch(t: TestContext, handler: FetchHandler): void {
  t.mock.method(globalThis, 'fetch', handler);
}

function scheduledItem(overrides: Record<string, unknown> = {}) {
  return {
    feed_id: 'kitguru',
    feed_name: 'KitGuru',
    title: 'Test story',
    url: 'https://example.com/test',
    published_at: '2024-01-01T00:00:00.000Z',
    status: 'scheduled',
    scheduled_at: '2020-01-01T00:00:00.000Z',
    score: 60,
    ...overrides,
  };
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

test('publishScheduled posts to Telegram when configured', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb([scheduledItem()]);
  const env: Env = {
    DB: db,
    TELEGRAM_ENABLED: true,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '123456',
  };

  installFetch(t, async () =>
    jsonResponse({ ok: true, result: { message_id: 1 } }),
  );

  const result = await publishScheduled(env);

  assert.equal(result.published, 1);
  const item = db.rows.get('https://example.com/test');
  assert.equal(item?.status, 'published');
  assert.equal(item?.telegram_published, 1);
});

test('publishScheduled does nothing when no items are due', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();
  const env: Env = {
    DB: db,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '123456',
  };

  const result = await publishScheduled(env);

  assert.equal(result.published, 0);
});

test('publishScheduled posts to Bluesky when configured', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb([
    scheduledItem({
      description: 'A description worth reading.',
    }),
  ]);
  const env: Env = {
    DB: db,
    BSKY_ENABLED: true,
    BSKY_HANDLE: 'hinews.bsky.social',
    BSKY_APP_PASSWORD: 'app-password',
  };

  const calls: Array<{ url: string; init?: RequestInit }> = [];
  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });

      if (url.includes('app.bsky.actor.createSession')) {
        return jsonResponse({
          accessJwt: 'bsky-access-token',
          refreshJwt: 'bsky-refresh-token',
        });
      }
      if (url.includes('app.bsky.feed.post')) {
        return jsonResponse({
          ok: true,
          result: {
            message: { uri: 'at://did:plc:test/app.bsky.feed.post/1' },
          },
        });
      }
      throw new Error(`Unexpected fetch: ${url}`);
    },
  );

  const result = await publishScheduled(env);

  assert.equal(result.published, 1);
  assert.equal(calls.length, 2);

  const sessionCall = calls[0];
  assert.ok(sessionCall?.url.includes('app.bsky.actor.createSession'));
  assert.equal(sessionCall?.init?.method, 'POST');
  assert.deepEqual(JSON.parse(String(sessionCall?.init?.body)), {
    identifier: 'hinews.bsky.social',
    password: 'app-password',
  });

  const postCall = calls[1];
  assert.ok(postCall?.url.includes('app.bsky.feed.post'));
  assert.equal(postCall?.init?.method, 'POST');
  assert.equal(
    (postCall?.init?.headers as Record<string, string>).authorization,
    'Bearer bsky-access-token',
  );
  assert.equal(
    JSON.parse(String(postCall?.init?.body)).text,
    'Test story\n\nA description worth reading.\n\nhttps://example.com/test',
  );

  const item = db.rows.get('https://example.com/test');
  assert.equal(item?.status, 'published');
  assert.equal(item?.bsky_published, 1);
});

test('publishScheduled skips Telegram when not enabled', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb([scheduledItem()]);
  const env: Env = {
    DB: db,
    TELEGRAM_ENABLED: false,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '123456',
  };

  const result = await publishScheduled(env);

  assert.equal(result.published, 0);
  assert.equal(db.rows.get('https://example.com/test')?.status, 'scheduled');
});

test('publishScheduled skips Bluesky when not enabled', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb([scheduledItem()]);
  const env: Env = {
    DB: db,
    BSKY_ENABLED: false,
    BSKY_HANDLE: 'hinews.bsky.social',
    BSKY_APP_PASSWORD: 'app-password',
  };

  const result = await publishScheduled(env);

  assert.equal(result.published, 0);
  assert.equal(db.rows.get('https://example.com/test')?.status, 'scheduled');
});

test('publishScheduled does not mark published when Bluesky post fails', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const db = createFakeDb([
    scheduledItem({ description: 'A description worth reading.' }),
  ]);
  const env: Env = {
    DB: db,
    BSKY_ENABLED: true,
    BSKY_HANDLE: 'hinews.bsky.social',
    BSKY_APP_PASSWORD: 'app-password',
  };

  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('app.bsky.actor.createSession')) {
      return jsonResponse({
        accessJwt: 'bsky-access-token',
        refreshJwt: 'bsky-refresh-token',
      });
    }
    return jsonResponse({ error: 'Bluesky unavailable' }, 503);
  });

  const result = await publishScheduled(env);

  assert.equal(result.published, 0);
  assert.equal(db.rows.get('https://example.com/test')?.status, 'scheduled');
});

test('publishScheduled retries only the destination that failed', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  const db = createFakeDb([scheduledItem()]);
  const env: Env = {
    DB: db,
    TELEGRAM_ENABLED: true,
    TELEGRAM_BOT_TOKEN: 'test-token',
    TELEGRAM_CHAT_ID: '123456',
    BSKY_ENABLED: true,
    BSKY_HANDLE: 'hinews.bsky.social',
    BSKY_APP_PASSWORD: 'app-password',
  };

  let telegramCalls = 0;
  let blueskyPostCalls = 0;
  let blueskyAvailable = false;

  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('api.telegram.org')) {
      telegramCalls += 1;
      return jsonResponse({ ok: true });
    }
    if (url.includes('app.bsky.actor.createSession')) {
      return jsonResponse({
        accessJwt: 'bsky-access-token',
        refreshJwt: 'bsky-refresh-token',
      });
    }
    if (url.includes('app.bsky.feed.post')) {
      blueskyPostCalls += 1;
      return blueskyAvailable
        ? jsonResponse({ ok: true })
        : jsonResponse({ error: 'unavailable' }, 503);
    }
    throw new Error(`Unexpected fetch: ${url}`);
  });

  const first = await publishScheduled(env);

  assert.equal(first.published, 0);
  assert.equal(telegramCalls, 1);
  assert.equal(blueskyPostCalls, 1);
  let item = db.rows.get('https://example.com/test');
  assert.equal(item?.status, 'scheduled');
  assert.equal(item?.telegram_published, 1);
  assert.equal(item?.bsky_published, 0);

  blueskyAvailable = true;
  const second = await publishScheduled(env);

  assert.equal(second.published, 1);
  assert.equal(telegramCalls, 1, 'Telegram must not be posted twice');
  assert.equal(blueskyPostCalls, 2);
  item = db.rows.get('https://example.com/test');
  assert.equal(item?.status, 'published');
  assert.equal(item?.bsky_published, 1);
});
