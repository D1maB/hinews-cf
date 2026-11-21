import { getScoreOptions, scoreTitle } from '../src/score.ts';

const title = process.argv[2];

if (!title) {
  console.error('Usage: npx tsx scripts/score.ts "Headline text"');
  process.exit(1);
}

const options = getScoreOptions({
  SCORE_BASE_URL: process.env.SCORE_BASE_URL,
  SCORE_MODEL: process.env.SCORE_MODEL,
  SCORE_API_KEY: process.env.SCORE_API_KEY,
});
const score = await scoreTitle(title, options);

console.log(score);
