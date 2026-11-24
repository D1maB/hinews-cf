import type { SearchConfig, SearchProviderName } from './search.js';

const GEMINI_API_VERSION = 'v1beta';

/** Base URL of the Google Generative Language API used by Gemini. */
export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com';

/** Base URL of the OpenRouter chat completions API. */
export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';

/** Send a prompt to a provider and return the raw model response, or `null` on failure. */
export type SearchRequest = (prompt: string) => Promise<string | null>;

type ProviderRequest = (
  config: SearchConfig,
  prompt: string,
) => Promise<string | null>;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Send a prompt to Gemini via the Google Generative Language API. */
export async function requestGemini(
  config: SearchConfig,
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
        `Gemini search failed with HTTP ${response.status}: ${await response.text()}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      candidates?: Array<{
        content?: { parts?: Array<{ text?: string }> };
      }>;
    };
    return (
      data.candidates
        ?.flatMap((candidate) => candidate.content?.parts ?? [])
        .map((part) => part.text ?? '')
        .join('') ?? ''
    );
  } catch (error) {
    console.error('Gemini search failed:', errorMessage(error));
    return null;
  }
}

/** Send a prompt to OpenRouter chat completions with the web search plugin enabled. */
export async function requestOpenRouter(
  config: SearchConfig,
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
        plugins: [{ id: 'web' }],
      }),
    });

    if (!response.ok) {
      console.error(
        `OpenRouter search failed with HTTP ${response.status}: ${await response.text()}`,
      );
      return null;
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string | null } }>;
    };
    return data.choices?.[0]?.message?.content ?? '';
  } catch (error) {
    console.error('OpenRouter search failed:', errorMessage(error));
    return null;
  }
}

const PROVIDER_REQUESTS: Record<SearchProviderName, ProviderRequest> = {
  gemini: requestGemini,
  openrouter: requestOpenRouter,
};

/** Resolve the configured provider into a reusable search request (factory). */
export function createSearchProvider(config: SearchConfig): SearchRequest {
  const request = PROVIDER_REQUESTS[config.provider];
  return (prompt) => request(config, prompt);
}
