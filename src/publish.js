import { getDueItems, markPublished } from './store.js';

/**
 * Publishes any scheduled items whose time has come.
 *
 * @param {Record<string, unknown>} env
 * @returns {Promise<{ published: number }>}
 */
const TELEGRAM_API = 'https://api.telegram.org';
const TWITTER_API = 'https://api.twitter.com/2';

/**
 * Posts a single item to the configured Telegram channel.
 *
 * @param {Record<string, unknown>} env
 * @param {{ title: string, url: string }} item
 * @returns {Promise<void>}
 */
async function postToTelegram(env, item) {
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!token || !chatId) {
    return;
  }

  const text = `${item.title}\n${item.url}`;
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
 * Posts a single item to Twitter (X) using API v2.
 *
 * @param {Record<string, unknown>} env
 * @param {{ title: string, url: string }} item
 * @returns {Promise<void>}
 */
async function postToTwitter(env, item) {
  const bearerToken = env.TWITTER_BEARER_TOKEN;

  if (!bearerToken) {
    return;
  }

  const text = `${item.title}\n${item.url}`;
  const response = await fetch(`${TWITTER_API}/tweets`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${bearerToken}`,
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Twitter tweet failed (${response.status}): ${body}`);
  }

  console.log(`Published to Twitter: ${item.title} (${item.url})`);
}

export async function publishScheduled(env) {
  const due = await getDueItems(env.DB);

  for (const item of due) {
    await Promise.all([
      postToTelegram(env, item).catch((err) => console.error('Telegram error:', err.message)),
      postToTwitter(env, item).catch((err) => console.error('Twitter error:', err.message)),
    ]);
    await markPublished(env.DB, item.url);
  }

  console.log(`Published ${due.length} item(s) to social`);

  return { published: due.length };
}