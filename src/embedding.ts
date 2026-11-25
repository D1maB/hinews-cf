import type { Env } from './types.js';

const GEMINI_API_VERSION = 'v1beta';
const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';
const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
const EMBEDDING_TIMEOUT_MS = 30_000;
export const DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD = 0.92;

type EmbeddingProvider = 'google' | 'openrouter';

export interface EmbeddingConfig {
  provider: EmbeddingProvider;
  model: string;
  apiKey: string;
  threshold: number;
  enabled: boolean;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function asBool(value: string | boolean | undefined): boolean {
  if (typeof value === 'boolean') return value;
  return (
    String(value ?? '')
      .trim()
      .toLowerCase() === 'true'
  );
}

function requireValue(value: string | undefined, name: string): string {
  const trimmed = value?.trim();
  if (!trimmed) throw new Error(`${name} must not be empty`);
  return trimmed;
}

function parseProvider(value: string | undefined): EmbeddingProvider {
  const raw = (value || 'google').trim().toLowerCase();
  const provider = raw === 'gemini' ? 'google' : raw;
  if (provider !== 'google' && provider !== 'openrouter') {
    throw new Error('AI_PROVIDER must be google or openrouter for embeddings');
  }
  return provider;
}

function parseThreshold(value: string | undefined): number {
  if (value == null || value.trim() === '')
    return DEFAULT_DUPLICATE_SIMILARITY_THRESHOLD;
  const threshold = Number(value);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1) {
    throw new Error('DUPLICATE_SIMILARITY_THRESHOLD must be between 0 and 1');
  }
  return threshold;
}

export function getEmbeddingConfig(env: Env): EmbeddingConfig {
  const enabled = asBool(env.DUPLICATE_PREVENTION_ENABLED);
  const provider = parseProvider(env.AI_PROVIDER);
  const threshold = parseThreshold(env.DUPLICATE_SIMILARITY_THRESHOLD);

  if (!enabled) {
    return { enabled, provider, model: '', apiKey: '', threshold };
  }

  const model = requireValue(env.EMBEDDING_MODEL, 'EMBEDDING_MODEL');
  const apiKey =
    provider === 'openrouter'
      ? requireValue(env.OPENROUTER_API_KEY, 'OPENROUTER_API_KEY')
      : requireValue(env.GEMINI_API_KEY, 'GEMINI_API_KEY');
  return { enabled, provider, model, apiKey, threshold };
}

async function embedWithGemini(
  config: EmbeddingConfig,
  text: string,
): Promise<number[] | null> {
  try {
    const model = config.model.replace(/^models\//, '');
    const response = await fetch(
      `${GEMINI_BASE_URL}/${GEMINI_API_VERSION}/models/${encodeURIComponent(model)}:embedContent`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-goog-api-key': config.apiKey,
        },
        body: JSON.stringify({ content: { parts: [{ text }] } }),
        signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
      },
    );
    if (!response.ok) {
      console.error(
        `Gemini embedding failed with HTTP ${response.status}: ${await response.text()}`,
      );
      return null;
    }
    const data = (await response.json()) as {
      embedding?: { values?: number[] };
    };
    return Array.isArray(data.embedding?.values)
      ? data.embedding!.values
      : null;
  } catch (error) {
    console.error('Gemini embedding failed:', errorMessage(error));
    return null;
  }
}

async function embedWithOpenRouter(
  config: EmbeddingConfig,
  text: string,
): Promise<number[] | null> {
  try {
    const response = await fetch(`${OPENROUTER_BASE_URL}/embeddings`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({ model: config.model, input: text }),
      signal: AbortSignal.timeout(EMBEDDING_TIMEOUT_MS),
    });
    if (!response.ok) {
      console.error(
        `OpenRouter embedding failed with HTTP ${response.status}: ${await response.text()}`,
      );
      return null;
    }
    const data = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = data.data?.[0]?.embedding;
    return Array.isArray(embedding) ? embedding : null;
  } catch (error) {
    console.error('OpenRouter embedding failed:', errorMessage(error));
    return null;
  }
}

export async function embedText(
  config: EmbeddingConfig,
  text: string,
): Promise<number[] | null> {
  return config.provider === 'openrouter'
    ? embedWithOpenRouter(config, text)
    : embedWithGemini(config, text);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  const len = Math.min(a.length, b.length);
  for (let i = 0; i < len; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

export function parseEmbedding(
  value: string | null | undefined,
): number[] | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((n) => typeof n === 'number')
      ? (parsed as number[])
      : null;
  } catch {
    return null;
  }
}
