# hinews-cf

A minimal [Cloudflare Worker](https://developers.cloudflare.com/workers/) that logs
`Hello World` to the console and returns it as the response body.

All local infrastructure — development and tests — runs in Docker on Alpine.

## Requirements

- Docker with Docker Compose (the `docker compose` plugin or the `docker-compose` CLI)
- A Cloudflare account (only needed for deployment)

## Local development

Build the image and start the worker:

```bash
docker compose up --build
```

Then open <http://localhost:8787>. The response body is `Hello World`, and the same
message is printed to the terminal running the worker.

The project directory is mounted into the container, so source changes reload
automatically. Stop the container with `Ctrl+C`.

> On systems without the Compose plugin, replace `docker compose` with `docker-compose`.

## Tests

Run the test suite in a one-off container:

```bash
docker compose run --rm test
```

The tests use the built-in Node.js test runner, so no extra test dependencies are
required. They call the worker's `fetch` handler directly and assert both the response
and the console output.

## Deployment

Deployment uses Wrangler against your Cloudflare account. Run it from the host (or from
a container with your credentials mounted):

```bash
npm install
npx wrangler login
npm run deploy
```

## Running on the host

Node.js 18 or newer also works without Docker:

```bash
npm install
npm run dev     # local worker on http://localhost:8787
npm test        # run the tests
```

## Project structure

```
.
├── src/index.js        # Worker entry point
├── test/index.test.js  # Unit tests
├── wrangler.toml       # Wrangler configuration
├── Dockerfile          # Alpine-based Node image
├── docker-compose.yml  # Local dev and test services
└── AGENTS.md           # Conventions for agents and contributors
```
