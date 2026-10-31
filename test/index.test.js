import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { FEEDS } from '../src/index.js';

const REQUEST = new Request('https://example.com/');

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Example feed</title>
    <item>
      <title><![CDATA[RTX 5090 review &amp; benchmarks]]></title>
      <link>https://example.com/rtx-5090?a=1&amp;b=2</link>
      <pubDate>Mon, 01 Jan 2024 12:00:00 GMT</pubDate>
    </item>
  </channel>
</rss>`;

const LOCAL_ENV = {
  ASSETS: {
    fetch: async (url) => {
      assert.match(url.pathname, /^\/[a-z0-9]+\.xml$/);
      return new Response(RSS);
    },
  },
};

test('renders news from local storage', async (t) => {
  const remoteFetch = t.mock.method(globalThis, 'fetch', () => {
    throw new Error('remote fetch should not run when local assets are available');
  });

  const response = await worker.fetch(REQUEST, LOCAL_ENV);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(remoteFetch.mock.callCount(), 0);
  assert.match(html, /Tom&#39;s Hardware/);
  assert.match(html, /KitGuru/);
  assert.match(html, /RTX 5090 review &amp; benchmarks/);
  assert.match(html, /https:\/\/example\.com\/rtx-5090\?a=1&amp;b=2/);
});

test('fetches remote feeds when no local assets binding exists', async (t) => {
  const requestedUrls = [];
  t.mock.method(globalThis, 'fetch', async (url) => {
    requestedUrls.push(url);
    return new Response(RSS);
  });

  await worker.fetch(REQUEST, {});

  assert.deepEqual(requestedUrls.sort(), FEEDS.map((feed) => feed.url).sort());
});

test('keeps rendering when a local feed is missing', async (t) => {
  const env = {
    ASSETS: {
      fetch: async (url) =>
        url.pathname === '/techpowerup.xml'
          ? new Response('missing', { status: 404 })
          : new Response(RSS),
    },
  };

  const html = await (await worker.fetch(REQUEST, env)).text();

  assert.match(html, /TechPowerUp/);
  assert.match(html, /Local feed techpowerup\.xml not found \(HTTP 404\)/);
  assert.match(html, /RTX 5090 review/);
});
