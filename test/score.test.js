import assert from 'node:assert/strict';
import test from 'node:test';

import { getScoreOptions, scoreTitle } from '../src/score.js';

test('scoreTitle returns the keyword based score when scoring is disabled', async () => {
  assert.equal(await scoreTitle('RTX 5090 review & benchmarks', { enabled: false }), 70);
});

test('scoreTitle scores through the configured AI model', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ choices: [{ message: { content: '{"score": 82}' } }] }), { status: 200 }));

  const score = await scoreTitle('RTX 5090 graphics card review', { enabled: true, baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' });

  assert.equal(score, 82);
});

test('scoreTitle falls back to the keyword score when the AI call fails', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('unavailable', { status: 503 }));

  const score = await scoreTitle('RTX 5090 review & benchmarks', { enabled: true, baseUrl: 'http://localhost:11434/v1', model: 'llama3.2' });

  assert.equal(score, 70);
});

test('getScoreOptions reads the AI scoring configuration from the environment', () => {
  assert.deepEqual(getScoreOptions({}), { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', enabled: true });

  assert.deepEqual(
    getScoreOptions({ SCORE_BASE_URL: 'http://localhost:11434/v1', SCORE_MODEL: 'llama3.2' }),
    { baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', enabled: true },
  );

  assert.deepEqual(
    getScoreOptions({ SCORE_ENABLED: 'false' }),
    { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', enabled: false },
  );
});
