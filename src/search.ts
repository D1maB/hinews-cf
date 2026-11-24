import { truncateToSentence } from './feeds.js';
import { createSearchProvider } from './search-provider.js';
import type { FeedConfig, SearchItem } from './types.js';

export const DEFAULT_SEARCH_PROVIDER: SearchProviderName = 'gemini';
export const DEFAULT_NEWS_ITEM_COUNT = 20;
export const MIN_SCORE = 1;
export const MAX_SCORE = 100;
const URL_CHECK_TIMEOUT_MS = 5_000;

const SEARCH_PROVIDERS = ['gemini', 'openrouter'] as const;

export type SearchProviderName = (typeof SEARCH_PROVIDERS)[number];

export interface SearchConfig {
  provider: SearchProviderName;
  model: string;
  itemCount: number;
  apiKey: string;
}

export interface SearchEnv {
  SEARCH_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  NEWS_ITEM_COUNT?: string;
}

function parseItemCount(value: string | undefined): number {
  if (value == null || value.trim() === '') return DEFAULT_NEWS_ITEM_COUNT;
  const count = Number(value);
  if (!Number.isInteger(count) || count < 1) {
    throw new Error('NEWS_ITEM_COUNT must be a positive integer');
  }
  return count;
}

function parseProvider(value: string | undefined): SearchProviderName {
  const provider = (value || DEFAULT_SEARCH_PROVIDER).trim().toLowerCase();
  if (!SEARCH_PROVIDERS.includes(provider as SearchProviderName)) {
    throw new Error(
      `SEARCH_PROVIDER must be one of: ${SEARCH_PROVIDERS.join(', ')}`,
    );
  }
  return provider as SearchProviderName;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${name} must not be empty`);
  }
  return trimmed;
}

/** Read the search configuration, applying defaults and validating non-empty values. */
export function getSearchOptions(env: SearchEnv = {}): SearchConfig {
  const provider = parseProvider(env.SEARCH_PROVIDER);
  const itemCount = parseItemCount(env.NEWS_ITEM_COUNT);

  const config: SearchConfig =
    provider === 'openrouter'
      ? {
          provider,
          apiKey: requireValue(env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY'),
          model: requireValue(env.OPENROUTER_MODEL, 'OPENROUTER_MODEL'),
          itemCount,
        }
      : {
          provider,
          apiKey: requireValue(env.GEMINI_API_KEY, 'GEMINI_API_KEY'),
          model: requireValue(env.GEMINI_MODEL, 'GEMINI_MODEL'),
          itemCount,
        };

  console.log(`Using model ${config.model}`);
  console.log(`Using provider ${config.provider}`);
  console.log(`itemCount ${itemCount}`);

  return config;
}

function siteUrl(source: FeedConfig): string {
  try {
    return new URL(source.url).origin;
  } catch {
    return source.url;
  }
}

function buildSourceList(sources: FeedConfig[]): string {
  return sources
    .map((source) => `- ${source.name}: ${siteUrl(source)}`)
    .join('\n');
}

export function buildPrompt(sources: FeedConfig[], itemCount: number): string {
  return [
    'You are a news editor for a PC hardware and gaming audience.',
    `Today is ${new Date().toISOString().slice(0, 10)}.`,
    'Search the web for interesting news for the PC hardware and gaming audience published within the last 12 hours:',
    buildSourceList(sources),
    '',
    `Return exactly ${itemCount} articles as a JSON array. Each element must have:`,
    '{',
    '  "title": "article title",',
    '  "description": "two or three sentence summary",',
    '  "source": "site name exactly as listed above",',
    '  "url": "direct link to the article",',
    '  "score": 75',
    '}',
    '',
    `The score is an integer from ${MIN_SCORE} to ${MAX_SCORE} that rates how interesting the article is to a PC hardware and gaming audience. Assign each article its own score within that range; do not reuse the same score across articles.`,
    'Only include articles hosted on the listed sites and published within the last 12 hours.',
    'Only return direct article URLs that are live and accessible (not 404, removed pages, homepages, or section listings).',
    'Exclude deals, promotions, and bargain content; only genuine news stories.',
    'Do not include duplicate articles: every title and URL in the array must be unique.',
    'Order the array from newest to oldest.',
    'Respond with only the JSON array, without markdown fences or commentary.',
  ].join('\n');
}

/**
 * Search the web with the configured provider and return the latest scored
 * news items.
 *
 * Returns an empty list when the configuration is missing or the request fails.
 */
export async function searchNews(
  env: SearchEnv,
  sources: FeedConfig[],
): Promise<SearchItem[]> {
  let options: SearchConfig;
  try {
    options = getSearchOptions(env);
  } catch (error) {
    console.error('News search is not configured:', errorMessage(error));
    return [];
  }

  try {
    const request = createSearchProvider(options);
    const text = await request(buildPrompt(sources, options.itemCount));
    if (text === null) return [];

    const items = parseSearchItems(text, sources, options.itemCount);
    return await filterLiveSearchItems(items);
  } catch (error) {
    console.error('News search failed:', errorMessage(error));
    return [];
  }
}

/** Check if a URL is accessible by making a HEAD request. */
export async function isUrlValid(
  urlString: string,
  timeoutMs = 8000,
): Promise<boolean> {
  try {
    const abort = new AbortController();
    const timeoutId = setTimeout(() => abort.abort(), timeoutMs);
    const response = await fetch(urlString, {
      method: 'HEAD',
      signal: abort.signal,
      headers: { 'User-Agent': 'hinews-cf/1.0' },
    });
    clearTimeout(timeoutId);
    return response.ok;
  } catch {
    return false;
  }
}

/** Run a single search request through the configured provider. */
export async function requestSearch(
  options: SearchConfig,
  prompt: string,
): Promise<string | null> {
  try {
    return await createSearchProvider(options)(prompt);
  } catch (error) {
    console.error('News search failed:', errorMessage(error));
    return null;
  }
}

async function isLiveUrl(url: string): Promise<boolean> {
  async function check(method: 'HEAD' | 'GET'): Promise<Response> {
    return fetch(url, {
      method,
      redirect: 'follow',
      signal: AbortSignal.timeout(URL_CHECK_TIMEOUT_MS),
    });
  }

  try {
    let response = await check('HEAD');
    if (response.status === 405 || response.status === 501) {
      response = await check('GET');
    }

    if (response.status === 404 || response.status === 410) {
      console.warn(`Skipping dead link (${response.status}): ${url}`);
      return false;
    }

    return true;
  } catch (error) {
    console.warn(
      `Keeping link because liveness check failed: ${url}`,
      errorMessage(error),
    );
    return true;
  }
}

/** Drop items whose URLs are definitively dead (404/410). */
export async function filterLiveSearchItems(
  items: SearchItem[],
): Promise<SearchItem[]> {
  const checks = await Promise.allSettled(
    items.map(async (item) => ({ item, live: await isLiveUrl(item.url) })),
  );

  return checks.flatMap((result) => {
    if (result.status === 'fulfilled') {
      return result.value.live ? [result.value.item] : [];
    }
    console.warn('Keeping link because liveness check rejected:', result.reason);
    return [];
  });
}

/** Extract and validate the AI's JSON payload into scored search items. */
export function parseSearchItems(
  content: string,
  sources: FeedConfig[],
  itemCount = DEFAULT_NEWS_ITEM_COUNT,
): SearchItem[] {
  const parsed = extractJson(content);
  const list = Array.isArray(parsed) ? parsed : extractArray(parsed);
  if (!list) return [];

  const items: SearchItem[] = [];
  for (const value of list) {
    const item = normalizeSearchItem(value);
    if (item && isFromSources(item, sources)) {
      items.push(item);
    }
  }

  return items.slice(0, itemCount);
}

function extractArray(value: unknown): unknown[] | null {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'object' || value === null) return null;
  for (const entry of Object.values(value)) {
    if (Array.isArray(entry)) return entry;
  }
  return null;
}

function extractJson(content: string): unknown {
  const cleaned = String(content ?? '')
    .replace(/```json|```/gi, '')
    .trim();

  const attempts = [cleaned];
  const arrayStart = cleaned.indexOf('[');
  const arrayEnd = cleaned.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) {
    attempts.push(cleaned.slice(arrayStart, arrayEnd + 1));
  }
  const objectStart = cleaned.indexOf('{');
  const objectEnd = cleaned.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) {
    attempts.push(cleaned.slice(objectStart, objectEnd + 1));
  }

  for (const attempt of attempts) {
    try {
      return JSON.parse(attempt) as unknown;
    } catch {
      // Try the next candidate slice.
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function readString(value: unknown): string {
  return typeof value === 'string'
    ? value
        .replace(/\s*\[\d+\]/g, '')
        .replace(/\s+/g, ' ')
        .trim()
    : '';
}

function normalizeUrl(value: unknown): string {
  if (typeof value !== 'string') return '';
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    url.hash = '';
    return url.href;
  } catch {
    return '';
  }
}

function normalizeSearchItem(value: unknown): SearchItem | null {
  const record = asRecord(value);
  if (!record) return null;

  const title = readString(record.title);
  const url = normalizeUrl(record.url);
  const source = readString(record.source);
  const description = truncateToSentence(readString(record.description), 300);
  const rawScore = Number(record.score);

  if (!title || !url || !source || !Number.isFinite(rawScore)) {
    return null;
  }

  return {
    title,
    url,
    source,
    description,
    score: Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(rawScore))),
  };
}

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.replace(/^www\./i, '').toLowerCase();
  } catch {
    return '';
  }
}

function isFromSources(item: SearchItem, sources: FeedConfig[]): boolean {
  const sourceName = item.source.toLowerCase();
  if (sources.some((source) => source.name.toLowerCase() === sourceName)) {
    return true;
  }

  const host = hostOf(item.url);
  if (!host) return false;

  return sources.some((source) => {
    const sourceHost = hostOf(source.url);
    return (
      sourceHost !== '' &&
      (host === sourceHost || host.endsWith(`.${sourceHost}`))
    );
  });
}
