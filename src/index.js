import { ingestFeeds } from './ingest.js';
import { publishScheduled } from './publish.js';
import { backfillScores, clearItems, createFeed, createItem, deleteFeed, deleteItem, getLastSync, listFeeds, listItems, updateFeed } from './store.js';
import { sortByScheduled } from './group.js';
import { renderPage } from './render.js';
import { ADMIN_HTML } from './admin.js';
import { getFeeds } from './feeds.js';

const ADMIN_TOKEN_HEADER = 'x-admin-token';

/**
 * Renders the stored headlines, seeding the database on the first request.
 *
 * @param {Request} _request
 * @param {Record<string, unknown>} env
 * @returns {Promise<Response>}
 */
async function handleRequest(request, env) {
  const url = new URL(request.url);

  if (url.pathname.startsWith('/api/')) {
    return handleAdminApi(request, env, url);
  }

  if (url.pathname === '/admin') {
    return new Response(ADMIN_HTML, { headers: { 'content-type': 'text/html;charset=UTF-8' } });
  }

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
 * Handles the token protected admin API.
 *
 * @param {Request} request
 * @param {Record<string, unknown>} env
 * @param {URL} url
 * @returns {Promise<Response>}
 */
async function handleAdminApi(request, env, url) {
  if (request.method === 'POST' && url.pathname === '/api/login') {
    const body = await readJson(request);
    const expectedToken = typeof env.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : '';

    if (body?.token === expectedToken) {
      return jsonResponse({ ok: true });
    }

    return jsonResponse({ ok: false }, 401);
  }

  if (!isAdminRequestAuthorized(env, request)) {
    return jsonResponse({ error: 'Unauthorized' }, 401);
  }

  if (request.method === 'GET' && url.pathname === '/api/feeds') {
    const feeds = await listFeeds(env.DB);
    return jsonResponse({ feeds });
  }

  if (request.method === 'POST' && url.pathname === '/api/feeds') {
    const feed = await readJson(request);

    if (!feed?.id || !feed?.name || !feed?.url) {
      return jsonResponse({ error: 'Invalid feed' }, 400);
    }

    await createFeed(env.DB, feed);
    return jsonResponse({ ok: true });
  }

  const feedMatch = /^\/api\/feeds\/([^/]+)$/.exec(url.pathname);

  if (feedMatch) {
    const id = feedMatch[1];

    if (request.method === 'PUT') {
      const feed = await readJson(request);
      await updateFeed(env.DB, id, feed);
      return jsonResponse({ ok: true });
    }

    if (request.method === 'DELETE') {
      await deleteFeed(env.DB, id);
      return jsonResponse({ ok: true });
    }
  }

  if (request.method === 'GET' && url.pathname === '/api/items') {
    const items = await listItems(env.DB);
    return jsonResponse({ items });
  }

  if (request.method === 'POST' && url.pathname === '/api/items') {
    const item = await readJson(request);

    if (!item?.title || !item?.url) {
      return jsonResponse({ error: 'Invalid item' }, 400);
    }

    await createItem(env.DB, item);
    return jsonResponse({ ok: true });
  }

  if (request.method === 'DELETE' && url.pathname === '/api/items') {
    const urlParam = url.searchParams.get('url');

    if (!urlParam) {
      return jsonResponse({ error: 'Missing url' }, 400);
    }

    await deleteItem(env.DB, urlParam);
    return jsonResponse({ ok: true });
  }

  return jsonResponse({ error: 'Not found' }, 404);
}

/**
 * Checks the admin token sent by the admin client.
 *
 * @param {Record<string, unknown>} env
 * @param {Request} request
 * @returns {boolean}
 */
function isAdminRequestAuthorized(env, request) {
  const token = typeof env.ADMIN_TOKEN === 'string' ? env.ADMIN_TOKEN : '';
  const provided = request.headers.get(ADMIN_TOKEN_HEADER);

  return token.length > 0 && provided === token;
}

/**
 * Reads a JSON request body.
 *
 * @param {Request} request
 * @returns {Promise<Record<string, unknown>>}
 */
async function readJson(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

/**
 * Builds a JSON response.
 *
 * @param {unknown} data
 * @param {number} [status]
 * @returns {Response}
 */
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json' } });
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
