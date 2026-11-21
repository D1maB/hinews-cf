.PHONY: up down logs build feeds test scheduled deploy query migrate help

DB ?= DB
DB_QUERY ?= SELECT COUNT(*) FROM items

up:
	docker-compose up -d --build app

down:
	docker-compose down

logs:
	docker-compose logs -f app

build:
	docker-compose build app

feeds:
	docker-compose run --rm download-feeds

test:
	docker-compose run --rm test

scheduled:
	curl "http://localhost:8787/__scheduled?cron=0+*/12+*+*+*"

deploy:
	docker-compose run --rm deploy

query:
	docker-compose run --rm --entrypoint npx app npx wrangler d1 execute $(DB) --local --config wrangler.dev.toml --command "$(DB_QUERY)"

migrate:
	docker-compose run --rm --entrypoint npx app npx wrangler d1 migrations apply $(DB) --local --config wrangler.dev.toml

help:
	@echo "hinews-cf - local development commands"
	@echo ""
	@echo "  make up        - build and start the worker (http://localhost:8787)"
	@echo "  make down       - stop and remove containers"
	@echo "  make logs       - follow worker logs"
	@echo "  make build      - rebuild the app image"
	@echo "  make feeds      - download RSS feeds into local cache"
	@echo "  make test       - run the test suite"
	@echo "  make scheduled  - trigger the cron handler locally"
	@echo "  make deploy     - deploy to Cloudflare"
	@echo "  make query      - run a SQL query against local D1 (e.g. make query DB_QUERY=\"SELECT COUNT(*) FROM items\")"
	@echo "  make migrate    - apply D1 migrations to the local database"
	@echo "  make help       - show this help"
