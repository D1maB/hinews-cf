# hinews-cf

A minimal [Cloudflare Worker](https://developers.cloudflare.com/workers/) that logs
`Hello World` to the console and returns it as the response body.

Everything — development, tests, and deployment — runs in Docker on Alpine. Docker is
the only supported runtime; no Node.js, Wrangler, or test runner is installed or run on
the host.

## Requirements

- Docker with Docker Compose (the `docker compose` plugin or the legacy `docker-compose`
  CLI)
- A Cloudflare API token (only needed for deployment)

## Configuration

Copy the example environment file and fill in your credentials:

```bash
cp .env.example .env
```

| Variable                | Purpose                                      |
| ----------------------- | -------------------------------------------- |
| `CLOUDFLARE_API_TOKEN`  | API token with the Edit Cloudflare Workers template |
| `CLOUDFLARE_ACCOUNT_ID` | Optional, when the token can access multiple accounts |

`.env` is ignored by Git and Docker. `scripts/compose` loads it automatically, so
credentials are never hardcoded in the compose file. Commit only `.env.example`.

## Run the app locally

The app runs entirely in Docker, so you do not need Node.js installed on the host.

1. From the repository root, build the image and start the worker:

   ```bash
   ./scripts/compose up --build app
   ```

   The first run builds the Alpine image and installs dependencies; later runs reuse
   the cached layers.

2. Open <http://localhost:8787>. The page and the terminal running the container both
   show:

   ```
   Hello World
   ```

3. Stop the worker with `Ctrl+C`.

Source files are mounted into the container, so edits reload automatically. The helper
picks `docker compose` or the legacy `docker-compose` and always uses the root
`docker-compose.yml`. The equivalent plain Docker command is:

```bash
docker compose up --build app
```

`.env` is not needed for local development; it is only required for deployment.

## Tests

Run the test suite in a one-off container:

```bash
./scripts/compose run --rm test
```

The tests use the built-in Node.js test runner inside the container, so no extra test
dependencies are required. They call the worker's `fetch` handler directly and assert
both the response and the console output.

## Deployment

Create an API token with the **Edit Cloudflare Workers** template, put it in `.env`, then
deploy:

```bash
./scripts/compose run --rm deploy
```

The equivalent plain Docker command is:

```bash
docker compose run --rm deploy
```

## Project structure

```
.
├── docker/
│   └── Dockerfile        # Alpine-based image with glibc for workerd
├── scripts/compose       # Compose CLI wrapper that loads .env
├── src/index.js          # Worker entry point
├── test/index.test.js    # Unit tests
├── .dockerignore         # Build context exclusions (must stay at the context root)
├── .env.example          # Template for local secrets
├── docker-compose.yml    # App, test, and deploy services
├── wrangler.toml         # Wrangler configuration
└── AGENTS.md             # Conventions for agents and contributors
```
