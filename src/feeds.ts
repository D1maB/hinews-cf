import { XMLParser } from 'fast-xml-parser';
import { dedupByTitle } from './dedup.js';
import type {
  AssetFetcher,
  Env,
  FeedConfig,
  LoadedFeed,
  ParsedItem,
} from './types.js';

export const DEFAULT_FEEDS: FeedConfig[] = [
  {
    id: 'tomshardware',
    name: "Tom's Hardware",
    url: 'https://www.tomshardware.com/feeds/all',
  },
  {
    id: 'techpowerup',
    name: 'TechPowerUp',
    url: 'https://www.techpowerup.com/rss/news',
  },
  { id: 'kitguru', name: 'KitGuru', url: 'https://www.kitguru.net/feed/' },
  { id: 'wccftech', name: 'Wccftech', url: 'https://wccftech.com/feed/' },
  { id: 'guru3d', name: 'Guru3D', url: 'https://www.guru3d.com/rss.xml' },
  { id: 'pcgamer', name: 'PC Gamer', url: 'https://www.pcgamer.com/rss/' },
  {
    id: 'hexus',
    name: 'HEXUS',
    url: 'http://www.hexus.net/rss/hexus_rss.xml',
  },
  {
    id: 'overclock3d',
    name: 'Overclock3D',
    url: 'https://overclock3d.net/feed/',
  },
];

export const ITEMS_PER_FEED = 10;
const FETCH_TIMEOUT_MS = 10_000;
const FETCH_ATTEMPTS = 3;
const MAX_DESCRIPTION_LENGTH = 300;

export const FEED_REQUEST_INIT: RequestInit = {
  headers: {
    accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    'user-agent': 'Mozilla/5.0 (compatible; hinews-cf/0.1)',
  },
  cf: { cacheEverything: true, cacheTtl: 300 },
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  trimValues: true,
  parseTagValue: false,
  parseAttributeValue: false,
  processEntities: false,
});

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '\u2014',
  ndash: '\u2013',
  hellip: '\u2026',
  lsquo: '\u2018',
  rsquo: '\u2019',
  ldquo: '\u201c',
  rdquo: '\u201d',
};

function decodeCodePoint(value: number): string {
  try {
    return String.fromCodePoint(value);
  } catch {
    return '';
  }
}

function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z]+);/gi, (match, entity) => {
    const key = String(entity).toLowerCase();
    if (key.startsWith('#x')) {
      return decodeCodePoint(parseInt(key.slice(2), 16)) || match;
    }
    if (key.startsWith('#')) {
      return decodeCodePoint(parseInt(key.slice(1), 10)) || match;
    }
    return NAMED_ENTITIES[key] ?? match;
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readText(value: unknown): string {
  if (value == null) return '';
  const record = asRecord(value);
  if (record && '#text' in record) {
    return decodeEntities(String(record['#text'] ?? ''));
  }
  return decodeEntities(String(value));
}

function readLink(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return decodeEntities(value);
  if (Array.isArray(value)) return readLink(value[0]);
  const record = asRecord(value);
  if (!record) return '';
  if (record['@_href']) return decodeEntities(String(record['@_href']));
  if (record['#text']) return decodeEntities(String(record['#text']));
  return '';
}

function normalizeLink(link: string): string {
  try {
    const url = new URL(link);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function toArray(value: unknown): unknown[] {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

function isFeedConfig(value: unknown): value is FeedConfig {
  const record = asRecord(value);
  return (
    record !== null &&
    typeof record.id === 'string' &&
    typeof record.name === 'string' &&
    typeof record.url === 'string'
  );
}

export function getFeeds(env: Pick<Env, 'FEEDS'> = {}): FeedConfig[] {
  const raw = env.FEEDS;
  if (Array.isArray(raw)) {
    const feeds = raw.filter(isFeedConfig);
    if (feeds.length > 0) return feeds;
  }
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        const feeds = parsed.filter(isFeedConfig);
        if (feeds.length > 0) return feeds;
      }
    } catch {
      // Fall back to the built-in feed list.
    }
  }
  return DEFAULT_FEEDS;
}

/** Cut text at the last sentence boundary that fits within `maxLength`. */
export function truncateToSentence(text: string, maxLength = 300): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  const sliced = text.slice(0, maxLength);
  const lastIndex = Math.max(
    sliced.lastIndexOf('.'),
    sliced.lastIndexOf('!'),
    sliced.lastIndexOf('?'),
  );
  return (lastIndex > 0 ? sliced.slice(0, lastIndex + 1) : sliced).trim();
}

/** Parse RSS or Atom XML into normalized items. */
export function parseRssItems(xml: string): ParsedItem[] {
  const document = parser.parse(xml) as Record<string, unknown>;
  const rss = asRecord(document.rss);
  const channel = asRecord(rss?.channel ?? document.feed);

  if (!channel) {
    return [];
  }

  const entries = toArray(channel.item ?? channel.entry);
  const items: ParsedItem[] = entries.map((entry) => {
    const item = asRecord(entry) ?? {};
    const title = readText(item.title).trim();
    const description = readText(
      item.description ?? item.summary ?? item.content ?? item.subtitle,
    ).trim();
    return {
      title,
      link: normalizeLink(readLink(item.link)),
      publishedAt: readText(item.pubDate ?? item.published ?? item.updated),
      score: null,
      ...(description
        ? {
            description: truncateToSentence(
              description,
              MAX_DESCRIPTION_LENGTH,
            ),
          }
        : {}),
    };
  });

  return dedupByTitle(items)
    .filter((item) => item.title !== '' && item.link !== '')
    .slice(0, ITEMS_PER_FEED);
}

async function readLocalFeed(
  assets: AssetFetcher,
  feed: FeedConfig,
): Promise<string> {
  const response = await assets.fetch(
    new URL(`/${feed.id}.xml`, 'http://localhost'),
  );
  if (!response.ok) {
    throw new Error(
      `Local feed ${feed.id}.xml not found (HTTP ${response.status})`,
    );
  }
  return response.text();
}

async function fetchRemoteFeed(feed: FeedConfig): Promise<string> {
  let lastError: unknown;

  for (let attempt = 0; attempt < FETCH_ATTEMPTS; attempt += 1) {
    try {
      const response = await fetch(feed.url, {
        ...FEED_REQUEST_INIT,
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error ? lastError : new Error('Feed fetch failed');
}

/** Load and parse a single feed, reporting failures instead of throwing. */
export async function loadFeed(
  feed: FeedConfig,
  env: Pick<Env, 'ASSETS'>,
): Promise<LoadedFeed> {
  try {
    const xml = env.ASSETS
      ? await readLocalFeed(env.ASSETS, feed)
      : await fetchRemoteFeed(feed);
    return { ...feed, status: 'ok', items: parseRssItems(xml) };
  } catch (error) {
    return {
      ...feed,
      status: 'error',
      items: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/** Load every configured feed concurrently. */
export async function loadFeeds(
  env: Pick<Env, 'ASSETS' | 'FEEDS'>,
): Promise<LoadedFeed[]> {
  const feeds = getFeeds(env);
  const results = await Promise.allSettled(
    feeds.map((feed) => loadFeed(feed, env)),
  );

  return results.map((result, index) => {
    if (result.status === 'fulfilled') return result.value;
    return {
      ...feeds[index],
      status: 'error',
      items: [],
      error:
        result.reason instanceof Error
          ? result.reason.message
          : 'Unknown error',
    };
  });
}

/** Convert a feed date to ISO-8601, falling back to now for invalid values. */
export function toIsoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}
