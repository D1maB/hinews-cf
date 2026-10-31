import { getDueItems, markPublished } from './store.js';

/**
 * Publishes any scheduled items whose time has come.
 *
 * @param {Record<string, unknown>} env
 * @returns {Promise<{ published: number }>}
 */
export async function publishScheduled(env) {
  const due = await getDueItems(env.DB);

  for (const item of due) {
    console.log(`Published to social: ${item.title} (${item.url})`);
    await markPublished(env.DB, item.url);
  }

  console.log(`Published ${due.length} item(s) to social`);

  return { published: due.length };
}