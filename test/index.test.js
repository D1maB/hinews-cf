import assert from 'node:assert/strict';
import test from 'node:test';

import worker from '../src/index.js';

const TEST_REQUEST = new Request('https://example.com/');

test('responds with a plain-text greeting', async (t) => {
  t.mock.method(console, 'log', () => {});

  const response = await worker.fetch(TEST_REQUEST);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'text/plain;charset=UTF-8');
  assert.equal(await response.text(), 'Hello World');
});

test('logs the greeting to the console', async (t) => {
  const log = t.mock.method(console, 'log', () => {});

  await worker.fetch(TEST_REQUEST);

  assert.equal(log.mock.callCount(), 1);
  assert.deepEqual(log.mock.calls[0].arguments, ['Hello World']);
});
