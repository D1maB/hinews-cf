import { DEFAULT_FEEDS } from '../src/feeds.ts';
import { searchNews } from '../src/search.ts';

const items = await searchNews(
  {
    SEARCH_PROVIDER: process.env.SEARCH_PROVIDER,
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    OPENROUTER_API_KEY: process.env.OPENROUTER_API_KEY,
    OPENROUTER_MODEL: process.env.OPENROUTER_MODEL,
    NEWS_ITEM_COUNT: process.env.NEWS_ITEM_COUNT,
  },
  DEFAULT_FEEDS,
);

console.log(JSON.stringify(items, null, 2));
