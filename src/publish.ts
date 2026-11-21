import { getDueItems, markPublished, markTargetPublished } from './store.js';
import { truncateToSentence } from './feeds.js';
import type { Env, PublishTarget, StoredItem } from './types.js';

const TELEGRAM_API = 'https://api.telegram.org';
const BSKY_API = 'https://bsky.social';
const BSKY_POST_TEXT_LIMIT = 300;
const BSKY_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const PUBLISH_TIMEOUT_MS = 10_000;

interface BskySession {
  accessJwt: string;
  refreshJwt: string;
  expiresAt: number;
}

let bskSession: BskySession | null = null;

function isPublisherEnabled(
  env: Env,
  key: 'TELEGRAM_ENABLED' | 'BSKY_ENABLED',
): boolean {
  const value = env[key];
  return value === true || value === 'true';
}

function isPublishedTo(item: StoredItem, target: PublishTarget): boolean {
  return target === 'telegram'
    ? Number(item.telegram_published) === 1
    : Number(item.bsky_published) === 1;
}

/** Destinations that are enabled and fully configured. */
function enabledTargets(env: Env): PublishTarget[] {
  const targets: PublishTarget[] = [];

  if (isPublisherEnabled(env, 'TELEGRAM_ENABLED')) {
    if (env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      targets.push('telegram');
    } else {
      console.error(
        'Telegram publishing is enabled but TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID is missing',
      );
    }
  }

  if (isPublisherEnabled(env, 'BSKY_ENABLED')) {
    if (env.BSKY_HANDLE && env.BSKY_APP_PASSWORD) {
      targets.push('bluesky');
    } else {
      console.error(
        'Bluesky publishing is enabled but BSKY_HANDLE or BSKY_APP_PASSWORD is missing',
      );
    }
  }

  return targets;
}

function buildPostText(item: StoredItem): string {
  return item.description
    ? `${item.title}\n\n${item.description}\n\n${item.url}`
    : `${item.title}\n\n${item.url}`;
}

async function postToTelegram(env: Env, item: StoredItem): Promise<void> {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    throw new Error('Telegram is not configured');
  }

  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    body: JSON.stringify({
      chat_id: chatId,
      text: buildPostText(item),
      disable_web_page_preview: false,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Telegram sendMessage failed (${response.status}): ${body}`,
    );
  }

  console.log(`Published to Telegram: ${item.title} (${item.url})`);
}

function buildBlueskyText(item: StoredItem): string {
  return truncateToSentence(buildPostText(item), BSKY_POST_TEXT_LIMIT);
}

async function getBlueskySession(env: Env): Promise<BskySession> {
  if (bskSession && bskSession.expiresAt > Date.now()) {
    return bskSession;
  }

  const response = await fetch(
    `${BSKY_API}/xrpc/app.bsky.actor.createSession`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
      body: JSON.stringify({
        identifier: env.BSKY_HANDLE,
        password: env.BSKY_APP_PASSWORD,
      }),
    },
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `Bluesky session creation failed (${response.status}): ${body}`,
    );
  }

  const created = (await response.json()) as {
    accessJwt?: string;
    refreshJwt?: string;
  };
  if (!created.accessJwt || !created.refreshJwt) {
    throw new Error('Bluesky session response did not include tokens');
  }

  bskSession = {
    accessJwt: created.accessJwt,
    refreshJwt: created.refreshJwt,
    expiresAt: Date.now() + BSKY_SESSION_TTL_MS,
  };
  return bskSession;
}

async function postToBluesky(env: Env, item: StoredItem): Promise<void> {
  const session = await getBlueskySession(env);
  const response = await fetch(`${BSKY_API}/xrpc/app.bsky.feed.post`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.accessJwt}`,
    },
    signal: AbortSignal.timeout(PUBLISH_TIMEOUT_MS),
    body: JSON.stringify({ text: buildBlueskyText(item) }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Bluesky post failed (${response.status}): ${body}`);
  }

  console.log(`Published to Bluesky: ${item.title} (${item.url})`);
}

/**
 * Publish due items to every enabled destination.
 *
 * Each destination is recorded independently, so a retry only reposts to the
 * destinations that have not succeeded yet. An item is marked `published`
 * once every enabled destination has accepted it.
 */
export async function publishScheduled(
  env: Env,
): Promise<{ published: number }> {
  const due = await getDueItems(env.DB);
  const targets = enabledTargets(env);

  if (targets.length === 0) {
    if (due.length > 0) {
      console.error('No publishing destination is enabled or configured');
    }
    return { published: 0 };
  }

  let publishedCount = 0;

  for (const item of due) {
    let allSucceeded = true;

    for (const target of targets) {
      if (isPublishedTo(item, target)) continue;

      try {
        if (target === 'telegram') {
          await postToTelegram(env, item);
        } else {
          await postToBluesky(env, item);
        }
        await markTargetPublished(env.DB, item.url, target);
        if (target === 'telegram') {
          item.telegram_published = 1;
        } else {
          item.bsky_published = 1;
        }
      } catch (error) {
        allSucceeded = false;
        console.error(
          `Failed to publish ${item.url} to ${target}:`,
          error instanceof Error ? error.message : error,
        );
      }
    }

    if (allSucceeded) {
      const changed = await markPublished(env.DB, item.url);
      if (changed > 0) publishedCount += 1;
    }
  }

  console.log(`Published ${publishedCount} item(s) to social`);
  return { published: publishedCount };
}
