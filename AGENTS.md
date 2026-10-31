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
- Run `npm test` before committing; all tests must pass.
- Tests use the built-in `node:test` runner and live in `test/`.
- Test behavior and observable output, not implementation details.

## Infrastructure

All local infrastructure runs in Docker on Alpine:

- The image is built from `node:20-alpine` (see `Dockerfile`).
- Services are defined in `docker-compose.yml`; keep it compatible with both the
  `docker compose` plugin and the legacy `docker-compose` CLI (Compose file 3.8).
- The `dev` service serves the worker on port `8787`.
- The `test` and `deploy` services run under their own profiles.
- Add new infrastructure as compose services rather than host-level tooling.
- Do not commit `node_modules`, `.wrangler`, or other local runtime artifacts.
- Keep `docker-compose.yml` compatible with the legacy `docker-compose` CLI, which
  the npm scripts call.

## Local development

The npm scripts are the public interface and always go through Docker:

- `npm run dev` — build and start the worker locally with Wrangler.
- `npm test` — run the test suite in a one-off container.
- `npm run deploy` — deploy with `CLOUDFLARE_API_TOKEN` from the environment.

The `:worker` and `:unit` scripts (`dev:worker`, `test:unit`, `deploy:worker`) are
container entry points that run the raw Node and Wrangler commands. Do not call them
from other npm scripts that already run inside a container, to avoid recursive Docker
invocations. They also work directly on the host for quick checks.
