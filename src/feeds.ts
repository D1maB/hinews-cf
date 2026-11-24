import sites from '../sites.json';
import type { Env, FeedConfig } from './types.js';

export const MAX_DESCRIPTION_LENGTH = 500;

const sitesFromJson: unknown = sites;

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
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

/** Built-in sources loaded from `sites.json`. */
export const DEFAULT_FEEDS: FeedConfig[] = Array.isArray(sitesFromJson)
  ? sitesFromJson.filter(isFeedConfig)
  : [];

/** Read the source list, falling back to the built-in feeds for invalid overrides. */
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
export function truncateToSentence(
  text: string,
  maxLength = MAX_DESCRIPTION_LENGTH,
): string {
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
