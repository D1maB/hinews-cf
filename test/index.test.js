import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

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

test('renders news from every feed', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => new Response(RSS));

  const response = await worker.fetch(REQUEST);
  const html = await response.text();

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /^text\/html/);
  assert.equal(fetchMock.mock.callCount(), 5);
  assert.match(html, /Tom&#39;s Hardware/);
  assert.match(html, /KitGuru/);
  assert.match(html, /RTX 5090 review &amp; benchmarks/);
  assert.match(html, /https:\/\/example\.com\/rtx-5090\?a=1&amp;b=2/);
});

test('keeps rendering when a feed fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async (url) =>
    url.includes('techpowerup')
      ? new Response('unavailable', { status: 503, statusText: 'Service Unavailable' })
      : new Response(RSS),
  );

  const html = await (await worker.fetch(REQUEST)).text();

  assert.match(html, /TechPowerUp/);
  assert.match(html, /HTTP 503 Service Unavailable/);
  assert.match(html, /RTX 5090 review/);
});
