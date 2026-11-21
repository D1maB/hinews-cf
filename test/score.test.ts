import assert from 'node:assert/strict';
import test from 'node:test';

import { getScoreOptions, scoreTitle } from '../src/score.ts';

test('getScoreOptions reads the AI scoring configuration from the environment', () => {
  assert.deepEqual(getScoreOptions({}), { baseUrl: 'https://api.openai.com', model: 'gpt-4o-mini' });

  assert.deepEqual(
    getScoreOptions({ SCORE_BASE_URL: 'http://localhost:11434', SCORE_MODEL: 'llama3.2:1b' }),
    { baseUrl: 'http://localhost:11434', model: 'llama3.2:1b' },
  );
});

test('scoreTitle scores through the configured AI model', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"score": 82}' } }] }), { status: 200 }));

  const score = await scoreTitle('RTX 5090 graphics card review', { baseUrl: 'http://localhost:11434', model: 'llama3.2:1b' });

  assert.equal(score, 82);
});

test('scoreTitle returns null when the AI call fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));

  const score = await scoreTitle('RTX 5090 graphics card review', { baseUrl: 'http://localhost:11434', model: 'llama3.2:1b' });

  assert.equal(score, null);
});

test('scoreTitle returns null when no AI provider is configured', async () => {
  const score = await scoreTitle('RTX 5090 graphics card review');

  assert.equal(score, null);
});
