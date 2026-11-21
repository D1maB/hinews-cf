export const MIN_SCORE = 60;

const DEFAULT_SCORE_BASE_URL = 'https://api.openai.com';
const DEFAULT_SCORE_MODEL = 'gpt-4o-mini';
const SCORE_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 2;

const SCORE_SYSTEM_PROMPT =
  'You rate how relevant a news headline is to a PC hardware and gaming audience on a 0-100 scale. Respond with only a JSON object like {"score": 73}.';

export interface ScoreConfig {
  baseUrl: string;
  model: string;
  apiKey?: string;
}

export interface ScoreEnv {
  SCORE_BASE_URL?: string;
  SCORE_MODEL?: string;
  SCORE_API_KEY?: string;
}

/** Read scoring configuration, applying defaults and validating non-empty values. */
export function getScoreOptions(env: ScoreEnv = {}): ScoreConfig {
  const baseUrl = (env.SCORE_BASE_URL || DEFAULT_SCORE_BASE_URL).trim();
  const model = (env.SCORE_MODEL || DEFAULT_SCORE_MODEL).trim();
  const apiKey = env.SCORE_API_KEY?.trim();
  if (!baseUrl) {
    throw new Error('SCORE_BASE_URL must not be empty');
  }
  if (!model) {
    throw new Error('SCORE_MODEL must not be empty');
  }
  return {
    baseUrl,
    model,
    ...(apiKey ? { apiKey } : {}),
  };
}

/**
 * Score a headline, retrying transient failures.
 * Returns `null` when no provider is configured or every attempt fails.
 */
export async function scoreTitle(
  title: string,
  options: Partial<ScoreConfig> = {},
  retries = DEFAULT_RETRIES,
): Promise<number | null> {
  if (!options.baseUrl || !options.model) {
    return null;
  }
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const score = await scoreWithAi({
      title,
      baseUrl: options.baseUrl,
      model: options.model,
      apiKey: options.apiKey,
    });
    if (score !== null) return score;
  }
  return null;
}

async function scoreWithAi({
  title,
  baseUrl,
  model,
  apiKey,
}: ScoreConfig & { title: string }): Promise<number | null> {
  try {
    const headers: Record<string, string> = {
      'content-type': 'application/json',
    };
    if (apiKey) {
      headers.authorization = `Bearer ${apiKey}`;
    }

    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`,
      {
        method: 'POST',
        headers,
        signal: AbortSignal.timeout(SCORE_TIMEOUT_MS),
        body: JSON.stringify({
          model,
          messages: [
            { role: 'system', content: SCORE_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Score this headline for reader interest: ${title}`,
            },
          ],
        }),
      },
    );

    if (!response.ok) {
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content ?? '';
    return parseScore(content);
  } catch {
    return null;
  }
}

function parseScore(content: string): number | null {
  try {
    const cleaned = String(content ?? '')
      .replace(/```json|```/gi, '')
      .trim();
    const parsed = JSON.parse(cleaned) as { score?: unknown };
    const score = Number(parsed.score);

    if (!Number.isFinite(score)) {
      return null;
    }

    return Math.max(0, Math.min(100, score));
  } catch {
    return null;
  }
}
