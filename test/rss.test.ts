import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';

import {
  DEFAULT_FEED_ITEM_LIMIT,
  fetchRssItems,
  parseFeedItemLimit,
  parseRssFeed,
} from '../src/rss.ts';
import type { FeedConfig, SearchItem } from '../src/types.ts';

function isoMinutesAgo(minutes: number): string {
  const date = new Date(
    Math.floor((Date.now() - minutes * 60_000) / 1000) * 1000,
  );
  return date.toISOString();
}

const TWO_HOURS_AGO = isoMinutesAgo(120);
const RSS_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>PC Hardware News</title>
    <item>
      <title>RTX 5090 review</title>
      <link>https://example.com/reviews/rtx-5090</link>
      <description>A deep dive into the new flagship GPU.</description>
      <pubDate>${new Date(TWO_HOURS_AGO).toUTCString()}</pubDate>
    </item>
    <item>
      <title>Ryzen 9950X benchmarks</title>
      <link>https://example.com/reviews/ryzen-9950x</link>
      <description>We put the new CPU through its paces.</description>
      <pubDate>${new Date(Date.now() - 30 * 60 * 1000).toUTCString()}</pubDate>
    </item>
  </channel>
</rss>`;

const SOURCES: FeedConfig[] = [
  { id: 'example', name: 'Example', url: 'https://example.com/feed' },
];

function mockFetch(t: TestContext, body: string, status = 200): void {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(body, {
        status,
        headers: { 'content-type': 'application/rss+xml' },
      }),
  );
}

test('parseRssFeed extracts title, link, description, and publish date', () => {
  const items = parseRssFeed(RSS_XML);

  assert.equal(items.length, 2);
  assert.equal(items[0]?.title, 'RTX 5090 review');
  assert.equal(items[0]?.url, 'https://example.com/reviews/rtx-5090');
  assert.equal(items[0]?.description, 'A deep dive into the new flagship GPU.');
  assert.equal(items[0]?.publishedAt, TWO_HOURS_AGO);
});

test('parseRssFeed strips HTML markup from descriptions and skips incomplete entries', () => {
  const xml = `<?xml version="1.0"?>
  <rss version="2.0"><channel>
    <item>
      <title>HTML description</title>
      <link>https://example.com/html</link>
      <description><![CDATA[<p>First part.</p> Second part.]]></description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
    <item>
      <title>No link</title>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel></rss>`;

  const items = parseRssFeed(xml);

  assert.equal(items.length, 1);
  assert.match(items[0]?.description ?? '', /First part\./);
});

test('parseRssFeed parses JSON feed items', () => {
  const json = JSON.stringify({
    version: 'https://jsonfeed.org/version/1.1',
    items: [
      {
        title: 'JSON story',
        url: 'https://example.com/json-story',
        content_text: 'A JSON feed item.',
        date_published: TWO_HOURS_AGO,
      },
    ],
  });

  const items = parseRssFeed(json);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, 'JSON story');
  assert.equal(items[0]?.url, 'https://example.com/json-story');
  assert.equal(items[0]?.description, 'A JSON feed item.');
});

test('fetchRssItems turns feed entries into news items with score 0', async (t) => {
  t.mock.method(console, 'warn', () => {});
  mockFetch(t, RSS_XML);

  const items = await fetchRssItems(SOURCES);

  assert.equal(items.length, 2);
  const first: SearchItem = items[0] as SearchItem;
  assert.equal(first.source, 'Example');
  assert.equal(first.url, 'https://example.com/reviews/rtx-5090');
  assert.equal(first.score, 0);
  assert.equal(first.publishedAt, TWO_HOURS_AGO);
});

test('fetchRssItems skips feeds that fail to respond', async (t) => {
  t.mock.method(console, 'warn', () => {});
  mockFetch(t, '<rss version="2.0"></rss>', 503);

  const items = await fetchRssItems(SOURCES);

  assert.deepEqual(items, []);
});

test('parseFeedItemLimit defaults and validates values', () => {
  assert.equal(parseFeedItemLimit(undefined), DEFAULT_FEED_ITEM_LIMIT);
  assert.equal(parseFeedItemLimit(''), DEFAULT_FEED_ITEM_LIMIT);
  assert.equal(parseFeedItemLimit('5'), 5);
  assert.throws(() => parseFeedItemLimit('0'), /FEED_ITEM_LIMIT/);
  assert.throws(() => parseFeedItemLimit('nope'), /FEED_ITEM_LIMIT/);
});

test('fetchRssItems limits items per feed', async (t) => {
  t.mock.method(console, 'log', () => {});
  mockFetch(t, RSS_XML);

  const items = await fetchRssItems(SOURCES, 1);

  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, 'RTX 5090 review');
});

test('parseRssFeed removes trailing read-more boilerplate from descriptions', () => {
  const xml = `<?xml version="1.0"?>
  <rss version="2.0"><channel>
    <item>
      <title>Story</title>
      <link>https://example.com/story</link>
      <description>Big launch happened. Read Entire Article</description>
      <pubDate>${new Date().toUTCString()}</pubDate>
    </item>
  </channel></rss>`;

  const items = parseRssFeed(xml);

  assert.equal(items[0]?.description, 'Big launch happened.');
});
