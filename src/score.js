const POSITIVE_KEYWORDS = [
  'cpu',
  'gpu',
  'graphics card',
  'processor',
  'motherboard',
  'ram',
  'ddr5',
  'ssd',
  'nvme',
  'benchmark',
  'driver',
  'overclock',
  'cooler',
  'psu',
  'pc',
  'gaming',
  'ray tracing',
  'dlss',
  'fsr',
  'thermal',
  'fps',
  'nvidia',
  'amd',
  'intel',
  'geforce',
  'radeon',
  'ryzen',
  'review',
  'performance',
  'latency',
];

export const MIN_SCORE = 50;

const NEGATIVE_KEYWORDS = [
  'smartphone',
  'phone',
  'iphone',
  'android',
  'console',
  'playstation',
  'xbox',
  'nintendo',
  'tablet',
  'wearable',
];

const DEFAULT_SCORE_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_SCORE_MODEL = 'gpt-4o-mini';

const SCORE_SYSTEM_PROMPT =
  'You rate how relevant a news headline is to a PC hardware and gaming audience on a 0-100 scale. Respond with only a JSON object like {"score": 73}.';

/**
 * Resolves the AI scoring configuration from the environment.
 *
 * Local development points SCORE_BASE_URL and SCORE_MODEL at Ollama, while
 * production falls back to a remote model through the default endpoint.
 *
 * @param {Record<string, unknown>} [env]
 * @returns {{ baseUrl: string, model: string, enabled: boolean }}
 */
export function getScoreOptions(env) {
  return {
    baseUrl: env?.SCORE_BASE_URL || DEFAULT_SCORE_BASE_URL,
    model: env?.SCORE_MODEL || DEFAULT_SCORE_MODEL,
    enabled: env?.SCORE_ENABLED !== 'false',
  };
}

/**
 * Scores a headline for user relevance on a 0-100 scale using the configured
 * AI provider, falling back to curated keyword scoring when disabled or on failure.
 *
 * @param {string} title
 * @param {{ baseUrl?: string, model?: string, enabled?: boolean }} [options]
 * @returns {Promise<number>}
 */
export async function scoreTitle(title, options = {}) {
  const fallbackScore = scoreByKeywords(title);

  if (!options.enabled || !options.baseUrl || !options.model) {
    return fallbackScore;
  }

  const aiScore = await scoreWithAi({ title, baseUrl: options.baseUrl, model: options.model });

  return aiScore ?? fallbackScore;
}

/**
 * Scores a headline through an OpenAI compatible chat completions endpoint,
 * which Ollama exposes locally and remote providers expose in production.
 *
 * @param {{ title: string, baseUrl: string, model: string }} params
 * @returns {Promise<number | null>}
 */
async function scoreWithAi({ title, baseUrl, model }) {
  try {
    const response = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: SCORE_SYSTEM_PROMPT },
          { role: 'user', content: `Score this headline for reader interest: ${title}` },
        ],
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content ?? '';
    const score = parseScore(content);

    return score;
  } catch {
    return null;
  }
}

/**
 * Extracts a clamped 0-100 score from the AI response content.
 *
 * @param {string} content
 * @returns {number | null}
 */
function parseScore(content) {
  const cleaned = String(content ?? '').replace(/```json|```/gi, '').trim();
  const parsed = JSON.parse(cleaned);
  const score = Number(parsed?.score);

  if (!Number.isFinite(score)) {
    return null;
  }

  return Math.max(0, Math.min(100, score));
}

/**
 * Scores a headline with curated keyword bonuses and penalties.
 *
 * @param {string} title
 * @returns {number}
 */
function scoreByKeywords(title) {
  const normalized = String(title ?? '').toLowerCase();
  let score = 50;

  for (const keyword of POSITIVE_KEYWORDS) {
    if (normalized.includes(keyword)) {
      score += 10;
    }
  }

  for (const keyword of NEGATIVE_KEYWORDS) {
    if (normalized.includes(keyword)) {
      score -= 20;
    }
  }

  return Math.max(0, Math.min(100, score));
}
