# hinews-cf

A minimal [Cloudflare Worker](https://developers.cloudflare.com/workers/) that fetches the latest
PC hardware and gaming news from the RSS feeds of a fixed list of sites, stores it in a D1
database, renders the stored news, and publishes scheduled items to Telegram and Bluesky.

A cron trigger ingests news every 12 hours, publishes due items every minute, and removes
published items weekly.

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

| Variable                | Purpose                                                 |
| ----------------------- | ------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | API token with the Edit Cloudflare Workers template     |
| `CLOUDFLARE_ACCOUNT_ID` | Optional, when the token can access multiple accounts   |
| `BSKY_ENABLED`          | Set to `true` to publish headlines to Bluesky           |
| `BSKY_HANDLE`           | Bluesky handle (e.g. user.bsky.social) used to publish  |
| `BSKY_APP_PASSWORD`     | Bluesky app password used to publish                    |
| `TELEGRAM_ENABLED`      | Set to `true` to publish headlines to Telegram          |
| `TELEGRAM_BOT_TOKEN`    | Telegram bot token used to publish                      |
| `TELEGRAM_CHAT_ID`      | Telegram chat/channel id used to publish                |
| `LOCAL_FEEDS_URL`       | Base URL for downloaded local feeds in development      |
| `FEED_ITEM_LIMIT`       | Max items to keep from each feed (default `10`)         |
| `AI_PROVIDER`           | AI scoring provider: `google` (default) or `openrouter` |
| `GEMINI_API_KEY`        | Gemini API key used when `AI_PROVIDER=google`           |
| `GEMINI_MODEL`          | Gemini model used for scoring                           |
| `OPENROUTER_API_KEY`    | OpenRouter API key used when `AI_PROVIDER=openrouter`   |
| `OPENROUTER_MODEL`      | OpenRouter model used for scoring                       |
| `AI_SCORE_BATCH_SIZE`   | Items per AI scoring request (default `20`)             |

`.env` is ignored by Git and Docker. `docker-compose` loads it automatically when run
from the repository root. Commit only `.env.example`.

Local worker configuration comes from the repository-root `.env` file; nothing needs
`.dev.vars`.

## Run the app locally

The app runs entirely in Docker, so you do not need Node.js installed on the host.

1. Download feeds for local development (served by the `feeds` docker-compose service):

   ```bash
   make download-feeds
   ```

2. Build the image and start the worker in the background:

   ```bash
   docker-compose up -d --build app
   ```

   Startup applies the D1 migrations to the local database. Local dev uses downloaded feeds
   from `./feeds` via `LOCAL_FEEDS_URL` (defaults to `http://feeds:8080` in docker-compose);
   production fetches feeds from the internet.

3. Populate the database with the scheduled ingestion handler:

   ```bash
   make cron
   ```

   This fetches the configured RSS feeds once and stores newly found articles. The page only
   renders stored rows; it does not fetch feeds on request.

4. Open <http://localhost:8787>. The page lists every stored headline from all
   configured sources, ordered by scheduled time.

5. Follow the worker logs when needed:

   ```bash
   docker-compose logs -f app
   ```

6. Stop and remove the containers:

   ```bash
   docker-compose down
   ```

Common tasks are available as Makefile targets, each forwarding to the corresponding
Docker Compose command. Run `make help` to print this list from the terminal.

```bash
make up           # build and start the worker (http://localhost:8787)
make down         # stop and remove containers
make logs         # follow worker logs
make build        # rebuild the app image
make download-feeds # download RSS feeds into ./feeds for local dev
make cron         # run the cron ingestion handler locally
make re           # recreate the app container to resync environment variables
make query        # run a SQL query against local D1 (e.g. make query DB_QUERY="SELECT COUNT(*) FROM items")
make migrate      # apply D1 migrations to the local database
make wipe         # delete all stored items from the local database
make test         # run the test suite
make typecheck    # typecheck the project with tsc
make lint         # run ESLint
make format       # format files with Prettier
make format-check # check formatting with Prettier
make qa           # run Prettier check, ESLint, typecheck, and tests
make deploy       # apply remote migrations and deploy to Cloudflare
make help         # show the list of available targets
```

Source files are mounted into the container, so edits reload automatically. `.env` is not
needed for local development; it is only required for deployment.

## Sources, parsing, and AI scoring

The source list lives in `sites.json` and defaults to the built-in PC hardware and gaming
sources, but can be overridden by setting the `FEEDS` environment variable to a JSON array of
`{ id, name, url }` objects (e.g. via Wrangler vars).

On every ingestion the worker fetches each configured feed over HTTP and parses RSS/XML and
JSON feed entries using libraries (`fast-xml-parser` for XML, built-in JSON parsing for JSON
feeds). New items are saved with status `new`, then scored by AI based on title interest for
PC users and gamers (1-100) using the configured provider (`AI_PROVIDER`: `google` or
`openrouter`), then assigned `scheduled_at` and moved to `scheduled` status. Feeds that fail to
respond are skipped, and the rest of the pipeline (duplicate skipping, sponsored filtering,
publishing) continues.

## Database

Items are stored in D1 (`items` table, defined in `migrations/`). The `url` column is unique
and there is a case-insensitive unique index on `title`, so the same story is never inserted
twice even though ingestion runs repeatedly.

Each ingestion appends new rows; existing rows are left in place. Newly stored items are
spread randomly across the next 12-hour window. Published rows are deleted by the weekly
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

The tests use mocked HTTP and an in-memory D1 stand-in. They cover RSS feed parsing, storage
and duplicate handling, per-destination publishing retries, scheduled ingestion, cleanup, and
full-page rendering.

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
   docker-compose run --rm app npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.toml
   docker-compose run --rm app npx wrangler secret put BSKY_APP_PASSWORD --config wrangler.toml
   ```

4. Apply migrations and deploy:

   ```bash
   make deploy
   ```

   The deploy service applies remote migrations before running `wrangler deploy`.

The deployed worker fetches RSS feeds and the cron trigger refreshes the database every 12
hours.

To prefill the production database without waiting for the cron, run the deployed cron
handler manually from the Cloudflare dashboard.

## Project structure

```
.
├── docker/
│   └── Dockerfile              # Alpine image with glibc for workerd
├── migrations/                 # D1 schema migrations
├── sites.json                   # Default RSS feed sources
├── src/feeds.ts                # Source list, text helpers, URL checks
├── src/rss.ts                  # RSS/JSON feed fetching and parsing
├── src/ingest.ts               # Deduplicates and stores feed items
├── src/store.ts                # D1 reads and batched writes
├── src/publish.ts              # Telegram and Bluesky publishing
├── src/render.ts               # HTML rendering
├── src/types.ts                # Shared types and database interfaces
├── src/index.ts                # HTTP and scheduled entry points
├── test/                       # Unit tests and in-memory D1 helper
├── .dockerignore               # Build context exclusions (must stay at the context root)
├── .env.example                # Template for local secrets
├── docker-compose.yml          # App, tools, test, and deploy services
├── wrangler.toml               # Production configuration (D1 and cron)
├── wrangler.dev.toml           # Local configuration and local D1
└── AGENTS.md                   # Conventions for agents and contributors
```
