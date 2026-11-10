export const ADMIN_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>News Admin</title>
  <style>
    body { font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; margin: 2rem; color: #1f2937; }
    h1 { font-size: 1.5rem; }
    h2 { font-size: 1.15rem; margin-top: 2rem; }
    form { display: flex; flex-direction: column; gap: 0.5rem; max-width: 40rem; margin-top: 1rem; }
    input, textarea { padding: 0.5rem; font: inherit; }
    table { width: 100%; border-collapse: collapse; margin-top: 1rem; }
    th, td { border: 1px solid #e5e7eb; padding: 0.5rem; text-align: left; font-size: 0.85rem; }
    th { background: #f6f7f9; }
  </style>
</head>
<body>
  <div id="app">
    <h1>News Admin</h1>
    <div v-if="!loggedIn">
      <h2>Login</h2>
      <form @submit.prevent="login">
        <input v-model="token" placeholder="Admin token" type="password" />
        <button type="submit">Login</button>
      </form>
    </div>
    <div v-if="loggedIn">
      <h2>Feeds</h2>
      <table>
        <thead>
          <tr><th>ID</th><th>Name</th><th>URL</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="feed in feeds" :key="feed.id">
            <td>{{ feed.id }}</td>
            <td>{{ feed.name }}</td>
            <td>{{ feed.url }}</td>
            <td><button type="button" @click="removeFeed(feed)">Delete</button></td>
          </tr>
        </tbody>
      </table>
      <form @submit.prevent="saveFeed">
        <input v-model="newFeed.id" placeholder="id" />
        <input v-model="newFeed.name" placeholder="name" />
        <input v-model="newFeed.url" placeholder="url" />
        <button type="submit">Add Feed</button>
      </form>

      <h2>Items</h2>
      <table>
        <thead>
          <tr><th>Feed</th><th>Title</th><th>URL</th><th>Scheduled</th><th></th></tr>
        </thead>
        <tbody>
          <tr v-for="item in items" :key="item.url">
            <td>{{ item.feed_name }}</td>
            <td>{{ item.title }}</td>
            <td>{{ item.url }}</td>
            <td>{{ item.scheduled_at }}</td>
            <td><button type="button" @click="removeItem(item)">Delete</button></td>
          </tr>
        </tbody>
      </table>
      <form @submit.prevent="saveItem">
        <input v-model="newItem.feedId" placeholder="feedId" />
        <input v-model="newItem.feedName" placeholder="feedName" />
        <input v-model="newItem.title" placeholder="title" />
        <input v-model="newItem.url" placeholder="url" />
        <input v-model="newItem.publishedAt" placeholder="publishedAt" />
        <input v-model="newItem.score" placeholder="score" type="number" />
        <button type="submit">Add Item</button>
      </form>
    </div>
  </div>
  <script type="module">
    import { createApp, ref } from 'https://unpkg.com/vue@3/dist/vue.esm-browser.js';

    const API = '/api';
    const TOKEN_KEY = 'admin-token';

    const token = ref(localStorage.getItem(TOKEN_KEY) || '');
    const loggedIn = ref(false);
    const feeds = ref([]);
    const items = ref([]);
    const newFeed = ref({ id: '', name: '', url: '' });
    const newItem = ref({ feedId: '', feedName: '', title: '', url: '', publishedAt: '', score: 50 });

    function authHeaders() {
      const headers = { 'content-type': 'application/json' };
      if (token.value) {
        headers['x-admin-token'] = token.value;
      }
      return headers;
    }

    async function apiFetch(path, options) {
      const response = await fetch(path, Object.assign({}, options, { headers: authHeaders() }));
      if (response.status === 401) {
        loggedIn.value = false;
        localStorage.removeItem(TOKEN_KEY);
      }
      return response;
    }

    async function loadFeeds() {
      const response = await apiFetch(API + '/feeds');
      if (!response.ok) { return; }
      const data = await response.json();
      feeds.value = data.feeds || [];
    }

    async function loadItems() {
      const response = await apiFetch(API + '/items');
      if (!response.ok) { return; }
      const data = await response.json();
      items.value = data.items || [];
    }

    async function login() {
      const response = await fetch(API + '/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: token.value }),
      });
      if (response.ok) {
        localStorage.setItem(TOKEN_KEY, token.value);
        loggedIn.value = true;
        await loadFeeds();
        await loadItems();
      }
    }

    async function saveFeed() {
      const response = await apiFetch(API + '/feeds', {
        method: 'POST',
        body: JSON.stringify(newFeed.value),
      });
      if (response.ok) {
        newFeed.value = { id: '', name: '', url: '' };
        await loadFeeds();
      }
    }

    async function removeFeed(feed) {
      const response = await apiFetch(API + '/feeds/' + encodeURIComponent(feed.id), { method: 'DELETE' });
      if (response.ok) { await loadFeeds(); }
    }

    async function saveItem() {
      const response = await apiFetch(API + '/items', {
        method: 'POST',
        body: JSON.stringify(newItem.value),
      });
      if (response.ok) { await loadItems(); }
    }

    async function removeItem(item) {
      const response = await apiFetch(API + '/items?url=' + encodeURIComponent(item.url), { method: 'DELETE' });
      if (response.ok) { await loadItems(); }
    }

    const app = createApp({
      setup() {
        return {
          token,
          loggedIn,
          feeds,
          items,
          newFeed,
          newItem,
          login,
          saveFeed,
          removeFeed,
          saveItem,
          removeItem,
          loadFeeds,
          loadItems,
        };
      },
    });
    app.mount('#app');
  </script>
</body>
</html>`;
