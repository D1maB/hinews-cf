import assert from 'node:assert/strict';
import test from 'node:test';

import { getScoreConfig, scoreItems } from '../src/score.ts';

test('getScoreConfig reads provider config and supports gemini alias', () => {
  assert.deepEqual(
    getScoreConfig({
      AI_PROVIDER: 'gemini',
      GEMINI_API_KEY: 'g-key',
      GEMINI_MODEL: 'gemini-2.5-flash',
    }),
    {
      provider: 'google',
      apiKey: 'g-key',
      model: 'gemini-2.5-flash',
      batchSize: 20,
      timeoutMs: 30000,
    },
  );

  assert.deepEqual(
    getScoreConfig({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'o-key',
      OPENROUTER_MODEL: 'openai/gpt-4.1-mini',
      AI_SCORE_BATCH_SIZE: '5',
    }),
    {
      provider: 'openrouter',
      apiKey: 'o-key',
      model: 'openai/gpt-4.1-mini',
      batchSize: 5,
      timeoutMs: 30000,
    },
  );
});

test('scoreItems returns scores from Gemini response', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () =>
      new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify([
                      { url: 'https://example.com/a', score: 91 },
                      { url: 'https://example.com/b', score: 42 },
                    ]),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      ),
  );

  const scores = await scoreItems(
    { AI_PROVIDER: 'google', GEMINI_API_KEY: 'k', GEMINI_MODEL: 'm' } as never,
    [
      { title: 'A', url: 'https://example.com/a' },
      { title: 'B', url: 'https://example.com/b' },
    ],
  );

  assert.equal(scores.get('https://example.com/a'), 91);
  assert.equal(scores.get('https://example.com/b'), 42);
});

test('scoreItems throws when AI is not configured', async () => {
  await assert.rejects(
    () =>
      scoreItems({} as never, [{ title: 'A', url: 'https://example.com/a' }]),
    /GEMINI_API_KEY/,
  );
});

test('scoreItems batches requests by AI_SCORE_BATCH_SIZE', async (t) => {
  let calls = 0;
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as {
        contents: Array<{ parts: Array<{ text: string }> }>;
      };
      const prompt = body.contents[0]?.parts[0]?.text ?? '';
      const urls = [...prompt.matchAll(/URL: (https?:\/\/\S+)/g)].map(
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
                      urls.map((url) => ({ url, score: 50 })),
                    ),
                  },
                ],
              },
            },
          ],
        }),
        { status: 200 },
      );
    },
  );

  const scores = await scoreItems(
    {
      AI_PROVIDER: 'google',
      GEMINI_API_KEY: 'k',
      GEMINI_MODEL: 'm',
      AI_SCORE_BATCH_SIZE: '2',
    } as never,
    [
      { title: 'A', url: 'https://example.com/a' },
      { title: 'B', url: 'https://example.com/b' },
      { title: 'C', url: 'https://example.com/c' },
    ],
  );

  assert.equal(calls, 2);
  assert.equal(scores.size, 3);
});
