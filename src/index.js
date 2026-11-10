import { ingestFeeds } from './ingest.js';
import { publishScheduled } from './publish.js';
import { backfillScores, clearItems, getLastSync, listItems } from './store.js';
import { sortByScheduled } from './group.js';
import { renderPage } from './render.js';
import { getFeeds } from './feeds.js';

/**
 * Renders the stored headlines, seeding the database on the first request.
 *
 * @param {Request} _request
 * @param {Record<string, unknown>} env
 * @returns {Promise<Response>}
 */
async function handleRequest(_request, env) {
  const feeds = getFeeds(env);
  let items = await listItems(env.DB);

  if (items.length === 0) {
    const result = await ingestFeeds(env);
    items = result.items ?? items;
  }

  await backfillScores(env.DB);

  const lastSync = await getLastSync(env.DB);

  const allItems = sortByScheduled(items);

  return new Response(renderPage(feeds, items.length, lastSync, allItems), {
    headers: { 'content-type': 'text/html;charset=UTF-8' },
  });
}

/**
 * Refreshes the database every 12 hours.
 *
 * @param {ScheduledController} _controller
 * @param {Record<string, unknown>} env
 * @param {ExecutionContext} ctx
 */
function handleScheduled(controller, env, ctx) {
  const cron = controller?.cron ?? '';

  switch (cron) {
    case '* * * * *':
      ctx.waitUntil(publishScheduled(env));
      break;
    default:
      ctx.waitUntil(clearItems(env.DB).then(() => ingestFeeds(env)));
      break;
  }
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
};