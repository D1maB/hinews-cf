import { getFeeds } from './feeds.js';
import {
  listItems,
  getLastSync,
  backfillScores,
  deletePublished,
} from './store.js';
import { ingestFeeds } from './ingest.js';
import { getScoreOptions } from './score.js';
import { renderPage } from './render.js';
import { publishScheduled } from './publish.js';
import type { Env, StoredItem } from './types.js';

function sortByScheduled(items: StoredItem[]): StoredItem[] {
  return [...items].sort((a, b) =>
    (a.scheduled_at ?? '').localeCompare(b.scheduled_at ?? ''),
  );
}

async function handleRequest(env: Env): Promise<Response> {
  try {
    const feeds = getFeeds(env);
    const items = await listItems(env.DB);
    const lastSync = await getLastSync(env.DB);
    const allItems = sortByScheduled(items);
    return new Response(renderPage(feeds, items.length, lastSync, allItems), {
      headers: { 'content-type': 'text/html;charset=UTF-8' },
    });
  } catch (error) {
    console.error('Request handling failed', error);
    return new Response('Internal Server Error', { status: 500 });
  }
}

async function runScheduledIngestion(env: Env) {
  const result = await ingestFeeds(env);
  await backfillScores(env.DB, getScoreOptions(env));
  return result;
}

function handleScheduled(
  controller: ScheduledController,
  env: Env,
  ctx: ExecutionContext,
) {
  switch (controller.cron) {
    case '* * * * *':
      ctx.waitUntil(publishScheduled(env));
      break;
    case '0 0 */7 * *':
      ctx.waitUntil(deletePublished(env.DB));
      break;
    default:
      ctx.waitUntil(
        runScheduledIngestion(env).catch((error: unknown) => {
          console.error('Scheduled ingestion failed', error);
          throw error;
        }),
      );
      break;
  }
}

export default {
  async fetch(_request: Request, env: Env): Promise<Response> {
    return handleRequest(env);
  },
  async scheduled(
    controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    handleScheduled(controller, env, ctx);
  },
} satisfies ExportedHandler<Env>;
