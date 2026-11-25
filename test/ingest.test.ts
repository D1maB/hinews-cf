import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import { ingestNews } from '../src/ingest.ts';
import { createFakeDb } from './fake-db.ts';
import type { Env } from '../src/types.ts';

const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>PC Hardware News</title>
    <item>
      <title>RTX 5090 review</title>
      <link>https://wccftech.com/reviews/rtx-5090</link>
      <description>A deep dive into the new flagship GPU.</description>
      <pubDate>${new Date(Date.now() - 60 * 60 * 1000).toUTCString()}</pubDate>
    </item>
    <item>
      <title>Ryzen 9950X benchmarks</title>
      <link>https://www.techpowerup.com/review/ryzen-9950x</link>
      <description>The new CPU in our test bench.</description>
      <pubDate>${new Date(Date.now() - 90 * 60 * 1000).toUTCString()}</pubDate>
    </item>
  </channel>
</rss>`;

function mockRssFetch(t: TestContext, body = RSS_XML, status = 200): void {
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      const urls = [...body.matchAll(/<link>([^<]+)<\/link>/g)].map(
        (m) => m[1],
      );
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify(
                      urls.map((u) => ({ url: u, score: 80 })),
                    ),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(body, {
      status,
      headers: { 'content-type': 'application/rss+xml' },
    });
  });
}

function envWith(db: Env['DB']): Env {
  return {
    DB: db,
    AI_PROVIDER: 'google',
    GEMINI_API_KEY: 'test-key',
    GEMINI_MODEL: 'gemini-2.5-flash',
  };
}

test('stores RSS feed items with AI-scored values', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockRssFetch(t);
  const db = createFakeDb();

  const { inserted } = await ingestNews(envWith(db));

  assert.equal(inserted, 2);
  assert.equal(db.rows.size, 2);

  const row = db.rows.get('https://wccftech.com/reviews/rtx-5090');
  assert.equal(row?.feed_id, 'wccftech');
  assert.equal(row?.feed_name, 'Wccftech');
  assert.equal(row?.score, 80);
  assert.equal(row?.description, 'A deep dive into the new flagship GPU.');
  assert.equal(row?.status, 'scheduled');
});

test('stores the same news URL only once', async (t) => {
  t.mock.method(console, 'log', () => {});
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
    <item>
      <title>RTX 5090 review</title>
      <link>https://wccftech.com/reviews/rtx-5090</link>
      <description>A deep dive into the new flagship GPU.</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
    <item>
      <title>Duplicate coverage</title>
      <link>https://wccftech.com/reviews/rtx-5090</link>
      <description>Same link, different headline.</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel></rss>`;
  mockRssFetch(t, xml);
  const db = createFakeDb();

  const { inserted } = await ingestNews(envWith(db));

  assert.equal(inserted, 1);
  assert.equal(db.rows.size, 1);
});

test('does not store the same news twice across runs', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockRssFetch(t);
  const db = createFakeDb();
  const env = envWith(db);

  await ingestNews(env);
  const { inserted } = await ingestNews(env);

  assert.equal(inserted, 0);
  assert.equal(db.rows.size, 2);
});

test('stores nothing when RSS feeds fail to respond', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'warn', () => {});
  mockRssFetch(t, 'unavailable', 503);
  const db = createFakeDb();

  const { inserted } = await ingestNews(envWith(db));

  assert.equal(inserted, 0);
  assert.equal(db.rows.size, 0);
});

test('schedules ingested items within one 12 hour window', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockRssFetch(t);
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
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
    <item>
      <title>RTX 5090 review</title>
      <link>https://wccftech.com/reviews/rtx-5090</link>
      <description>A deep dive into the new flagship GPU.</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
    <item>
      <title>Sponsored: Ryzen 9950X benchmarks</title>
      <link>https://www.techpowerup.com/review/ryzen-9950x</link>
      <description>The new CPU in our test bench.</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel></rss>`;
  mockRssFetch(t, xml);
  const db = createFakeDb();

  const { inserted } = await ingestNews(envWith(db));

  assert.equal(inserted, 1);
  assert.equal(db.rows.size, 1);
});

test('scores new items with configured AI provider before scheduling', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', () => {});
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      {
                        url: 'https://wccftech.com/reviews/rtx-5090',
                        score: 95,
                      },
                      {
                        url: 'https://www.techpowerup.com/review/ryzen-9950x',
                        score: 77,
                      },
                    ]),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(RSS_XML, { status: 200 });
  });
  const db = createFakeDb();

  await ingestNews({
    DB: db,
    AI_PROVIDER: 'google',
    GEMINI_API_KEY: 'k',
    GEMINI_MODEL: 'gemini-2.5-flash',
  });

  assert.equal(db.rows.get('https://wccftech.com/reviews/rtx-5090')?.score, 95);
  assert.equal(
    db.rows.get('https://www.techpowerup.com/review/ryzen-9950x')?.score,
    77,
  );
  assert.equal(
    db.rows.get('https://wccftech.com/reviews/rtx-5090')?.status,
    'scheduled',
  );
});

test('does not save items when AI scoring fails', async (t) => {
  const errors: string[] = [];
  t.mock.method(console, 'log', () => {});
  t.mock.method(console, 'error', (...args: unknown[]) => {
    errors.push(args.map(String).join(' '));
  });
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response('unavailable', { status: 503 });
    }
    return new Response(RSS_XML, { status: 200 });
  });
  const db = createFakeDb();

  const { inserted } = await ingestNews({
    DB: db,
    AI_PROVIDER: 'google',
    GEMINI_API_KEY: 'k',
    GEMINI_MODEL: 'gemini-2.5-flash',
  });

  assert.equal(inserted, 0);
  assert.equal(db.rows.size, 0);
  assert.ok(errors.some((line) => line.includes("Can't score items")));
});

test('skips deals and promo items', async (t) => {
  t.mock.method(console, 'log', () => {});
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
  <rss version="2.0"><channel>
    <item>
      <title>RTX 5090 review</title>
      <link>https://wccftech.com/reviews/rtx-5090</link>
      <description>A deep dive into the new flagship GPU.</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
    <item>
      <title>Best GPU deals this week</title>
      <link>https://www.techpowerup.com/review/gpu-deals</link>
      <description>Discounted cards.</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel></rss>`;
  mockRssFetch(t, xml);
  const db = createFakeDb();

  const { inserted } = await ingestNews(envWith(db));

  assert.equal(inserted, 1);
  assert.equal(db.rows.size, 1);
});

test('skips items below MIN_SCORE_THRESHOLD', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(globalThis, 'fetch', async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('generativelanguage.googleapis.com')) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      {
                        url: 'https://wccftech.com/reviews/rtx-5090',
                        score: 90,
                      },
                      {
                        url: 'https://www.techpowerup.com/review/ryzen-9950x',
                        score: 40,
                      },
                    ]),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    }
    return new Response(RSS_XML, { status: 200 });
  });
  const db = createFakeDb();

  const { inserted } = await ingestNews({
    DB: db,
    AI_PROVIDER: 'google',
    GEMINI_API_KEY: 'k',
    GEMINI_MODEL: 'gemini-2.5-flash',
    MIN_SCORE_THRESHOLD: '70',
  });

  assert.equal(inserted, 1);
  assert.equal(db.rows.size, 1);
  assert.ok(db.rows.has('https://wccftech.com/reviews/rtx-5090'));
  assert.ok(!db.rows.has('https://www.techpowerup.com/review/ryzen-9950x'));
});
