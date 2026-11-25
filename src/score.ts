import type { Env, StoredItem } from './types.js';

const GEMINI_API_VERSION = 'v1beta';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

export const DEFAULT_AI_PROVIDER: AiProvider = 'google';
export const MIN_SCORE = 1;
export const MAX_SCORE = 100;

const AI_PROVIDERS = ['google', 'openrouter'] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export interface ScoreConfig {
  provider: AiProvider;
  model: string;
  apiKey: string;
}

export interface ScoreEnv {
  AI_PROVIDER?: string;
  GEMINI_API_KEY?: string;
  GEMINI_MODEL?: string;
  OPENROUTER_API_KEY?: string;
  OPENROUTER_MODEL?: string;
}

interface ScoreResult {
  url: string;
  score: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function requireValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} must not be empty`);
  return trimmed;
}

function parseProvider(value: string | undefined): AiProvider {
  const raw = (value || DEFAULT_AI_PROVIDER).trim().toLowerCase();
  const provider = raw === 'gemini' ? 'google' : raw;
  if (!AI_PROVIDERS.includes(provider as AiProvider)) {
    throw new Error(`AI_PROVIDER must be one of: ${AI_PROVIDERS.join(', ')}`);
  }
  return provider as AiProvider;
}

/** Read AI scoring configuration from environment variables. */
export function getScoreConfig(env: ScoreEnv = {}): ScoreConfig {
  const provider = parseProvider(env.AI_PROVIDER);

  if (provider === 'openrouter') {
    return {
      provider,
      apiKey: requireValue(env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY'),
      model: requireValue(env.OPENROUTER_MODEL, 'OPENROUTER_MODEL'),
    };
  }

  return {
    provider,
    apiKey: requireValue(env.GEMINI_API_KEY, 'GEMINI_API_KEY'),
    model: requireValue(env.GEMINI_MODEL, 'GEMINI_MODEL'),
  };
}

function buildScorePrompt(
  items: Array<Pick<StoredItem, 'title' | 'url'>>,
): string {
  const list = items
    .map((item, index) => `${index + 1}. ${item.title}\nURL: ${item.url}`)
    .join('\n');

  return [
    'Score each news item title for PC users and gamers interest from 1 to 100.',
    'Return only a JSON array. Each element must have:',
    '{ "url": "<exact url from input>", "score": <integer 1-100> }',
    'Do not include markdown fences or commentary.',
    '',
    'Items:',
    list,
  ].join('\n');
}

async function requestGemini(
  config: ScoreConfig,
  prompt: string,
): Promise<string | null> {
  try {
    const model = config.model.replace(/^models\//, '');
    const response = await fetch(
      `${GEMINI_BASE_URL}/${GEMINI_API_VERSION}/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
        }),
      },
    );

    if (!response.ok) {
      console.error(
        `Gemini scoring failed with HTTP ${response.status}: ${await response.text()}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };
    return (
      data.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('') ?? ''
    );
  } catch (error) {
    console.error('Gemini scoring failed:', errorMessage(error));
    return null;
  }
}

async function requestOpenRouter(
  config: ScoreConfig,
  prompt: string,
): Promise<string | null> {
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    if (!response.ok) {
      console.error(
        `OpenRouter scoring failed with HTTP ${response.status}: ${await response.text()}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  } catch (error) {
    console.error('OpenRouter scoring failed:', errorMessage(error));
    return null;
  }
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
      // Try next candidate.
    }
  }
  return null;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeScore(value: unknown): number | null {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return Math.max(MIN_SCORE, Math.min(MAX_SCORE, Math.round(num)));
}

function parseScoreResults(
  content: string,
  allowedUrls: Set<string>,
): ScoreResult[] {
  const parsed = extractJson(content);
  const list = Array.isArray(parsed)
    ? parsed
    : Array.isArray(asRecord(parsed)?.items)
      ? (asRecord(parsed)?.items as unknown[])
      : Array.isArray(asRecord(parsed)?.scores)
        ? (asRecord(parsed)?.scores as unknown[])
        : null;
  if (!list) return [];

  const results: ScoreResult[] = [];
  const seen = new Set<string>();
  for (const value of list) {
    const record = asRecord(value);
    if (!record) continue;
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    const score = normalizeScore(record.score);
    if (!url || score == null || !allowedUrls.has(url) || seen.has(url)) {
      continue;
    }
    seen.add(url);
    results.push({ url, score });
  }
  return results;
}

/** Score new items by title using the configured AI provider. */
export async function scoreItems(
  env: Env,
  items: Array<Pick<StoredItem, 'title' | 'url'>>,
): Promise<Map<string, number>> {
  const scores = new Map<string, number>();
  if (items.length === 0) return scores;

  const config = getScoreConfig(env);
  console.log(
    `Scoring ${items.length} item(s) with ${config.provider}/${config.model}`,
  );
  const prompt = buildScorePrompt(items);

  console.log('p:');
  console.log(prompt);

  const text =
    config.provider === 'openrouter'
      ? await requestOpenRouter(config, prompt)
      : await requestGemini(config, prompt);

  if (text === null) {
    throw new Error('AI scoring request failed');
  }

  console.log('t:');
  console.log(text);

  const allowedUrls = new Set(items.map((item) => item.url));
  for (const result of parseScoreResults(text, allowedUrls)) {
    scores.set(result.url, result.score);
  }

  if (scores.size === 0) {
    throw new Error('AI scoring returned no usable scores');
  }

  console.log(`Received ${scores.size} score(s) from AI`);
  return scores;
}
