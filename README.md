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

## Local development

Build the image and start the worker:

```bash
./scripts/compose up --build app
```

The helper picks `docker compose` or the legacy `docker-compose` and always uses
`docker/compose.yml`. The equivalent plain Docker command is:

```bash
docker compose -f docker/compose.yml up --build app
```

Then open <http://localhost:8787>. The response body is `Hello World`, and the same
message is printed to the terminal running the worker. Source changes reload
automatically; stop the container with `Ctrl+C`.

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
docker compose --env-file .env -f docker/compose.yml run --rm deploy
```

## Project structure

```
.
├── docker/
│   ├── compose.yml       # App, test, and deploy services
│   └── Dockerfile        # Alpine-based image with glibc for workerd
├── scripts/compose       # Compose CLI wrapper that loads .env
├── src/index.js          # Worker entry point
├── test/index.test.js    # Unit tests
├── .dockerignore         # Build context exclusions (must stay at the context root)
├── .env.example          # Template for local secrets
├── wrangler.toml         # Wrangler configuration
└── AGENTS.md             # Conventions for agents and contributors
```
