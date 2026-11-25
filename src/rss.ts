import { XMLParser } from 'fast-xml-parser';

import { MAX_DESCRIPTION_LENGTH, truncateToSentence } from './feeds.js';
import type { FeedConfig, SearchItem } from './types.js';

const REQUEST_TIMEOUT_MS = 10_000;
const FEED_USER_AGENT = 'hinews-cf/1.0';

/** A normalized news item parsed from a feed. */
export interface RssItem {
  title: string;
  url: string;
  description: string;
  publishedAt: string;
}

interface XmlNode {
  [key: string]: unknown;
}

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  trimValues: true,
  parseTagValue: false,
  processEntities: true,
});

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asRecord(value: unknown): XmlNode | null {
  return typeof value === 'object' && value !== null
    ? (value as XmlNode)
    : null;
}

function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function textValue(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value).trim();
  }
  const record = asRecord(value);
  if (!record) return '';
  const text = record['#text'];
  if (typeof text === 'string') return text.trim();
  if (typeof text === 'number' || typeof text === 'boolean') {
    return String(text).trim();
  }
  return '';
}

/** Strip HTML markup and decode basic entities from a feed description. */
function stripHtml(value: string): string {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeUrl(value: string): string {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function toIsoDate(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? new Date().toISOString()
    : date.toISOString();
}

function readAtomLink(value: unknown): string {
  for (const entry of asArray(value)) {
    if (typeof entry === 'string') {
      const normalized = normalizeUrl(entry);
      if (normalized) return normalized;
    }
    const record = asRecord(entry);
    if (!record) continue;
    const href = textValue(record['@_href']);
    const rel = textValue(record['@_rel']) || 'alternate';
    if (href && rel !== 'self') {
      const normalized = normalizeUrl(href);
      if (normalized) return normalized;
    }
  }
  return '';
}

function parseRssItems(doc: XmlNode): RssItem[] {
  const rss = asRecord(doc.rss);
  const channel = asRecord(rss?.channel) ?? asRecord(doc.channel);
  const rdf = asRecord(doc['rdf:RDF']);
  const rawItems = [
    ...asArray(channel?.item),
    ...asArray(rdf?.item),
    ...asArray(doc.item),
  ];

  return rawItems.flatMap((raw) => {
    const item = asRecord(raw);
    if (!item) return [];

    const title = stripHtml(textValue(item.title));
    const url = normalizeUrl(textValue(item.link) || readAtomLink(item.link));
    if (!title || !url) return [];

    const description =
      textValue(item['content:encoded']) ||
      textValue(item.description) ||
      textValue(item.summary);
    const publishedAt = toIsoDate(
      textValue(item.pubDate) ||
        textValue(item.published) ||
        textValue(item.updated) ||
        textValue(item['dc:date']),
    );

    return [
      {
        title,
        url,
        description: truncateToSentence(
          stripHtml(description),
          MAX_DESCRIPTION_LENGTH,
        ),
        publishedAt,
      },
    ];
  });
}

function parseJsonFeed(content: string): RssItem[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch {
    return [];
  }

  const record = asRecord(parsed);
  const items = asArray(record?.items);
  return items.flatMap((raw) => {
    const item = asRecord(raw);
    if (!item) return [];

    const title = stripHtml(textValue(item.title));
    const url = normalizeUrl(
      textValue(item.url) || textValue(item.external_url),
    );
    if (!title || !url) return [];

    const description =
      textValue(item.content_text) ||
      stripHtml(textValue(item.content_html)) ||
      stripHtml(textValue(item.summary));
    const publishedAt = toIsoDate(
      textValue(item.date_published) || textValue(item.date_modified),
    );

    return [
      {
        title,
        url,
        description: truncateToSentence(description, MAX_DESCRIPTION_LENGTH),
        publishedAt,
      },
    ];
  });
}

/** Parse RSS/XML or JSON feed content into normalized news items. */
export function parseRssFeed(content: string): RssItem[] {
  const trimmed = content.trim();
  if (!trimmed) return [];

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const items = parseJsonFeed(trimmed);
    if (items.length > 0) return items;
  }

  try {
    const doc = asRecord(parser.parse(trimmed));
    if (!doc) return [];
    return parseRssItems(doc);
  } catch {
    return [];
  }
}

function toSearchItem(source: FeedConfig, item: RssItem): SearchItem | null {
  const url = normalizeUrl(item.url);
  const title = item.title.trim();
  if (!title || !url) return null;

  return {
    title,
    url,
    source: source.name,
    description: item.description,
    score: 0,
    publishedAt: item.publishedAt,
  };
}

/**
 * Fetch every configured feed and turn its entries into news items.
 * Feeds that fail to respond are skipped, the rest are still returned.
 */
export async function fetchRssItems(
  sources: FeedConfig[],
): Promise<SearchItem[]> {
  const items: SearchItem[] = [];

  for (const source of sources) {
    try {
      console.log(`Fetching feed ${source.name}: ${source.url}`);
      const response = await fetch(source.url, {
        method: 'GET',
        headers: { 'User-Agent': FEED_USER_AGENT },
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        console.warn(
          `RSS feed fetch failed for ${source.name} (HTTP ${response.status})`,
        );
        continue;
      }

      const content = await response.text();
      const parsed = parseRssFeed(content);
      console.log(`Parsed ${parsed.length} item(s) from ${source.name}`);
      for (const item of parsed) {
        const searchItem = toSearchItem(source, item);
        if (searchItem) items.push(searchItem);
      }
    } catch (error) {
      console.warn(
        `RSS feed fetch failed for ${source.name}:`,
        errorMessage(error),
      );
    }
  }

  return items;
}
