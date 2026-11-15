import { getDueItems, markPublished } from './store.js';
import { truncateToSentence } from './feeds.js';

const TELEGRAM_API = 'https://api.telegram.org';
const BSKY_API = 'https://bsky.social';
const BSKY_POST_TEXT_LIMIT = 300;
const BSKY_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

let bskSession = null;

/**
 * Returns whether the publisher with the given environment flag is enabled.
 *
 * @param {Record<string, unknown>} env
 * @param {string} key
 * @returns {boolean}
 */
function isPublisherEnabled(env, key) {
  const value = env[key];
  return value === true || value === 'true';
}

/**
 * Posts a single item to the configured Telegram channel.
 *
 * @param {Record<string, unknown>} env
 * @param {{ title: string, url: string }} item
 * @returns {Promise<boolean>}
 */
async function postToTelegram(env, item) {
  const enabled = isPublisherEnabled(env, 'TELEGRAM_ENABLED');
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!enabled) {
    return false;
  }

  if (!token || !chatId) {
    return false;
  }

  const text = item.description
    ? `${item.title}\n\n${item.description}\n\n${item.url}`
    : `${item.title}\n\n${item.url}`;
  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: false }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Telegram sendMessage failed (${response.status}): ${body}`);
  }

  console.log(`Published to Telegram: ${item.title} (${item.url})`);

  return true;
}

/**
 * Builds the Bluesky post text for an item, staying within the 300 character limit.
 *
 * @param {{ title: string, description?: string | null, url: string }} item
 * @returns {string}
 */
function buildBlueskyText(item) {
  const text = item.description
    ? `${item.title}\n\n${item.description}\n\n${item.url}`
    : `${item.title}\n\n${item.url}`;

  return truncateToSentence(text, BSKY_POST_TEXT_LIMIT);
}

/**
 * Posts a single item to the authenticated Bluesky account. Does nothing when
 * the Bluesky handle or app password is not configured.
 *
 * @param {Record<string, unknown>} env
 * @param {{ title: string, description?: string | null, url: string }} item
 * @returns {Promise<boolean>}
 */
async function postToBluesky(env, item) {
  const enabled = isPublisherEnabled(env, 'BSKY_ENABLED');
  const handle = env.BSKY_HANDLE;
  const password = env.BSKY_APP_PASSWORD;

  if (!enabled) {
    return false;
  }

  if (!handle || !password) {
    return false;
  }

  let session = bskSession;

  if (!session || session.expiresAt <= Date.now()) {
    const sessionResponse = await fetch(`${BSKY_API}/xrpc/app.bsky.actor.createSession`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ identifier: handle, password }),
    });

    if (!sessionResponse.ok) {
      const body = await sessionResponse.text();
      throw new Error(`Bluesky session creation failed (${sessionResponse.status}): ${body}`);
    }

    const created = await sessionResponse.json();
    session = {
      accessJwt: created.accessJwt,
      refreshJwt: created.refreshJwt,
      expiresAt: Date.now() + BSKY_SESSION_TTL_MS,
    };
    bskSession = session;
  }

  const response = await fetch(`${BSKY_API}/xrpc/app.bsky.feed.post`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${session.accessJwt}`,
    },
    body: JSON.stringify({ text: buildBlueskyText(item) }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Bluesky post failed (${response.status}): ${body}`);
  }

  console.log(`Published to Bluesky: ${item.title} (${item.url})`);

  return true;
}

/**
 * Publishes an item to every enabled social platform, returning whether at
 * least one platform accepted the post.
 *
 * @param {Record<string, unknown>} env
 * @param {{ title: string, url: string }} item
 * @returns {Promise<boolean>}
 */
async function publishToSocials(env, item) {
  const results = await Promise.allSettled([
    postToTelegram(env, item),
    postToBluesky(env, item),
  ]);

  return results.some((result) => result.status === 'fulfilled' && result.value === true);
}

/**
 * Publishes any scheduled items whose time has come.
 *
 * @param {Record<string, unknown>} env
 * @returns {Promise<{ published: number }>}
 */
export async function publishScheduled(env) {
  const due = await getDueItems(env.DB);
  let publishedCount = 0;

  for (const item of due) {
    const published = await publishToSocials(env, item);

    if (published) {
      await markPublished(env.DB, item.url);
      publishedCount += 1;
    }
  }

  console.log(`Published ${publishedCount} item(s) to social`);

  return { published: publishedCount };
}
