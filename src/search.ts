import { generateText } from 'ai';
import { createGoogle } from '@ai-sdk/google';
import { truncateToSentence } from './feeds.js';
import type { FeedConfig, SearchItem } from './types.js';

export const DEFAULT_GEMINI_BASE_URL =
  'https://generativelanguage.googleapis.com';
export const DEFAULT_NEWS_ITEM_COUNT = 20;
export const MIN_SCORE = 1;
export const MAX_SCORE = 100;

const GEMINI_API_VERSION = 'v1beta';

export interface SearchConfig {
  baseUrl: string;
  model: string;
  itemCount: number;
  apiKey?: string;
}

export interface SearchEnv {
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
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

/** Read the Gemini configuration, applying defaults and validating non-empty values. */
export function getSearchOptions(env: SearchEnv = {}): SearchConfig {
  const model = (env.GEMINI_MODEL || '').trim();
  const apiKey = env.GEMINI_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY must not be empty');
  }
  if (!model) {
    throw new Error('GEMINI_MODEL must not be empty');
  }
  console.log(`Using Gemini model ${model}`);
  return {
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    model,
    itemCount: parseItemCount(env.NEWS_ITEM_COUNT),
    apiKey,
  };
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
 * Search the web with Gemini via the Vercel AI SDK and return the latest scored news items.
 *
 * Returns an empty list when the API key is missing or the request fails.
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
      'Gemini search is not configured:',
      error instanceof Error ? error.message : error,
    );
    return [];
  }
  if (!options.apiKey) {
    console.error('GEMINI_API_KEY is not configured');
    return [];
  }

  const text = await requestSearch(
    options,
    buildPrompt(sources, options.itemCount),
  );
  if (text === null) return [];

  return parseSearchItems(text, sources, options.itemCount);
}

export async function requestSearch(
  options: SearchConfig,
  prompt: string,
): Promise<string | null> {
  try {
    const google = createGoogle({
      apiKey: options.apiKey,
      baseURL: options.baseUrl
        .replace(/\/+$/, '')
        .endsWith(`/${GEMINI_API_VERSION}`)
        ? options.baseUrl.replace(/\/+$/, '')
        : `${options.baseUrl.replace(/\/+$/, '')}/${GEMINI_API_VERSION}`,
    });
    const modelId = options.model.replace(/^models\//, '');
    const { text } = await generateText({
      model: google(modelId),
      prompt,
      tools: {
        google_search: google.tools.googleSearch({}),
      },
    });

    return text ?? '';
  } catch (error) {
    console.error(
      'Gemini search failed:',
      error instanceof Error ? error.message : error,
    );
    return null;
  }
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
