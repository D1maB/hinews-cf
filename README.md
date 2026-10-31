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

## Local development

Build the image and start the worker:

```bash
docker compose up --build dev
```

Then open <http://localhost:8787>. The response body is `Hello World`, and the same
message is printed to the terminal running the worker. Source changes reload
automatically; stop the container with `Ctrl+C`.

> On systems without the Compose plugin, use `docker-compose` instead of
> `docker compose`.

## Tests

Run the test suite in a one-off container:

```bash
docker compose run --rm test
```

The tests use the built-in Node.js test runner inside the container, so no extra test
dependencies are required. They call the worker's `fetch` handler directly and assert
both the response and the console output.

## Deployment

Create an API token with the **Edit Cloudflare Workers** template, then export it and
deploy:

```bash
export CLOUDFLARE_API_TOKEN="your-token"
docker compose run --rm deploy
```

Set `CLOUDFLARE_ACCOUNT_ID` as well if your token has access to more than one account.

## Project structure

```
.
├── src/index.js        # Worker entry point
├── test/index.test.js  # Unit tests
├── scripts/compose     # Picks `docker compose` or `docker-compose`
├── wrangler.toml       # Wrangler configuration
├── Dockerfile          # Alpine-based image with glibc for workerd
├── docker-compose.yml  # Dev, test, and deploy services
└── AGENTS.md           # Conventions for agents and contributors
```
