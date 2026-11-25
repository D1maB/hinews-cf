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
    { provider: 'google', apiKey: 'g-key', model: 'gemini-2.5-flash' },
  );

  assert.deepEqual(
    getScoreConfig({
      AI_PROVIDER: 'openrouter',
      OPENROUTER_API_KEY: 'o-key',
      OPENROUTER_MODEL: 'openai/gpt-4.1-mini',
    }),
    { provider: 'openrouter', apiKey: 'o-key', model: 'openai/gpt-4.1-mini' },
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

test('scoreItems returns empty map when AI is not configured', async (t) => {
  t.mock.method(console, 'error', () => {});
  const scores = await scoreItems({} as never, [
    { title: 'A', url: 'https://example.com/a' },
  ]);
  assert.equal(scores.size, 0);
});
