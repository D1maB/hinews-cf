import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_FEEDS } from '../src/feeds.ts';
import {
  DEFAULT_NEWS_ITEM_COUNT,
  getSearchOptions,
  parseSearchItems,
  searchNews,
} from '../src/search.ts';

function article(overrides: Record<string, unknown> = {}) {
  return {
    title: 'RTX 5090 review',
    description: 'A deep dive into the new flagship GPU.',
    source: "Tom's Hardware",
    url: 'https://www.tomshardware.com/reviews/rtx-5090',
    score: 82,
    ...overrides,
  };
}

function geminiResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      candidates: [{ content: { parts: [{ text: content }] } }],
    }),
    { status: 200 },
  );
}

test('getSearchOptions rejects empty configuration', () => {
  assert.throws(
    () => getSearchOptions({ GEMINI_BASE_URL: '   ' }),
    /GEMINI_BASE_URL/,
  );
  assert.throws(
    () => getSearchOptions({ GEMINI_MODEL: '   ' }),
    /GEMINI_MODEL/,
  );
});

test('getSearchOptions applies the Gemini defaults', () => {
  assert.deepEqual(getSearchOptions({}), {
    baseUrl: 'https://generativelanguage.googleapis.com',
    model: 'gemini-3.6-flash',
    itemCount: DEFAULT_NEWS_ITEM_COUNT,
  });

  assert.deepEqual(
    getSearchOptions({
      GEMINI_BASE_URL: 'http://localhost:8080',
      GEMINI_MODEL: 'gemini-3-flash',
      GEMINI_API_KEY: '  secret-key  ',
      NEWS_ITEM_COUNT: '35',
    }),
    {
      baseUrl: 'http://localhost:8080',
      model: 'gemini-3-flash',
      itemCount: 35,
      apiKey: 'secret-key',
    },
  );
});

test('getSearchOptions rejects an invalid item count', () => {
  assert.throws(
    () => getSearchOptions({ NEWS_ITEM_COUNT: '0' }),
    /NEWS_ITEM_COUNT/,
  );
  assert.throws(
    () => getSearchOptions({ NEWS_ITEM_COUNT: 'ten' }),
    /NEWS_ITEM_COUNT/,
  );
});

test('searchNews sends the configured prompt to Gemini and parses results', async (t) => {
  let requestUrl = '';
  let requestBody: Record<string, unknown> = {};
  let apiKey: string | null = null;

  t.mock.method(
    globalThis,
    'fetch',
    async (input: RequestInfo | URL, init?: RequestInit) => {
      requestUrl = String(input);
      requestBody = JSON.parse(String(init?.body)) as Record<string, unknown>;
      apiKey = new Headers(init?.headers).get('x-goog-api-key');
      return geminiResponse(JSON.stringify([article()]));
    },
  );

  const items = await searchNews(
    {
      GEMINI_API_KEY: 'secret-key',
      GEMINI_MODEL: 'models/gemini-2.5-flash',
      NEWS_ITEM_COUNT: '5',
    },
    DEFAULT_FEEDS,
  );

  assert.match(
    requestUrl,
    /\/v1beta\/models\/gemini-2\.5-flash:generateContent$/,
  );
  assert.equal(apiKey, 'secret-key');
  assert.ok(Array.isArray(requestBody.contents));

  const prompt = JSON.stringify(requestBody.contents);
  assert.ok(prompt.includes('exactly 5 articles'));
  assert.ok(prompt.includes("Tom's Hardware"));

  assert.deepEqual(items, [
    {
      title: 'RTX 5090 review',
      description: 'A deep dive into the new flagship GPU.',
      source: "Tom's Hardware",
      url: 'https://www.tomshardware.com/reviews/rtx-5090',
      score: 82,
    },
  ]);
});

test('searchNews returns an empty list without an API key', async (t) => {
  const fetchMock = t.mock.method(globalThis, 'fetch', async () => {
    throw new Error('fetch should not be called');
  });

  const items = await searchNews({}, DEFAULT_FEEDS);

  assert.deepEqual(items, []);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test('searchNews returns an empty list when Gemini fails', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('unavailable', { status: 503 }),
  );

  const items = await searchNews(
    { GEMINI_API_KEY: 'secret-key' },
    DEFAULT_FEEDS,
  );

  assert.deepEqual(items, []);
});

test('parseSearchItems clamps scores and drops invalid rows', () => {
  const items = parseSearchItems(
    JSON.stringify([
      article({ score: 140 }),
      article({
        title: 'Second story',
        url: 'https://wccftech.com/story',
        score: -5,
      }),
      article({
        title: 'Repeated story',
        url: 'https://www.tomshardware.com/reviews/rtx-5090',
      }),
      article({
        title: 'Unknown site',
        source: 'Example News',
        url: 'https://example.com/story',
      }),
      article({ title: '', url: 'https://www.pcgamer.com/story' }),
      article({ title: 'Bad URL', url: 'javascript:alert(1)' }),
    ]),
    DEFAULT_FEEDS,
  );

  assert.equal(items.length, 3);
  assert.equal(items[0]?.score, 100);
  assert.equal(items[1]?.score, 1);
  assert.equal(items[2]?.score, 82);
});

test('parseSearchItems limits results to the configured count', () => {
  const items = parseSearchItems(
    JSON.stringify([
      article(),
      article({ title: 'Second story', url: 'https://wccftech.com/story' }),
    ]),
    DEFAULT_FEEDS,
    1,
  );

  assert.equal(items.length, 1);
});

test('parseSearchItems accepts fenced JSON and object wrappers', () => {
  const fenced = parseSearchItems(
    '```json\n' + JSON.stringify([article()]) + '\n```',
    DEFAULT_FEEDS,
  );
  assert.equal(fenced.length, 1);

  const wrapped = parseSearchItems(
    JSON.stringify({ articles: [article()] }),
    DEFAULT_FEEDS,
  );
  assert.equal(wrapped.length, 1);
});
