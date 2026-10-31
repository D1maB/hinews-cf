# hinews-cf

A minimal [Cloudflare Worker](https://developers.cloudflare.com/workers/) that fetches
five PC hardware RSS feeds, parses their XML, and renders the latest headlines.

Local development reads feeds downloaded into local storage; production fetches them
from the remote sites.

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

3. Open <http://localhost:8787>. The page lists the latest headlines from the five
   downloaded feeds.

4. Follow the worker logs when needed:

   ```bash
   docker-compose logs -f app
   ```

5. Stop and remove the containers:

   ```bash
   docker-compose down
   ```

Source files are mounted into the container, so edits reload automatically. Re-run the
download command to refresh the local feed cache. `.env` is not needed for local
development; it is only required for deployment.

## Feeds

The feed list lives in `src/index.js`:

| Feed           | URL                                       |
| -------------- | ----------------------------------------- |
| Tom's Hardware | `https://www.tomshardware.com/feeds/all`  |
| TechPowerUp    | `https://www.techpowerup.com/rss/news`    |
| KitGuru        | `https://www.kitguru.net/feed/`           |
| Wccftech       | `https://wccftech.com/feed/`              |
| Guru3D         | `https://www.guru3d.com/rss.xml`          |

In local development the worker reads `feeds/<id>.xml` from the mounted `feeds` volume
through Wrangler's static assets binding. When deployed there is no assets binding, so
the worker fetches the remote URLs above. Each feed is loaded concurrently and the
latest five items are rendered. If a feed is missing or unreachable, its section shows
an error while the other feeds still render.

## Tests

Run the test suite in a one-off container:

```bash
docker-compose run --rm test
```

The tests replace the network with mocked RSS responses and assert local and remote feed
resolution, entity decoding, and graceful handling of a failing feed.

## Deployment

Create an API token with the **Edit Cloudflare Workers** template, put it in `.env`, then
deploy:

```bash
docker-compose run --rm deploy
```

The deployed worker has no static assets binding, so it fetches the feeds directly from
the remote sites.

## Project structure

```
.
├── docker/
│   └── Dockerfile              # Alpine-based image with glibc for workerd
├── scripts/download-feeds.mjs  # Downloads RSS XML into the feeds volume
├── src/index.js                # Worker entry point and feed list
├── test/index.test.js          # Unit tests
├── .dockerignore               # Build context exclusions (must stay at the context root)
├── .env.example                # Template for local secrets
├── docker-compose.yml          # App, test, deploy, and download services
├── wrangler.toml               # Production configuration (remote feeds)
├── wrangler.dev.toml           # Local configuration (assets binding for feeds)
└── AGENTS.md                   # Conventions for agents and contributors
```
