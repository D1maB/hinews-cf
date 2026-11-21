.PHONY: up down logs build feeds test scheduled deploy

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
