import { DEFAULT_FEEDS } from '../src/feeds.ts';
import { searchNews } from '../src/search.ts';

const items = await searchNews(
  {
    GEMINI_API_KEY: process.env.GEMINI_API_KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL,
    GEMINI_BASE_URL: process.env.GEMINI_BASE_URL,
    NEWS_ITEM_COUNT: process.env.NEWS_ITEM_COUNT,
  },
  DEFAULT_FEEDS,
);

console.log(JSON.stringify(items, null, 2));
