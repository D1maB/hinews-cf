import { getDueItems, markPublished } from './store.js';
import { truncateToSentence } from './feeds.js';

const TELEGRAM_API = 'https://api.telegram.org';
const BSKY_API = 'https://bsky.social';
const BSKY_POST_TEXT_LIMIT = 300;
const BSKY_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

let bskSession: any = null;

function isPublisherEnabled(env: any, key: string): boolean {
  const value = env[key];
  return value === true || value === 'true';
}

async function postToTelegram(env: any, item: any): Promise<boolean> {
  const enabled = isPublisherEnabled(env, 'TELEGRAM_ENABLED');
  const token = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!enabled || !token || !chatId) return false;

  const text = item.description
    ? `${item.title}\n\n${item.description}\n\n${item.url}`
    : `${item.title}\n\n${item.url}`;
  const response = await fetch(`${TELEGRAM_API}/bot${token}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text,
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
  return true;
}

function buildBlueskyText(item: any): string {
  const text = item.description
    ? `${item.title}\n\n${item.description}\n\n${item.url}`
    : `${item.title}\n\n${item.url}`;
  return truncateToSentence(text, BSKY_POST_TEXT_LIMIT);
}

async function postToBluesky(env: any, item: any): Promise<boolean> {
  const enabled = isPublisherEnabled(env, 'BSKY_ENABLED');
  const handle = env.BSKY_HANDLE;
  const password = env.BSKY_APP_PASSWORD;

  if (!enabled || !handle || !password) return false;

  let session = bskSession;

  if (!session || session.expiresAt <= Date.now()) {
    const sessionResponse = await fetch(
      `${BSKY_API}/xrpc/app.bsky.actor.createSession`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ identifier: handle, password }),
      },
    );

    if (!sessionResponse.ok) {
      const body = await sessionResponse.text();
      throw new Error(
        `Bluesky session creation failed (${sessionResponse.status}): ${body}`,
      );
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

async function publishToSocials(env: any, item: any): Promise<boolean> {
  const results = await Promise.allSettled([
    postToTelegram(env, item),
    postToBluesky(env, item),
  ]);
  return results.some(
    (result) => result.status === 'fulfilled' && result.value === true,
  );
}

export async function publishScheduled(
  env: any,
): Promise<{ published: number }> {
  const due = await getDueItems(env.DB);
  let publishedCount = 0;

  for (const item of due) {
    const published = await publishToSocials(env, item);
    if (published) {
      const changed = await markPublished(env.DB, item.url);
      if (changed > 0) publishedCount += 1;
    }
  }

  console.log(`Published ${publishedCount} item(s) to social`);
  return { published: publishedCount };
}
