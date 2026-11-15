import { getDueItems, markPublished } from './store.js';

const TELEGRAM_API = 'https://api.telegram.org';
const BSKY_API = 'https://bsky.social';
const BSKY_POST_TEXT_LIMIT = 300;

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
 * @returns {Promise<void>}
 */
async function postToTelegram(env, item) {
  const enabled = isPublisherEnabled(env, 'TELEGRAM_ENABLED');
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!enabled) {
    return;
  }

  if (!token || !chatId) {
    return;
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

  if (text.length <= BSKY_POST_TEXT_LIMIT) {
    return text;
  }

  return text.slice(0, BSKY_POST_TEXT_LIMIT);
}

/**
 * Posts a single item to the authenticated Bluesky account. Does nothing when
 * the Bluesky handle or app password is not configured.
 *
 * @param {Record<string, unknown>} env
 * @param {{ title: string, description?: string | null, url: string }} item
 * @returns {Promise<void>}
 */
async function postToBluesky(env, item) {
  const enabled = isPublisherEnabled(env, 'BSKY_ENABLED');
  const handle = env.BSKY_HANDLE;
  const password = env.BSKY_APP_PASSWORD;

  if (!enabled) {
    return;
  }

  if (!handle || !password) {
    return;
  }

  const sessionResponse = await fetch(`${BSKY_API}/xrpc/app.bsky.actor.createSession`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ identifier: handle, password }),
  });

  if (!sessionResponse.ok) {
    const body = await sessionResponse.text();
    throw new Error(`Bluesky session creation failed (${sessionResponse.status}): ${body}`);
  }

  const session = await sessionResponse.json();

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
}

/**
 * Publishes any scheduled items whose time has come.
 *
 * @param {Record<string, unknown>} env
 * @returns {Promise<{ published: number }>}
 */
export async function publishScheduled(env) {
  const due = await getDueItems(env.DB);

  for (const item of due) {
    await postToTelegram(env, item).catch((err) => console.error('Telegram error:', err.message));
    await postToBluesky(env, item).catch((err) => console.error('Bluesky error:', err.message));
    await markPublished(env.DB, item.url);
  }

  console.log(`Published ${due.length} item(s) to social`);

  return { published: due.length };
}
