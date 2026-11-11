import assert from 'node:assert/strict';
import test from 'node:test';

import { publishScheduled } from '../src/publish.js';
import { createFakeDb } from './fake-db.js';

const originalFetch = globalThis.fetch;

function mockFetch(responses) {
  globalThis.fetch = async (...args) => {
    const response = responses.shift();
    if (!response) {
      throw new Error('No more mocked responses');
    }
    return response instanceof Response ? response : new Response(JSON.stringify(response), {
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