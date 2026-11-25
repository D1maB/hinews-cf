import assert from 'node:assert/strict';
import test from 'node:test';

import { DEFAULT_FEEDS, getFeeds, truncateToSentence } from '../src/feeds.ts';

test('returns the built-in sources when no override is configured', () => {
  assert.deepEqual(getFeeds({}), DEFAULT_FEEDS);
});

test('parses a JSON source list from the environment', () => {
  const feeds = getFeeds({
    FEEDS: JSON.stringify([
      { id: 'example', name: 'Example', url: 'https://example.com/feed' },
    ]),
  });

  assert.deepEqual(feeds, [
    { id: 'example', name: 'Example', url: 'https://example.com/feed' },
  ]);
});

test('falls back to the built-in sources for invalid overrides', () => {
  assert.deepEqual(getFeeds({ FEEDS: 'not json' }), DEFAULT_FEEDS);
  assert.deepEqual(getFeeds({ FEEDS: '[{"id":"broken"}]' }), DEFAULT_FEEDS);
  assert.deepEqual(getFeeds({ FEEDS: '[]' }), DEFAULT_FEEDS);
});

test('truncateToSentence cuts at the last sentence boundary', () => {
  assert.equal(
    truncateToSentence('First sentence. Second sentence is too long.', 30),
    'First sentence.',
  );
  assert.equal(truncateToSentence('Short text.', 30), 'Short text.');
  assert.equal(truncateToSentence('', 30), '');
});

test('rewrites feed URLs to local files when LOCAL_FEEDS_URL is set', () => {
  const feeds = getFeeds({
    FEEDS: JSON.stringify([
      { id: 'example', name: 'Example', url: 'https://example.com/feed' },
    ]),
    LOCAL_FEEDS_URL: 'http://feeds:8080/',
  });

  assert.deepEqual(feeds, [
    {
      id: 'example',
      name: 'Example',
      url: 'http://feeds:8080/example.xml',
    },
  ]);
});
