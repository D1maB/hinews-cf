import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { DEFAULT_FEEDS } from '../src/feeds.ts';

const FEEDS_DIR = path.resolve('feeds');
const REQUEST_TIMEOUT_MS = 15_000;
const USER_AGENT = 'hinews-cf/1.0';

/** Download configured feeds to the local feeds directory for development. */
async function downloadFeeds(): Promise<void> {
  await mkdir(FEEDS_DIR, { recursive: true });

  for (const source of DEFAULT_FEEDS) {
    try {
      console.log(`Downloading ${source.name}: ${source.url}`);
      const response = await fetch(source.url, {
        headers: {
          'User-Agent': USER_AGENT,
          Accept:
            'application/rss+xml, application/atom+xml, application/xml, application/json, text/xml;q=0.9, */*;q=0.5',
        },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (!response.ok) {
        console.warn(
          `Failed to download ${source.name} (HTTP ${response.status})`,
        );
        continue;
      }

      const body = await response.text();
      const filePath = path.join(FEEDS_DIR, `${source.id}.xml`);
      await writeFile(filePath, body, 'utf8');
      console.log(`Saved ${source.name} -> ${filePath}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(`Failed to download ${source.name}: ${message}`);
    }
  }
}

await downloadFeeds();
