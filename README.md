# hinews-cf

A minimal [Cloudflare Worker](https://developers.cloudflare.com/workers/) that fetches
RSS feeds, parses them, scores headlines, stores new items in a D1 database, renders the
stored news, and publishes scheduled items to Telegram and Bluesky.

Local development reads feeds downloaded into local storage; production fetches them
from the remote sites. A cron trigger ingests feeds every 12 hours, publishes due items
every minute, and removes published items weekly.

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

| Variable                | Purpose                                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | API token with the Edit Cloudflare Workers template                                                |
| `CLOUDFLARE_ACCOUNT_ID` | Optional, when the token can access multiple accounts                                              |
| `BSKY_ENABLED`          | Set to `true` to publish headlines to Bluesky                                                      |
| `BSKY_HANDLE`           | Bluesky handle (e.g. user.bsky.social) used to publish                                             |
| `BSKY_APP_PASSWORD`     | Bluesky app password used to publish                                                               |
| `TELEGRAM_ENABLED`      | Set to `true` to publish headlines to Telegram                                                     |
| `TELEGRAM_BOT_TOKEN`    | Telegram bot token used to publish                                                                 |
| `TELEGRAM_CHAT_ID`      | Telegram chat/channel id used to publish                                                           |
| `SCORE_BASE_URL`        | AI scoring endpoint, e.g. Ollama (`http://host.docker.internal:11435`) locally or a remote API     |
| `SCORE_MODEL`           | AI model used for headline scoring, e.g. `llama3.2:1b` locally or `gpt-4o-mini` in production      |
| `SCORE_API_KEY`         | Optional bearer token for hosted providers such as OpenAI; leave empty for keyless local endpoints |

`.env` is ignored by Git and Docker. `docker-compose` loads it automatically when run
from the repository root. Commit only `.env.example`.

Local worker variables live in `wrangler.dev.toml`; use `.dev.vars` for local secrets.

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

   Startup applies the D1 migrations to the local database.

3. Populate the database with the scheduled ingestion handler:

   ```bash
   make scheduled
   ```

   The page only renders stored rows; it does not fetch feeds on request.

4. Open <http://localhost:8787>. The page lists every stored headline from all
   configured feeds, ordered by scheduled time.

5. Follow the worker logs when needed:

   ```bash
   docker-compose logs -f app
   ```

6. Stop and remove the containers:

   ```bash
   docker-compose down
   ```

Common tasks are also available as Makefile targets that wrap the same Compose commands:

```bash
make up         # build and start the worker
make feeds      # download the RSS cache
make test       # run the test suite
make typecheck  # typecheck with tsc
make qa         # run format check, lint, typecheck, and tests
make logs       # follow the worker logs
make down       # stop and remove containers
```

Source files are mounted into the container, so edits reload automatically. Re-run the
download command to refresh the local feed cache. `.env` is not needed for local
development; it is only required for deployment.

## Feeds

The feed list defaults to `src/feeds.ts` and can be overridden by setting the `FEEDS`
environment variable to a JSON array of `{ id, name, url }` objects (e.g. via Wrangler
vars). Each run reads the latest ten items per feed and inserts only URLs and titles
that are not stored yet.

In local development the worker reads `feeds/<id>.xml` from the mounted `feeds` volume
through Wrangler's static assets binding. When deployed there is no assets binding, so
the worker fetches the remote URLs configured for each feed, retrying transient failures.

## Database

Parsed items are stored in D1 (`items` table, defined in `migrations/`). The `url`
column is unique and there is a case-insensitive unique index on `title`, so the same
story is never inserted twice even though feeds are polled repeatedly.

Each ingestion appends new rows; existing rows are left in place. Newly scheduled items
are spread evenly across the next 12-hour window. Items scoring at or below
`MIN_SCORE` (60) are removed after scoring. Published rows are deleted by the weekly
cleanup cron.

Cron triggers run publishing every minute, ingestion every 12 hours, and cleanup every
seven days (the `0 0 */7 * *` expression fires on days 1, 8, 15, 22, and 29). Locally,
`wrangler dev --test-scheduled` exposes the same handler at `/__scheduled`.

## Publishing

Telegram and Bluesky are independent destinations. Each destination is recorded in its
own column (`telegram_published`, `bsky_published`) after a successful post, so a retry
only reposts to destinations that have not succeeded yet. An item is marked `published`
once every enabled destination has accepted it. Destinations that are enabled but
missing credentials are skipped with an error in the logs.

## Tests

Run the test suite in a one-off container:

```bash
docker-compose run --rm test
```

(or simply `make test`)

Run the complete quality gate:

```bash
make qa
```

That runs Prettier, ESLint, TypeScript (`tsc --noEmit`), and the test suite.

The tests use mocked feeds, mocked HTTP, and an in-memory D1 stand-in. They cover RSS
and Atom parsing, entity decoding, storage and deduplication, scoring, per-destination
publishing retries, scheduled ingestion, cleanup, and full-page rendering.

## Deployment

1. Create the D1 database (once):

   ```bash
   docker-compose run --rm app npx wrangler d1 create hinews-cf
   ```

   Copy the returned `database_id` into `wrangler.toml`, replacing
   `REPLACE_WITH_YOUR_D1_DATABASE_ID`.

2. Create an API token with the **Edit Cloudflare Workers** template and put it in
   `.env`.

3. Store production secrets in Cloudflare (for example):

   ```bash
   docker-compose run --rm app npx wrangler secret put SCORE_API_KEY --config wrangler.toml
   docker-compose run --rm app npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.toml
   docker-compose run --rm app npx wrangler secret put BSKY_APP_PASSWORD --config wrangler.toml
   ```

4. Apply migrations and deploy:

   ```bash
   make deploy
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
├── scripts/download-feeds.ts   # Downloads RSS XML into the feeds volume
├── scripts/score.ts            # Scores a headline from the CLI
├── src/feeds.ts                # Feed list, fetching, and RSS/Atom parsing
├── src/ingest.ts               # Deduplicates, scores, and stores new items
├── src/store.ts                # D1 reads and batched writes
├── src/score.ts                # AI headline scoring
├── src/publish.ts              # Telegram and Bluesky publishing
├── src/render.ts               # HTML rendering
├── src/types.ts                # Shared types and database interfaces
├── src/index.ts                # HTTP and scheduled entry points
├── test/                       # Unit tests and in-memory D1 helper
├── .dockerignore               # Build context exclusions (must stay at the context root)
├── .env.example                # Template for local secrets
├── docker-compose.yml          # App, tools, test, deploy, and download services
├── wrangler.toml               # Production configuration (D1, cron, remote feeds)
├── wrangler.dev.toml           # Local configuration (assets binding and local D1)
└── AGENTS.md                   # Conventions for agents and contributors
```
