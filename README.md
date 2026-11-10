# hinews-cf

A minimal [Cloudflare Worker](https://developers.cloudflare.com/workers/) that fetches
RSS feeds, parses them, stores new headlines in a D1 database, and
renders every stored item.

Local development reads feeds downloaded into local storage; production fetches them
from the remote sites. A cron trigger clears the database and refreshes it every 12 hours.

Everything — development, tests, and deployment — runs in Docker on Alpine. Docker is
the only supported runtime; no Node.js, Wrangler, or test runner is installed or run on
the host.

## Requirements

- Docker with the standalone `docker-compose` CLI
- A Cloudflare API token (only needed for deployment)

## Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

| Variable                | Purpose                                              |
| ----------------------- | ---------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | API token with the Edit Cloudflare Workers template   |
| `CLOUDFLARE_ACCOUNT_ID` | Optional, when the token can access multiple accounts |

`.env` is ignored by Git and Docker. `docker-compose` loads it automatically when run
from the repository root. Commit only `.env.example`.

## Run the app locally

The app runs entirely in Docker, so you do not need Node.js installed on the host.

1. Download the feeds into the local cache:

   ```bash
   docker-compose run --rm download-feeds
   ```

   The XML files are stored in the `feeds` Docker volume and read directly through
   Wrangler's static assets binding.

2. Build the image and start the worker in the background:

   ```bash
   docker-compose up -d --build app
   ```

   Startup applies the D1 migrations to the local database and then seeds it on the
   first request, so the page is populated immediately.

3. Open <http://localhost:8787>. The page lists every stored headline from the five
   feeds.

4. Follow the worker logs when needed:

   ```bash
   docker-compose logs -f app
   ```

5. Trigger the cron handler manually (local development only):

   ```bash
   curl "http://localhost:8787/__scheduled?cron=0+*/12+*+*+*"
   ```

6. Stop and remove the containers:

   ```bash
   docker-compose down
   ```

Source files are mounted into the container, so edits reload automatically. Re-run the
download command to refresh the local feed cache. `.env` is not needed for local
development; it is only required for deployment.

## Feeds

The feed list defaults to `src/feeds.js` and can be overridden by setting the
`FEEDS` environment variable to a JSON array of `{ id, name, url }` objects
(e.g. via Wrangler vars). Each run reads the latest ten items per feed and inserts
only URLs that are not stored yet.

In local development the worker reads `feeds/<id>.xml` from the mounted `feeds` volume
through Wrangler's static assets binding. When deployed there is no assets binding, so
the worker fetches the remote URLs configured for each feed.

## Database

Parsed items are stored in D1 (`items` table, defined in `migrations/`). The `url` column
is unique, so the same story is never inserted twice even though feeds are polled
repeatedly. The page reads all rows from the database, newest first by scheduled time, and renders them as a single list with a source note per item.

On every scheduled ingestion run the worker clears the `items` table before re-ingesting, and newly scheduled items are spread across a single 12-hour window using sequential random minute buckets.

Cron triggers run publishing every minute and ingestion every 12 hours in production. Locally,
`wrangler dev --test-scheduled` exposes the same handler at `/__scheduled`.

Local migrations are applied automatically when the `app` service starts. Applied data
lives in `.wrangler/` and persists until you remove it.

## Tests

Run the test suite in a one-off container:

```bash
docker-compose run --rm test
```

The tests use mocked feeds and an in-memory D1 stand-in. They cover parsing, storage,
URL deduplication, scheduled ingestion, full database rendering, and failing feeds.

## Deployment

1. Create the D1 database (once):

   ```bash
   docker-compose run --rm --entrypoint npx app wrangler d1 create hinews-cf
   ```

   Copy the returned `database_id` into `wrangler.toml`, replacing
   `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

2. Create an API token with the **Edit Cloudflare Workers** template and put it in
   `.env`.

3. Apply migrations and deploy:

   ```bash
   docker-compose run --rm deploy
   ```

   The deploy service applies remote migrations before running `wrangler deploy`.

The deployed worker has no static assets binding, so it fetches the feeds directly from
the remote sites, and the cron trigger refreshes the database every 12 hours.

To prefill the production database without waiting for the cron, run the deployed cron
handler manually from the Cloudflare dashboard.

## Project structure

```
.
├── docker/
│   └── Dockerfile              # Alpine image with glibc for workerd
├── migrations/                 # D1 schema migrations
├── scripts/download-feeds.mjs  # Downloads RSS XML into the feeds volume
├── src/feeds.js                # Feed list and RSS parsing service
├── src/ingest.js               # Parses feeds and stores new items
├── src/store.js                # D1 reads and deduplicating writes
├── src/index.js                # HTTP and scheduled entry points
├── test/                       # Unit tests and in-memory D1 helper
├── .dockerignore               # Build context exclusions (must stay at the context root)
├── .env.example                # Template for local secrets
├── docker-compose.yml          # App, test, deploy, and download services
├── wrangler.toml               # Production configuration (D1, cron, remote feeds)
├── wrangler.dev.toml           # Local configuration (assets binding and local D1)
└── AGENTS.md                   # Conventions for agents and contributors
```
