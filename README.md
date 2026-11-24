# hinews-cf

A minimal [Cloudflare Worker](https://developers.cloudflare.com/workers/) that uses an
AI provider's web search to find the latest PC hardware and gaming news from a fixed list
of sites, score every article from 1 to 100 in a single AI call, store it in a D1 database,
render the stored news, and publish scheduled items to Telegram and Bluesky.

The search provider is configurable: Gemini (the default) or OpenRouter.

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

| Variable                | Purpose                                                   |
| ----------------------- | --------------------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | API token with the Edit Cloudflare Workers template       |
| `CLOUDFLARE_ACCOUNT_ID` | Optional, when the token can access multiple accounts     |
| `BSKY_ENABLED`          | Set to `true` to publish headlines to Bluesky             |
| `BSKY_HANDLE`           | Bluesky handle (e.g. user.bsky.social) used to publish    |
| `BSKY_APP_PASSWORD`     | Bluesky app password used to publish                      |
| `TELEGRAM_ENABLED`      | Set to `true` to publish headlines to Telegram            |
| `TELEGRAM_BOT_TOKEN`    | Telegram bot token used to publish                        |
| `TELEGRAM_CHAT_ID`      | Telegram chat/channel id used to publish                  |
| `SEARCH_PROVIDER`       | Search provider: `gemini` (default) or `openrouter`       |
| `GEMINI_API_KEY`        | Gemini API key used when the provider is `gemini`         |
| `GEMINI_MODEL`          | Gemini model, e.g. `gemini-3.6-flash`                     |
| `OPENROUTER_API_KEY`    | OpenRouter API key used when the provider is `openrouter` |
| `OPENROUTER_MODEL`      | OpenRouter model, e.g. `perplexity/sonar`                 |
| `NEWS_ITEM_COUNT`       | How many articles to request per ingestion (default `20`) |

`.env` is ignored by Git and Docker. `docker-compose` loads it automatically when run
from the repository root. Commit only `.env.example`.

Local worker configuration comes from the repository-root `.env` file; nothing needs
`.dev.vars`.

## Run the app locally

The app runs entirely in Docker, so you do not need Node.js installed on the host.

1. Choose a provider and set its API key and model in the `.env` file.

   Gemini (default):

   ```bash
   SEARCH_PROVIDER=gemini
   GEMINI_API_KEY=your-key
   GEMINI_MODEL=gemini-3.6-flash
   ```

   OpenRouter:

   ```bash
   SEARCH_PROVIDER=openrouter
   OPENROUTER_API_KEY=your-key
   OPENROUTER_MODEL=perplexity/sonar
   ```

2. Build the image and start the worker in the background:

   ```bash
   docker-compose up -d --build app
   ```

   Startup applies the D1 migrations to the local database.

3. Populate the database with the scheduled ingestion handler:

   ```bash
   make cron
   ```

   This calls the configured provider's web search once and stores up to the configured
   number of scored articles (see `NEWS_ITEM_COUNT`). The page only renders stored rows; it
   does not call the AI on request.

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
make cron         # run the cron ingestion handler locally
make re           # recreate the app container to resync environment variables
make search       # run the configured provider's news search and print its JSON result
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

## Sources and AI search

The source list lives in `sites.json` and defaults to the built-in PC hardware and gaming
sources, but can be overridden by setting the `FEEDS` environment variable to a JSON array of
`{ id, name, url }` objects (e.g. via Wrangler vars). On every ingestion the worker asks
the configured search provider for the latest articles from those sites (20 by default).
Gemini is called with the Google Search tool, while OpenRouter is called with its `web`
plugin enabled. Each result already includes the title, description, source, direct link,
and a relevance score from 1 to 100, so there is no separate per-headline scoring step.
Results that come from other sites, or with an invalid URL or score, are discarded. The
model is also instructed not to return duplicate titles or URLs. `saveItems` additionally
skips articles whose URL already exists in the database, so repeated searches never
re-insert the same link.

The provider is selected with `SEARCH_PROVIDER` (`gemini` or `openrouter`). The concrete
provider implementation is chosen by a factory in `src/search-provider.ts`, so adding
another provider only requires writing a request function and registering it in
`PROVIDER_REQUESTS`.

## Database

Scored items are stored in D1 (`items` table, defined in `migrations/`). The `url`
column is unique and there is a case-insensitive unique index on `title`, so the same
story is never inserted twice even though the search runs repeatedly.

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

The tests use mocked HTTP, mocked AI responses, and an in-memory D1 stand-in. They
cover AI result parsing and validation, storage and duplicate handling, per-destination
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
   docker-compose run --rm app npx wrangler secret put GEMINI_API_KEY --config wrangler.toml
   docker-compose run --rm app npx wrangler secret put OPENROUTER_API_KEY --config wrangler.toml
   docker-compose run --rm app npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.toml
   docker-compose run --rm app npx wrangler secret put BSKY_APP_PASSWORD --config wrangler.toml
   ```

   Set `SEARCH_PROVIDER` and the matching model as Wrangler vars or secrets.

4. Apply migrations and deploy:

   ```bash
   make deploy
   ```

   The deploy service applies remote migrations before running `wrangler deploy`.

The deployed worker searches the web through the configured provider and the cron trigger
refreshes the database every 12 hours.

To prefill the production database without waiting for the cron, run the deployed cron
handler manually from the Cloudflare dashboard.

## Project structure

```
.
├── docker/
│   └── Dockerfile              # Alpine image with glibc for workerd
├── migrations/                 # D1 schema migrations
├── sites.json                   # Default news sources for the AI web search
├── src/feeds.ts                # Source list, text helpers
├── src/search.ts               # Search orchestration and result validation
├── src/search-provider.ts      # Search provider request functions and factory
├── src/ingest.ts               # Deduplicates and stores scored items
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
