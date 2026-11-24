import assert from 'node:assert/strict';
import test from 'node:test';

import { buildScheduledAt, deletePublished, saveItems } from '../src/store.ts';
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

test('saveItems skips URLs that already exist in the database', async () => {
  const db = createFakeDb([
    {
      feed_id: 'kitguru',
      feed_name: 'KitGuru',
      title: 'Old story',
      url: 'https://example.com/kitguru',
      published_at: '2024-01-01T00:00:00.000Z',
      status: 'scheduled',
      score: 80,
    },
  ]);

  const inserted = await saveItems(db, [
    makeItem(),
    makeItem({
      title: 'Fresh story',
      url: 'https://example.com/fresh',
    }),
  ]);

  assert.equal(inserted, 1);
  assert.equal(db.rows.size, 2);
  assert.equal(db.rows.get('https://example.com/kitguru')?.title, 'Old story');
  assert.ok(db.rows.has('https://example.com/fresh'));
});

test('buildScheduledAt schedules items randomly within the 12 hour window', () => {
  const base = new Date('2026-11-24T17:00:00.000Z').getTime();

  const first = new Date(buildScheduledAt(base, 1)).getTime();
  const second = new Date(buildScheduledAt(base, 2)).getTime();

  assert.ok(first >= base);
  assert.ok(second >= base);
  assert.ok(second - base < 12 * 60 * 60 * 1000);
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
