# AGENTS.md

Project guidelines for AI agents and contributors working on `hinews-cf`.

## Commit conventions

Use [Conventional Commits](https://www.conventionalcommits.org/) for every commit:

```
<type>(optional scope): <short imperative summary>
```

Allowed types:

- `feat` — a new feature
- `fix` — a bug fix
- `chore` — tooling, dependencies, configuration
- `docs` — documentation only
- `refactor` — code change that neither fixes a bug nor adds a feature
- `test` — adding or updating tests
- `style` — formatting, missing semicolons, etc. (no code change)
- `perf` — performance improvement
- `build` — build system or external dependency changes
- `ci` — CI configuration changes

Examples:

```
feat: return hello world greeting
fix: handle missing content-type header
docs: document local development commands
```

Rules:

- Write the summary in the imperative mood, lowercase, without a trailing period.
- Keep the summary under 72 characters.
- Add a body when the change needs context, wrapped at 72 characters.
- Reference related issues in the footer (for example, `Closes #12`).

## Code style

Write clean, readable JavaScript as an experienced developer would:

- Use modern ES modules (`import`/`export`) and `const` by default; use `let` only when reassignment is needed.
- Prefer small, single-purpose functions with descriptive names.
- Extract magic values into named constants.
- Add JSDoc to exported functions and non-obvious helpers.
- Avoid dead code, unused parameters, and commented-out code.
- Keep the code self-explanatory; comment only the "why", not the "what".
- Keep the worker stateless and platform-native (Web APIs such as `Request`, `Response`, `fetch`).
- Do not add dependencies unless they clearly pay for themselves.

## Testing

- Every behavioral change needs a test.
- Run `./scripts/compose run --rm test` before committing; all tests must pass.
- Tests use the built-in `node:test` runner inside the container and live in `test/`.
- Test behavior and observable output, not implementation details.

## Infrastructure

All local infrastructure runs in Docker on Alpine:

- The `Dockerfile` lives in `docker/`; services are defined in `docker-compose.yml` at
  the repository root.
- `.dockerignore` also stays at the repository root because Docker resolves it against
  the build context. Keep it as the single source of build exclusions, including
  `.env`.
- The image is built from `frolvlad/alpine-glibc:alpine-3.21` (see
  `docker/Dockerfile`), because Wrangler's `workerd` runtime is glibc-linked and cannot
  run on musl-only Alpine.
- Keep `docker-compose.yml` compatible with both the `docker compose` plugin and the
  legacy `docker-compose` CLI (Compose file 3.8).
- The `app` service serves the worker on port `8787`.
- The `test` and `deploy` services run under their own profiles.
- Add new infrastructure as compose services rather than host-level tooling.
- Do not commit `node_modules`, `.wrangler`, `.env`, or other local runtime artifacts.
- `scripts/compose` selects the available Compose CLI (`docker compose` or
  `docker-compose`), points it at the root `docker-compose.yml`, and loads `.env`; use
  it for automation and wrappers.
- Docker is the only supported runtime. Do not add host-level Node, Wrangler, or test
  scripts.
- Raw runtime commands (`npx wrangler`, `node --test`) live in `docker-compose.yml`.
- Package scripts, if present, must only forward to Compose; never run Wrangler or
  tests on the host.
- All documentation and automation must use Docker commands, never host commands.

## Secrets

- Credentials live only in the repository-root `.env` file, which is ignored by Git
  and Docker.
- Commit `.env.example` with empty values; never commit real credentials.
- Never hardcode secrets in `docker-compose.yml`, source files, or scripts.
- `scripts/compose` loads `.env` through `--env-file`.

## Local development

- `./scripts/compose up --build app` — worker on port `8787`.
- `./scripts/compose run --rm test` — run the test suite.
- `./scripts/compose run --rm deploy` — deploy using `CLOUDFLARE_API_TOKEN`.
