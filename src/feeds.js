import { XMLParser } from 'fast-xml-parser';
import { scoreTitle } from './score.js';
import { dedupByTitle } from './dedup.js';

export const DEFAULT_FEEDS = [
  { id: 'tomshardware', name: "Tom's Hardware", url: 'https://www.tomshardware.com/feeds/all' },
  { id: 'techpowerup', name: 'TechPowerUp', url: 'https://www.techpowerup.com/rss/news' },
  { id: 'kitguru', name: 'KitGuru', url: 'https://www.kitguru.net/feed/' },
  { id: 'wccftech', name: 'Wccftech', url: 'https://wccftech.com/feed/' },
  { id: 'guru3d', name: 'Guru3D', url: 'https://www.guru3d.com/rss.xml' },
];

export const FEEDS = DEFAULT_FEEDS;

/**
 * Resolves the configured feed list, allowing overrides through env.FEEDS.
 *
 * @param {Record<string, unknown>} [env]
 * @returns {Array<{ id: string, name: string, url: string }>}
 */
export function getFeeds(env) {
  const raw = env?.FEEDS;

  if (Array.isArray(raw)) {
    return raw;
  }

  if (typeof raw === 'string') {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }
    } catch {
      // Fall back to the default feeds below.
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

/**
 * Assets need an absolute base URL, which scheduled events do not provide.
 */
const LOCAL_ORIGIN = 'https://hinews.local';

const NAMED_ENTITIES = {
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

/**
 * Loads every feed, keeping per-feed failures out of the overall result.
 *
 * @param {Record<string, unknown>} env
 * @returns {Promise<Array<{ id: string, name: string, url: string, items: Array<{ title: string, link: string, publishedAt: string }>, error?: string }>>}
 */
export async function loadFeeds(env) {
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

/**
 * Loads and parses one RSS feed, from local storage when available.
 *
 * @param {{ id: string, name: string, url: string }} feed
 * @param {Record<string, unknown>} env
 * @returns {Promise<{ id: string, name: string, url: string, items: Array<{ title: string, link: string, publishedAt: string }> }>}
 */
async function loadFeed(feed, env) {
  const xml = env.ASSETS ? await readLocalFeed(env.ASSETS, feed) : await fetchRemoteFeed(feed);

  return { ...feed, items: parseRssItems(xml) };
}

/**
 * Reads a downloaded feed from the local static assets binding.
 *
 * @param {{ fetch: (input: URL) => Promise<Response> }} assets
 * @param {{ id: string }} feed
 * @returns {Promise<string>}
 */
async function readLocalFeed(assets, feed) {
  const response = await assets.fetch(new URL(`/${feed.id}.xml`, LOCAL_ORIGIN));

  if (!response.ok) {
    throw new Error(`Local feed ${feed.id}.xml not found (HTTP ${response.status})`);
  }

  return response.text();
}

/**
 * Fetches a feed from its remote site.
 *
 * @param {{ name: string, url: string }} feed
 * @returns {Promise<string>}
 */
async function fetchRemoteFeed(feed) {
  const response = await fetch(feed.url, FEED_REQUEST_INIT);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`.trim());
  }

  return response.text();
}

/**
 * Extracts up to ITEMS_PER_FEED items from an RSS or Atom document.
 *
 * @param {string} xml
 * @returns {Array<{ title: string, link: string, publishedAt: string }>}
 */
export function parseRssItems(xml) {
  const document = parser.parse(xml);
  const channel = document.rss?.channel ?? document.feed;

  if (!channel) {
    return [];
  }

  const items = toArray(channel.item ?? channel.entry)
    .map((item) => {
      const title = readText(item.title);
      return {
        title,
        link: normalizeLink(readLink(item.link)),
        publishedAt: readText(item.pubDate ?? item.published ?? item.updated),
        score: scoreTitle(title),
      };
    })
    .filter(({ title, link }) => title && link);

  return dedupByTitle(items).slice(0, ITEMS_PER_FEED);
}

/**
 * @param {unknown} value
 * @returns {Array<unknown>}
 */
function toArray(value) {
  return value == null ? [] : Array.isArray(value) ? value : [value];
}

/**
 * Reads an RSS link or an Atom link element.
 *
 * @param {unknown} value
 * @returns {string}
 */
function readLink(value) {
  for (const link of toArray(value)) {
    if (typeof link === 'string') {
      return readText(link);
    }

    if (link && typeof link === 'object') {
      const rel = link['@_rel'];

      if (!rel || rel === 'alternate') {
        return readText(link['@_href'] ?? link);
      }
    }
  }

  return '';
}

/**
 * Turns a parsed XML node into plain text.
 *
 * @param {unknown} value
 * @returns {string}
 */
function readText(value) {
  if (value == null) {
    return '';
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (typeof value === 'object') {
    return readText(value['#text'] ?? value['@_href']);
  }

  return decodeEntities(String(value)).replace(/<[^>]+>/g, '').trim();
}

/**
 * Decodes entities that fast-xml-parser leaves inside CDATA sections.
 *
 * @param {string} value
 * @returns {string}
 */
function decodeEntities(value) {
  return value
    .replace(/&#(x?[0-9a-f]+);/gi, (_, code) => decodeCodePoint(code))
    .replace(/&([a-z]+);/gi, (entity, name) => NAMED_ENTITIES[name.toLowerCase()] ?? entity);
}

/**
 * @param {string} code Decimal digits or a hexadecimal number prefixed with "x".
 * @returns {string}
 */
function decodeCodePoint(code) {
  const value = code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code);

  try {
    return String.fromCodePoint(value);
  } catch {
    return '';
  }
}

/**
 * Normalizes article links so the same story always deduplicates to one URL.
 *
 * @param {string} value
 * @returns {string}
 */
function normalizeLink(value) {
  try {
    const url = new URL(value);

    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return '';
    }

    url.hash = '';

    return url.href;
  } catch {
    return '';
  }
}

/**
 * @param {string} value
 * @returns {string | null}
 */
export function toIsoDate(value) {
  const date = new Date(value);

  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
