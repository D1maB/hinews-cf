import { XMLParser } from 'fast-xml-parser';
import { dedupByTitle } from './dedup.js';

export const DEFAULT_FEEDS = [
  { id: 'tomshardware', name: "Tom's Hardware", url: 'https://www.tomshardware.com/feeds/all' },
  { id: 'techpowerup', name: 'TechPowerUp', url: 'https://www.techpowerup.com/rss/news' },
  { id: 'kitguru', name: 'KitGuru', url: 'https://www.kitguru.net/feed/' },
  { id: 'wccftech', name: 'Wccftech', url: 'https://wccftech.com/feed/' },
  { id: 'guru3d', name: 'Guru3D', url: 'https://www.guru3d.com/rss.xml' },
  { id: 'pcgamer', name: 'PC Gamer', url: 'https://www.pcgamer.com/rss/' },
  { id: 'hexus', name: 'HEXUS', url: 'http://www.hexus.net/rss/hexus_rss.xml' },
  { id: 'overclock3d', name: 'Overclock3D', url: 'https://overclock3d.net/feed/' },
];

export const FEEDS = DEFAULT_FEEDS;

export interface FeedConfig {
  id: string;
  name: string;
  url: string;
}

export function getFeeds(env?: Record<string, unknown>): FeedConfig[] {
  const raw = env?.FEEDS;
  if (Array.isArray(raw)) return raw as FeedConfig[];
  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed as FeedConfig[];
    } catch {
      // fall back
    }
  }
  return DEFAULT_FEEDS;
}

export const ITEMS_PER_FEED = 10;

export const FEED_REQUEST_INIT = {
  headers: {
    accept: 'application/rss+xml, application/xml, text/xml;q=0.9, */*;q=0.8',
    'user-agent': 'Mozilla/5.0 (compatible; hinews-cf/0.1)',
  },
  cf: { cacheEverything: true, cacheTtl: 300 },
};

const LOCAL_ORIGIN = 'https://hinews.local';

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
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

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'");
}
function readText(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'object' && value !== null && '#text' in (value as Record<string, unknown>)) {
    return decodeEntities(String((value as Record<string, unknown>)['#text'] ?? ''));
  }
  return decodeEntities(String(value));
}
function readLink(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return decodeEntities(value);
  if (Array.isArray(value)) return readLink(value[0]);
  if (typeof value === 'object' && value !== null) {
    const v = value as Record<string, unknown>;
    if (v['@_href']) return decodeEntities(String(v['@_href']));
    if (v['#text']) return decodeEntities(String(v['#text']));
  }
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

export function truncateToSentence(text: string, maxLength = 300): string {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  const sliced = text.slice(0, maxLength);
  const lastIndex = Math.max(sliced.lastIndexOf('.'), sliced.lastIndexOf('!'), sliced.lastIndexOf('?'));
  return (lastIndex > 0 ? sliced.slice(0, lastIndex + 1) : sliced).trim();
}

export async function parseRssItems(xml: string): Promise<Array<{ title: string; link: string; publishedAt: string; score: number | null; description?: string }>> {
  const document = parser.parse(xml) as Record<string, unknown>;
  const channel = (document as any).rss?.channel ?? (document as any).feed;

  if (!channel) {
    return [];
  }

  const entries = toArray(channel.item ?? channel.entry);
  const items = await Promise.all(
    entries.map(async (item: any) => {
      const title = readText(item.title);
      const description = readText(item.description ?? item.summary ?? item.content ?? item.subtitle);
      return {
        title,
        link: normalizeLink(readLink(item.link)),
        publishedAt: readText(item.pubDate ?? item.published ?? item.updated),
        score: null as number | null,
        ...(description ? { description: truncateToSentence(description, 300) } : {}),
      };
    }),
  );

  return dedupByTitle(items as any).filter(({ title, link }: any) => title && link).slice(0, ITEMS_PER_FEED) as any;
}

async function readLocalFeed(assets: { fetch: (input: URL) => Promise<Response> }, feed: { id: string }): Promise<string> {
  const response = await assets.fetch(new URL(`/${feed.id}.xml`, 'http://localhost'));
  if (!response.ok) {
    throw new Error(`Local feed ${feed.id}.xml not found (HTTP ${response.status})`);
  }
  return response.text();
}

async function fetchRemoteFeed(feed: { url: string }): Promise<string> {
  const response = await fetch(feed.url);
  return response.text();
}

export async function loadFeed(feed: FeedConfig, env: Record<string, unknown>): Promise<{ id: string; name: string; url: string; items: any[]; error?: string }> {
  try {
    const xml = env.ASSETS ? await readLocalFeed(env.ASSETS as any, feed) : await fetchRemoteFeed(feed);
    return { ...feed, items: await parseRssItems(xml) };
  } catch (error) {
    return { ...feed, items: [], error: (error as Error).message };
  }
}

export async function loadFeeds(env: Record<string, unknown>): Promise<Array<{ id: string; name: string; url: string; items: any[]; error?: string }>> {
  const feeds = getFeeds(env);
  const results = await Promise.allSettled(feeds.map((feed) => loadFeed(feed, env)));
  return results.map((result, index) =>
    result.status === 'fulfilled'
      ? result.value
      : {
          ...feeds[index],
          items: [],
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
        },
  );
}

export function toIsoDate(value: string): string {
  const date = new Date(value);
  return isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}
