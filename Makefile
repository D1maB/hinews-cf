.PHONY: up down logs build feeds test typecheck scheduled deploy query migrate help score wipe

# The standalone v1 CLI is the supported local runtime. CI overrides this with
# `DOCKER_COMPOSE="docker compose"` because GitHub runners ship only Compose v2.
DOCKER_COMPOSE ?= docker-compose

DB ?= DB
DB_QUERY ?= SELECT COUNT(*) FROM items
SCORE_TEXT ?= RTX 5090 graphics card review

up:
	$(DOCKER_COMPOSE) up -d --build app

down:
	$(DOCKER_COMPOSE) down

logs:
	$(DOCKER_COMPOSE) logs -f app

build:
	$(DOCKER_COMPOSE) build app

feeds:
	$(DOCKER_COMPOSE) run --rm download-feeds

test:
	$(DOCKER_COMPOSE) run --rm test

typecheck:
	$(DOCKER_COMPOSE) run --rm tools npx tsc --noEmit

lint:
	$(DOCKER_COMPOSE) run --rm tools npx eslint .

format:
	$(DOCKER_COMPOSE) run --rm tools npx prettier --write .

format-check:
	$(DOCKER_COMPOSE) run --rm tools npx prettier --check .

qa:
	$(DOCKER_COMPOSE) run --rm tools sh -c "npx prettier --check . && npx eslint . && npx tsc --noEmit && npx tsx --test"

scheduled:
	curl "http://localhost:8787/__scheduled?cron=0+*/12+*+*+*"

deploy:
	$(DOCKER_COMPOSE) run --rm deploy

query:
	$(DOCKER_COMPOSE) run --rm app npx wrangler d1 execute $(DB) --local --config wrangler.dev.toml --command "$(DB_QUERY)"

migrate:
	$(DOCKER_COMPOSE) run --rm app npx wrangler d1 migrations apply $(DB) --local --config wrangler.dev.toml

wipe:
	$(DOCKER_COMPOSE) run --rm app npx wrangler d1 execute DB --local --config wrangler.dev.toml --command "DELETE FROM items"

score:
	$(DOCKER_COMPOSE) run --rm tools npx tsx scripts/score.ts "$(SCORE_TEXT)"

help:
	@echo "hinews-cf - local development commands"
	@echo ""
	@echo "  make up         - build and start the worker (http://localhost:8787)"
	@echo "  make down       - stop and remove containers"
	@echo "  make logs       - follow worker logs"
	@echo "  make build      - rebuild the app image"
	@echo "  make feeds      - download RSS feeds into local cache"
	@echo "  make test       - run the test suite"
	@echo "  make typecheck  - typecheck the project"
	@echo "  make scheduled  - trigger the cron handler locally"
	@echo "  make deploy     - deploy to Cloudflare"
	@echo "  make query      - run a SQL query against local D1 (e.g. make query DB_QUERY=\"SELECT COUNT(*) FROM items\")"
	@echo "  make migrate    - apply D1 migrations to the local database"
	@echo "  make wipe       - wipe all stored items from the local database"
	@echo "  make score      - score a headline via the AI model (e.g. make score SCORE_TEXT=\"RTX 5090 review\")"
	@echo "  make qa         - run lint, format check, and tests"
	@echo "  make help       - show this help"
