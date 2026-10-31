# hinews-cf

A minimal [Cloudflare Worker](https://developers.cloudflare.com/workers/) that logs
`Hello World` to the console and returns it as the response body.

All local infrastructure — development, tests, and deployment — runs in Docker on
Alpine through the npm scripts.

## Requirements

- Docker with Docker Compose (the `docker compose` plugin or the `docker-compose` CLI)
- A Cloudflare API token (only needed for deployment)

## Local development

Build the image and start the worker:

```bash
npm run dev
```

This runs `docker-compose up --build dev`. Then open <http://localhost:8787>. The
response body is `Hello World`, and the same message is printed to the terminal running
the worker.

The project directory is mounted into the container, so source changes reload
automatically. Stop the container with `Ctrl+C`.

## Tests

```bash
npm test
```

This runs `docker-compose run --rm test` in a one-off container. The tests use the
built-in Node.js test runner, so no extra test dependencies are required. They call the
worker's `fetch` handler directly and assert both the response and the console output.

## Deployment

Create an API token with the **Edit Cloudflare Workers** template, then export it and
deploy:

```bash
export CLOUDFLARE_API_TOKEN="your-token"
npm run deploy
```

This runs `docker-compose run --rm deploy`. Set `CLOUDFLARE_ACCOUNT_ID` as well if your
token has access to more than one account.

## Running without Docker

Node.js 18 or newer also works. These scripts are the raw commands the containers run:

```bash
npm install
npm run dev:worker     # local worker on http://localhost:8787
npm run test:unit      # run the tests
npm run deploy:worker  # deploy after `npx wrangler login`
```

## Project structure

```
.
├── src/index.js        # Worker entry point
├── test/index.test.js  # Unit tests
├── wrangler.toml       # Wrangler configuration
├── Dockerfile          # Alpine-based image with glibc for workerd
├── docker-compose.yml  # Dev, test, and deploy services
└── AGENTS.md           # Conventions for agents and contributors
```
