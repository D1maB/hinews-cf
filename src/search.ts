import { truncateToSentence } from './feeds.js';
import { createSearchProvider } from './search-provider.js';
import type { FeedConfig, SearchItem } from './types.js';

export const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com';
export const DEFAULT_OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const DEFAULT_SEARCH_PROVIDER: SearchProviderName = 'gemini';
export const DEFAULT_NEWS_ITEM_COUNT = 20;
export const MIN_SCORE = 1;
export const MAX_SCORE = 100;

const SEARCH_PROVIDERS = ['gemini', 'openrouter'] as const;

export type SearchProviderName = (typeof SEARCH_PROVIDERS)[number];

export interface SearchConfig {
  provider: SearchProviderName;
  baseUrl: string;
  model: string;
  itemCount: number;
  apiKey: string;
}

export interface SearchEnv {
  SEARCH_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  GEMINI_BASE_URL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
  OPENROUTER_BASE_URL?: string;
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

  if (provider === 'openrouter') {
    const config = {
      provider,
      baseUrl: env.OPENROUTER_BASE_URL?.trim() || DEFAULT_OPENROUTER_BASE_URL,
      apiKey: requireValue(env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY'),
      model: requireValue(env.OPENROUTER_MODEL, 'OPENROUTER_MODEL'),
      itemCount,
    };
    console.log(`Using OpenRouter model ${config.model}`);
    return config;
  }

  const config = {
    provider,
    baseUrl: env.GEMINI_BASE_URL?.trim() || DEFAULT_GEMINI_BASE_URL,
    apiKey: requireValue(env.GEMINI_API_KEY, 'GEMINI_API_KEY'),
    model: requireValue(env.GEMINI_MODEL, 'GEMINI_MODEL'),
    itemCount,
  };
  console.log(`Using Gemini model ${config.model}`);
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
    'Use Google Search to find the latest news articles published by these sites:',
    buildSourceList(sources),
    '',
    `Return exactly ${itemCount} articles as a JSON array. Each element must have:`,
    '{',
    '  "title": "article title",',
    '  "description": "one or two sentence summary",',
    '  "source": "site name exactly as listed above",',
    '  "url": "direct link to the article",',
    '  "score": 42',
    '}',
    '',
    `The score is an integer from ${MIN_SCORE} to ${MAX_SCORE} that rates how interesting the article is to a PC hardware and gaming audience.`,
    'Only include articles hosted on the listed sites.',
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
    console.error(
      'News search is not configured:',
      error instanceof Error ? error.message : error,
    );
    return [];
  }

  const provider = createSearchProvider(options);
  const text = await provider.request(buildPrompt(sources, options.itemCount));
  if (text === null) return [];

  return parseSearchItems(text, sources, options.itemCount);
}

/** Run a single search request through the configured provider. */
export async function requestSearch(
  options: SearchConfig,
  prompt: string,
): Promise<string | null> {
  return createSearchProvider(options).request(prompt);
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
