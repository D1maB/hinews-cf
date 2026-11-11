import { getDueItems, markPublished } from './store.js';

const TELEGRAM_API = 'https://api.telegram.org';

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
 * Publishes any scheduled items whose time has come.
 *
 * @param {Record<string, unknown>} env
 * @returns {Promise<{ published: number }>}
 */
export async function publishScheduled(env) {
  const due = await getDueItems(env.DB);

  for (const item of due) {
    await postToTelegram(env, item).catch((err) => console.error('Telegram error:', err.message));
    await markPublished(env.DB, item.url);
  }

  console.log(`Published ${due.length} item(s) to social`);

  return { published: due.length };
}
