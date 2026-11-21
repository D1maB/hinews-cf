import { getFeeds } from './feeds.js';
import { listItems, getLastSync, backfillScores, deletePublished } from './store.js';
import { ingestFeeds } from './ingest.js';
import { getScoreOptions } from './score.js';
import { renderPage } from './render.js';
import { publishScheduled } from './publish.js';

function sortByScheduled(items: any[]): any[] {
  return [...items].sort((a, b) => (a.scheduled_at || '').localeCompare(b.scheduled_at || ''));
}

async function handleRequest(_request: Request, env: Record<string, unknown>): Promise<Response> {
  const feeds = getFeeds(env);
  const items = await listItems(env.DB as any);
  const lastSync = await getLastSync(env.DB as any);
  const allItems = sortByScheduled(items);
  return new Response(renderPage(feeds, items.length, lastSync, allItems), {
    headers: { 'content-type': 'text/html;charset=UTF-8' },
  });
}

async function runScheduledIngestion(env: Record<string, unknown>) {
  const result = await ingestFeeds(env);
  await backfillScores(env.DB as any, getScoreOptions(env));
  return result;
}

function handleScheduled(controller: any, env: Record<string, unknown>, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
  const cron = controller?.cron ?? '';
  switch (cron) {
    case '* * * * *':
      ctx.waitUntil(publishScheduled(env));
      break;
    case '0 0 */7 * *':
      ctx.waitUntil(deletePublished(env.DB as any));
      break;
    default:
      ctx.waitUntil(runScheduledIngestion(env));
      break;
  }
}

export default {
  async fetch(request: Request, env: Record<string, unknown>): Promise<Response> {
    return handleRequest(request, env);
  },
  async scheduled(controller: any, env: Record<string, unknown>, ctx: { waitUntil: (p: Promise<unknown>) => void }) {
    handleScheduled(controller, env, ctx);
  },
};
