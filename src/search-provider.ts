import type { SearchConfig, SearchProviderName } from './search.js';

const GEMINI_API_VERSION = 'v1beta';

/** A model provider capable of running the news web search. */
export interface SearchProvider {
  readonly name: SearchProviderName;
  /** Send the prompt and return the raw model response, or `null` on failure. */
  request(prompt: string): Promise<string | null>;
}

function withoutTrailingSlash(value: string): string {
  return value.replace(/\/+$/, '');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Gemini via the Google Generative Language API. */
export class GeminiSearchProvider implements SearchProvider {
  readonly name = 'gemini' as const;

  constructor(private readonly config: SearchConfig) {}

  async request(prompt: string): Promise<string | null> {
    try {
      const model = this.config.model.replace(/^models\//, '');
      const response = await fetch(
        `${withoutTrailingSlash(this.config.baseUrl)}/${GEMINI_API_VERSION}/models/${encodeURIComponent(model)}:generateContent`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-goog-api-key': this.config.apiKey,
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
}

/** OpenRouter chat completions with the web search plugin enabled. */
export class OpenRouterSearchProvider implements SearchProvider {
  readonly name = 'openrouter' as const;

  constructor(private readonly config: SearchConfig) {}

  async request(prompt: string): Promise<string | null> {
    try {
      const response = await fetch(
        `${withoutTrailingSlash(this.config.baseUrl)}/chat/completions`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            authorization: `Bearer ${this.config.apiKey}`,
          },
          body: JSON.stringify({
            model: this.config.model,
            messages: [{ role: 'user', content: prompt }],
            plugins: [{ id: 'web' }],
          }),
        },
      );

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
}

/** Create the configured search provider (factory). */
export function createSearchProvider(config: SearchConfig): SearchProvider {
  switch (config.provider) {
    case 'gemini':
      return new GeminiSearchProvider(config);
    case 'openrouter':
      return new OpenRouterSearchProvider(config);
  }
}
