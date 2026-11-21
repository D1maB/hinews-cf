import assert from 'node:assert/strict';
import test from 'node:test';

import { backfillScores, deletePublished, saveItems } from '../src/store.ts';
import { createFakeDb } from './fake-db.ts';
import type { NewItem } from '../src/types.ts';

function makeItem(overrides: Partial<NewItem> = {}): NewItem {
  return {
    feedId: 'kitguru',
    feedName: 'KitGuru',
    title: 'KitGuru PC GPU benchmark',
    url: 'https://example.com/kitguru',
    publishedAt: '2024-01-01T00:00:00.000Z',
    score: 80,
    ...overrides,
  };
}

test('schedules unscheduled items across one 12 hour window from the last scheduled time', async (t) => {
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
      score: 80,
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

  assert.equal(first?.scheduled_at, '2026-11-02T18:00:00.000Z');
  assert.equal(second?.scheduled_at, '2026-11-03T00:00:00.000Z');
});

test('drops items scoring at or below the minimum', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Low score story',
      url: 'https://example.com/low',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'scheduled',
      score: 60,
    },
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'High score story',
      url: 'https://example.com/high',
      published_at: '2024-01-02T00:00:00.000Z',
      status: 'scheduled',
      score: 61,
    },
  ]);

  await backfillScores(db);

  assert.equal(db.rows.has('https://example.com/low'), false);
  assert.ok(db.rows.has('https://example.com/high'));
});

test('saveItems persists the description and target flags', async () => {
  const db = createFakeDb();

  const inserted = await saveItems(db, [
    makeItem({ description: 'A short excerpt.' }),
  ]);

  assert.equal(inserted, 1);
  const row = db.rows.get('https://example.com/kitguru');
  assert.equal(row?.description, 'A short excerpt.');
  assert.equal(row?.status, 'scheduled');
  assert.equal(row?.telegram_published, 0);
  assert.equal(row?.bsky_published, 0);
});

test('saveItems skips duplicate URLs and titles', async () => {
  const db = createFakeDb();

  const inserted = await saveItems(db, [
    makeItem(),
    makeItem({ title: 'Different title, same URL' }),
    makeItem({
      url: 'https://example.com/other',
      title: '  KitGuru PC GPU benchmark  ',
    }),
  ]);

  assert.equal(inserted, 1);
  assert.equal(db.rows.size, 1);
});

test('deletes only published items', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Published story',
      url: 'https://example.com/published',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'published',
      scheduled_at: '2026-11-02T12:00:00.000Z',
      score: 60,
    },
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Scheduled story',
      url: 'https://example.com/scheduled',
      published_at: '2024-01-02T00:00:00.000Z',
      status: 'scheduled',
      scheduled_at: '2026-11-03T12:00:00.000Z',
      score: 70,
    },
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'New story',
      url: 'https://example.com/new',
      published_at: '2024-01-03T00:00:00.000Z',
      status: 'new',
      score: 80,
    },
  ]);

  assert.equal(db.rows.size, 3);

  const deleted = await deletePublished(db);

  assert.equal(deleted, 1);
  assert.equal(db.rows.size, 2);
  assert.ok(!db.rows.has('https://example.com/published'));
  assert.ok(db.rows.has('https://example.com/scheduled'));
  assert.ok(db.rows.has('https://example.com/new'));
});

test('deletePublished returns 0 when no published items', async (t) => {
  t.mock.method(console, 'log', () => {});
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Scheduled story',
      url: 'https://example.com/scheduled',
      published_at: '2024-01-02T00:00:00.000Z',
      status: 'scheduled',
      scheduled_at: '2026-11-03T12:00:00.000Z',
      score: 70,
    },
  ]);

  const deleted = await deletePublished(db);

  assert.equal(deleted, 0);
  assert.equal(db.rows.size, 1);
});
