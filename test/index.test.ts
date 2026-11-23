import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import worker from '../src/index.ts';
import { createFakeDb } from './fake-db.ts';
import type { Env } from '../src/types.ts';

const REQUEST = new Request('https://example.com/');

const ARTICLES = [
  {
    title: 'RTX 5090 review',
    description: 'A deep dive into the new flagship GPU.',
    source: "Tom's Hardware",
    url: 'https://www.tomshardware.com/reviews/rtx-5090',
    score: 90,
  },
  {
    title: 'Ryzen 9950X benchmarks',
    description: 'The new CPU in our test bench.',
    source: 'TechPowerUp',
    url: 'https://www.techpowerup.com/review/ryzen-9950x',
    score: 75,
  },
];

function mockSearch(t: TestContext, items: unknown = ARTICLES): void {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(items) }] } },
          ],
        }),
        { status: 200 },
      ),
  );
}

function runScheduled(env: Env, cron: string): Promise<unknown> {
  let pending: Promise<unknown> | undefined;
  worker.scheduled({ cron } as ScheduledController, env, {
    waitUntil: (promise) => {
      pending = Promise.resolve(promise);
    },
    passThroughOnException: () => {},
  } as ExecutionContext);
  assert.ok(pending, 'scheduled handler did not call waitUntil');
  return pending;
}

test('renders every stored item from the database', async () => {
  const rows = Array.from({ length: 7 }, (_, index) => ({
    feed_id: 'kitguru',
    feed_name: 'KitGuru',
    title: `Stored story ${index + 1} PC GPU benchmark`,
    url: `https://example.com/story-${index + 1}`,
    published_at: '2024-01-01T00:00:00.000Z',
  }));

  const response = await worker.fetch(REQUEST, {
    DB: createFakeDb(rows),
  });
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /^text\/html/);
  assert.match(html, /7 stored headlines from 8 sources via AI web search/);

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
      status: 'scheduled',
    },
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'KitGuru story',
      url: 'https://example.com/kitguru',
      published_at: '2024-01-01T00:00:00.000Z',
      scheduled_at: '2026-11-02T12:34:00.000Z',
      status: 'scheduled',
    },
  ]);

  const html = await (await worker.fetch(REQUEST, { DB: db })).text();

  assert.doesNotMatch(html, /<section class="feed">/);

  const items = [...html.matchAll(/<li>[\s\S]*?<\/li>/g)].map(
    (match) => match[0],
  );
  assert.equal(items.length, 2);
  assert.match(items[0] ?? '', /Source: Wccftech/);
  assert.match(items[0] ?? '', /Status: scheduled/);
  assert.match(items[0] ?? '', /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.ok(!html.includes('<script>alert(1)</script>'));
  assert.match(items[1] ?? '', /KitGuru story/);
  assert.match(items[1] ?? '', /Source: KitGuru/);
  assert.match(items[1] ?? '', /Status: scheduled/);
});

test('renders an empty page when the database has no items yet', async () => {
  const db = createFakeDb();

  const first = await (await worker.fetch(REQUEST, { DB: db })).text();

  assert.equal(db.rows.size, 0);
  assert.match(first, /0 stored headlines/);
  assert.match(first, /Last sync: never/);
});

test('scheduled runs store fresh items', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb();
  mockSearch(t);

  await runScheduled(
    { DB: db, GEMINI_API_KEY: 'secret-key', GEMINI_MODEL: 'gemini-3.6-flash' },
    '0 */12 * * *',
  );

  assert.equal(db.rows.size, ARTICLES.length);
});

test('scheduled runs append fresh items without clearing existing ones', async (t) => {
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
      score: 80,
    },
  ]);
  mockSearch(t);

  await runScheduled(
    { DB: db, GEMINI_API_KEY: 'secret-key', GEMINI_MODEL: 'gemini-3.6-flash' },
    '0 */12 * * *',
  );

  assert.equal(db.rows.size, ARTICLES.length + 1);
});

test('scheduled cleanup removes published items every 7 days', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Published story',
      url: 'https://example.com/published',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'published',
      scheduled_at: '2026-11-01T10:00:00.000Z',
      score: 60,
    },
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Scheduled story',
      url: 'https://example.com/scheduled',
      published_at: '2024-01-02T00:00:00.000Z',
      status: 'scheduled',
      scheduled_at: '2026-11-02T10:00:00.000Z',
      score: 70,
    },
  ]);

  await runScheduled({ DB: db }, '0 0 */7 * *');

  assert.equal(db.rows.size, 1);
  assert.ok(!db.rows.has('https://example.com/published'));
  assert.ok(db.rows.has('https://example.com/scheduled'));
});
