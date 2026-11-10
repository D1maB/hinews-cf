import assert from 'node:assert/strict';
import test from 'node:test';

import { backfillScores, clearItems } from '../src/store.js';
import { createFakeDb } from './fake-db.js';

test('schedules unscheduled items across one 12 hour window from the last scheduled time', async (t) => {
  t.mock.method(console, 'log', () => {});
  t.mock.method(Math, 'random', () => 0.5);
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'KitGuru pc gpu benchmark',
      url: 'https://example.com/kitguru',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'published',
      scheduled_at: '2026-11-02T12:00:00.000Z',
      score: 60,
    },
    {
      feed_id: 'aaa',
      feed_name: 'Aaa Feed',
      title: 'Aaa pc gpu benchmark',
      url: 'https://example.com/aaa',
      published_at: '2024-01-02T00:00:00.000Z',
      status: 'new',
      score: 70,
    },
    {
      feed_id: 'bbb',
      feed_name: 'Bbb Feed',
      title: 'Bbb pc gpu benchmark',
      url: 'https://example.com/bbb',
      published_at: '2024-01-03T00:00:00.000Z',
      status: 'new',
      score: 80,
    },
  ]);

  await backfillScores(db);

  const first = db.rows.get('https://example.com/aaa');
  const second = db.rows.get('https://example.com/bbb');

  assert.equal(first.scheduled_at, '2026-11-02T12:04:00.000Z');
  assert.equal(second.scheduled_at, '2026-11-02T12:11:00.000Z');
});

test('clears all stored items', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'KitGuru pc gpu benchmark',
      url: 'https://example.com/kitguru',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'published',
      scheduled_at: '2026-11-02T12:00:00.000Z',
      score: 60,
    },
  ]);

  assert.equal(db.rows.size, 1);

  await clearItems(db);

  assert.equal(db.rows.size, 0);
});
