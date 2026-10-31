import { ingestFeeds } from './ingest.js';
import { backfillScores, getLastSync, listItems } from './store.js';
import { groupItems } from './group.js';
import { renderPage } from './render.js';

/**
 * Renders the stored headlines, seeding the database on the first request.
 *
 * @param {Request} _request
 * @param {Record<string, unknown>} env
 * @returns {Promise<Response>}
 */
async function handleRequest(_request, env) {
  let items = await listItems(env.DB);

  if (items.length === 0) {
    const result = await ingestFeeds(env);
    items = result.items ?? items;
  }

  await backfillScores(env.DB);

  const lastSync = await getLastSync(env.DB);

  return new Response(renderPage(groupItems(items), items.length, lastSync), {
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
function handleScheduled(_controller, env, ctx) {
  ctx.waitUntil(ingestFeeds(env));
}

export default {
  fetch: handleRequest,
  scheduled: handleScheduled,
};