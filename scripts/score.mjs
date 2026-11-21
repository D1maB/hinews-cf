import { getScoreOptions, scoreTitle } from '../src/score.js';

const title = process.argv[2];

if (!title) {
  console.error('Usage: node scripts/score.mjs "Headline text"');
  process.exit(1);
}

const options = getScoreOptions({ SCORE_BASE_URL: process.env.SCORE_BASE_URL, SCORE_MODEL: process.env.SCORE_MODEL });
const score = await scoreTitle(title, options);

console.log(score);
