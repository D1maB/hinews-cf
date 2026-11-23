import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { ingestNews } from '../src/ingest.ts';
import { createFakeDb } from './fake-db.ts';
import type { Env } from '../src/types.ts';

interface Article {
  title: string;
  description: string;
  source: string;
  url: string;
  score: number;
}

const ARTICLES: Article[] = [
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

function envWith(db: Env['DB']): Env {
  return { DB: db, GEMINI_API_KEY: 'secret-key' };
}

test('stores scored AI search results with their sources', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockSearch(t);
  const db = createFakeDb();

  const { inserted } = await ingestNews(envWith(db));

  assert.equal(inserted, 2);
  assert.equal(db.rows.size, 2);

  const row = db.rows.get('https://www.tomshardware.com/reviews/rtx-5090');
  assert.equal(row?.feed_id, 'tomshardware');
  assert.equal(row?.feed_name, "Tom's Hardware");
  assert.equal(row?.score, 90);
  assert.equal(row?.description, 'A deep dive into the new flagship GPU.');
  assert.equal(row?.status, 'scheduled');
});

test('stores the same news URL only once', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockSearch(t, [
    ...ARTICLES,
    {
      title: 'Duplicate coverage',
      description: 'Same link, different headline.',
      source: 'TechPowerUp',
      url: 'https://www.techpowerup.com/review/ryzen-9950x',
      score: 70,
    },
  ]);
  const db = createFakeDb();

  const { inserted } = await ingestNews(envWith(db));

  assert.equal(inserted, 2);
  assert.equal(db.rows.size, 2);
});

test('does not store the same news twice across runs', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockSearch(t);
  const db = createFakeDb();
  const env = envWith(db);

  await ingestNews(env);
  const { inserted } = await ingestNews(env);

  assert.equal(inserted, 0);
  assert.equal(db.rows.size, 2);
});

test('stores nothing when the AI search fails', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('unavailable', { status: 503 }),
  );
  const db = createFakeDb();

  const { inserted } = await ingestNews(envWith(db));

  assert.equal(inserted, 0);
  assert.equal(db.rows.size, 0);
});

test('schedules ingested items within one 12 hour window', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockSearch(t);
  const db = createFakeDb();

  await ingestNews(envWith(db));

  const times = [...db.rows.values()].map((row) =>
    new Date(String(row.scheduled_at)).getTime(),
  );
  assert.equal(times.length, 2);
  const spread = Math.max(...times) - Math.min(...times);
  assert.ok(spread < 12 * 60 * 60 * 1000);
});

test('skips sponsored results', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockSearch(t, [
    ARTICLES[0],
    {
      ...ARTICLES[1],
      title: 'Sponsored: Ryzen 9950X benchmarks',
    },
  ]);
  const db = createFakeDb();

  const { inserted } = await ingestNews(envWith(db));

  assert.equal(inserted, 1);
  assert.equal(db.rows.size, 1);
});
