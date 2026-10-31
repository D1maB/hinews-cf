# hinews-cf

A minimal [Cloudflare Worker](https://developers.cloudflare.com/workers/) that logs
`Hello World` to the console and returns it as the response body.

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

1. From the repository root, build the image and start the worker in the background:

   ```bash
   docker-compose up -d --build app
   ```

   The first run builds the Alpine image and installs dependencies; later runs reuse
   the cached layers.

2. Open <http://localhost:8787>. The page shows:

   ```
   Hello World
   ```

3. Follow the worker logs when needed:

   ```bash
   docker-compose logs -f app
   ```

4. Stop and remove the container:

   ```bash
   docker-compose down
   ```

Source files are mounted into the container, so edits reload automatically. `.env` is
not needed for local development; it is only required for deployment.

## Tests

Run the test suite in a one-off container:

```bash
docker-compose run --rm test
```

The tests use the built-in Node.js test runner inside the container, so no extra test
dependencies are required. They call the worker's `fetch` handler directly and assert
both the response and the console output.

## Deployment

Create an API token with the **Edit Cloudflare Workers** template, put it in `.env`, then
deploy:

```bash
docker-compose run --rm deploy
```

## Project structure

```
.
├── docker/
│   └── Dockerfile        # Alpine-based image with glibc for workerd
├── src/index.js          # Worker entry point
├── test/index.test.js    # Unit tests
├── .dockerignore         # Build context exclusions (must stay at the context root)
├── .env.example          # Template for local secrets
├── docker-compose.yml    # App, test, and deploy services
├── wrangler.toml         # Wrangler configuration
└── AGENTS.md             # Conventions for agents and contributors
```
