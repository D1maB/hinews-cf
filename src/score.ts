export const MIN_SCORE = 60;

const DEFAULT_SCORE_BASE_URL = 'https://api.openai.com';
const DEFAULT_SCORE_MODEL = 'gpt-4o-mini';

const SCORE_SYSTEM_PROMPT =
  'You rate how relevant a news headline is to a PC hardware and gaming audience on a 0-100 scale. Respond with only a JSON object like {"score": 73}.';

export interface ScoreOptions {
  baseUrl?: string;
  model?: string;
  SCORE_BASE_URL?: string;
  SCORE_MODEL?: string;
}

export function getScoreOptions(env: Record<string, unknown> = {}): {
  baseUrl: string;
  model: string;
} {
  const baseUrl = (
    (env?.SCORE_BASE_URL as string) || DEFAULT_SCORE_BASE_URL
  ).trim();
  const model = ((env?.SCORE_MODEL as string) || DEFAULT_SCORE_MODEL).trim();
  if (!baseUrl) {
    throw new Error('SCORE_BASE_URL must not be empty');
  }
  if (!model) {
    throw new Error('SCORE_MODEL must not be empty');
  }
  return { baseUrl, model };
}

export async function scoreTitle(
  title: string,
  options: { baseUrl?: string; model?: string } = {},
  retries = 2,
): Promise<number | null> {
  if (!options.baseUrl || !options.model) {
    return null;
  }
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const score = await scoreWithAi({
      title,
      baseUrl: options.baseUrl,
      model: options.model,
    });
    if (score !== null) return score;
  }
  return null;
}

async function scoreWithAi({
  title,
  baseUrl,
  model,
}: {
  title: string;
  baseUrl: string;
  model: string;
}): Promise<number | null> {
  try {
    const response = await fetch(
      `${baseUrl.replace(/\/+$/, '')}/v1/chat/completions`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
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
    const content = data?.choices?.[0]?.message?.content ?? '';
    return parseScore(content);
  } catch {
    return null;
  }
}

function parseScore(content: string): number | null {
  const cleaned = String(content ?? '')
    .replace(/```json|```/gi, '')
    .trim();
  const parsed = JSON.parse(cleaned);
  const score = Number(parsed?.score);

  if (!Number.isFinite(score)) {
    return null;
  }

  return Math.max(0, Math.min(100, score));
}
