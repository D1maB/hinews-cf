import assert from 'node:assert/strict';
import test from 'node:test';

import { getScoreOptions, scoreTitle } from '../src/score.ts';

function scoreResponse(content: string): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content } }],
    }),
    { status: 200 },
  );
}

test('getScoreOptions rejects empty configuration', () => {
  assert.throws(
    () => getScoreOptions({ SCORE_BASE_URL: '   ' }),
    /SCORE_BASE_URL/,
  );
});

test('getScoreOptions reads the AI scoring configuration from the environment', () => {
  assert.deepEqual(getScoreOptions({}), {
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
  });

  assert.deepEqual(
    getScoreOptions({
      SCORE_BASE_URL: 'http://localhost:11434',
      SCORE_MODEL: 'llama3.2:1b',
    }),
    { baseUrl: 'http://localhost:11434', model: 'llama3.2:1b' },
  );
});

test('getScoreOptions includes a trimmed API key when configured', () => {
  assert.deepEqual(
    getScoreOptions({
      SCORE_API_KEY: '  secret-key  ',
    }),
    {
      baseUrl: 'https://api.openai.com',
      model: 'gpt-4o-mini',
      apiKey: 'secret-key',
    },
  );
});

test('scoreTitle scores through the configured AI model', async (t) => {
  t.mock.method(globalThis, 'fetch', async () =>
    scoreResponse('{"score": 82}'),
  );

  const score = await scoreTitle('RTX 5090 graphics card review', {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:1b',
  });

  assert.equal(score, 82);
});

test('scoreTitle sends the API key when configured', async (t) => {
  let authorization: string | null = null;
  t.mock.method(
    globalThis,
    'fetch',
    async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorization = new Headers(init?.headers).get('authorization');
      return scoreResponse('{"score": 75}');
    },
  );

  const score = await scoreTitle('RTX 5090 graphics card review', {
    baseUrl: 'https://api.openai.com',
    model: 'gpt-4o-mini',
    apiKey: 'secret-key',
  });

  assert.equal(score, 75);
  assert.equal(authorization, 'Bearer secret-key');
});

test('scoreTitle returns null when the AI call fails', async (t) => {
  t.mock.method(
    globalThis,
    'fetch',
    async () => new Response('unavailable', { status: 503 }),
  );

  const score = await scoreTitle('RTX 5090 graphics card review', {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:1b',
  });

  assert.equal(score, null);
});

test('scoreTitle returns null when the response is not valid JSON', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => scoreResponse('not json'));

  const score = await scoreTitle('RTX 5090 graphics card review', {
    baseUrl: 'http://localhost:11434',
    model: 'llama3.2:1b',
  });

  assert.equal(score, null);
});

test('scoreTitle returns null when no AI provider is configured', async () => {
  const score = await scoreTitle('RTX 5090 graphics card review');

  assert.equal(score, null);
});
