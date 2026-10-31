import assert from 'node:assert/strict';
import test from 'node:test';

import { FEEDS, loadFeeds, parseRssItems } from '../src/feeds.js';

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example feed</title>
    <item>
      <title><![CDATA[RTX 5090 review &amp; benchmarks]]></title>
      <link>https://example.com/rtx-5090?a=1&amp;b=2</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Ryzen 9950X is &#39;great&#39;</title>
      <link>https://example.com/ryzen-9950x#comments</link>
      <pubDate>Tue, 02 Jan 2024 12:00:00 GMT</pubDate>
    </item>
    <item>
      <title>Missing link</title>
    </item>
  </channel>
</rss>`;

/**
 * @param {string} feedId
 * @returns {string}
 */
function rssFor(feedId) {
  return RSS.replaceAll('https://example.com/', `https://example.com/${feedId}/`);
}

test('parses RSS items, decoding entities and dropping unsafe rows', () => {
  const items = parseRssItems(RSS);

  assert.deepEqual(items, [
    {
      title: 'RTX 5090 review & benchmarks',
      link: 'https://example.com/rtx-5090?a=1&b=2',
      publishedAt: 'Mon, 01 Jan 2024 12:00:00 GMT',
    },
    {
      title: "Ryzen 9950X is 'great'",
      link: 'https://example.com/ryzen-9950x',
      publishedAt: 'Tue, 02 Jan 2024 12:00:00 GMT',
    },
  ]);
});

test('loads every feed from local storage', async (t) => {
  const remoteFetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('remote fetch should not run when local assets are available');
  });

  const env = {
    ASSETS: {
      fetch: async (url) => {
        assert.match(url.pathname, /^\/[a-z0-9]+\.xml$/);
        return new Response(rssFor(url.pathname.slice(1, -4)));
      },
    },
  };

  const feeds = await loadFeeds(env);

  assert.equal(remoteFetch.mock.callCount(), 0);
  assert.equal(feeds.length, FEEDS.length);
  assert.ok(feeds.every((feed) => feed.items.length === 2));
});

test('fetches remote feeds when no assets binding exists', async (t) => {
  const requestedUrls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requestedUrls.push(url);
    return new Response(RSS);
  });

  await loadFeeds({});

  assert.deepEqual(requestedUrls.sort(), FEEDS.map((feed) => feed.url).sort());
});

test('keeps loading other feeds when a local feed is missing', async () => {
  const env = {
    ASSETS: {
      fetch: async (url) =>
        url.pathname === '/techpowerup.xml'
          ? new Response('missing', { status: 404 })
          : new Response(RSS),
    },
  };

  const feeds = await loadFeeds(env);
  const techPowerUp = feeds.find((feed) => feed.id === 'techpowerup');

  assert.match(techPowerUp.error, /Local feed techpowerup\.xml not found \(HTTP 404\)/);
  assert.ok(feeds.filter((feed) => feed.id !== 'techpowerup').every((feed) => !feed.error));
});
