import { mkdir, writeFile } from 'node:fs/promises';

import { FEEDS, FEED_REQUEST_INIT } from '../src/index.js';

const OUTPUT_DIR = new URL('../feeds/', import.meta.url);

await mkdir(OUTPUT_DIR, { recursive: true });

const results = await Promise.allSettled(FEEDS.map(downloadFeed));

if (results.some((result) => result.status === 'rejected')) {
  process.exitCode = 1;
}

async function downloadFeed(feed) {
  try {
    const response = await fetch(feed.url, FEED_REQUEST_INIT);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
    }

    const xml = await response.text();

    if (!/<(?:rss|feed)\b/i.test(xml)) {
      throw new Error('response is not RSS or Atom XML');
    }

    await writeFile(new URL(`${feed.id}.xml`, OUTPUT_DIR), xml, 'utf8');
    console.log(`Downloaded ${feed.name} -> feeds/${feed.id}.xml`);
  } catch (error) {
    console.error(`Failed to download ${feed.name}: ${error.message}`);
    throw error;
  }
}
