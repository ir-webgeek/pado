#!/usr/bin/env bash
# Install or update Pado on a VPS with Docker. Run from this folder: ./deploy.sh
# First run creates .env from the example and stops so you can set the domain; run it again after.
set -euo pipefail
cd "$(dirname "$0")"
COMPOSE="docker compose -f docker-compose.prod.yml"

if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  echo "Docker with the compose plugin is required (see README.md, step 1)." >&2
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.production.example .env
  echo "Created .env - set DOMAIN, PUBLIC_WEB_URL, CORS_ORIGINS and SUPER_ADMIN_PHONES, then run ./deploy.sh again."
  exit 1
fi
if grep -q "^DOMAIN=pado.example.ir" .env; then
  echo "Set DOMAIN (and PUBLIC_WEB_URL, CORS_ORIGINS) in .env first." >&2
  exit 1
fi

# secrets: generated once, kept in .env
for key in POSTGRES_PASSWORD JWT_SECRET COOKIE_SECRET META_VERIFY_TOKEN; do
  if grep -q "^${key}=CHANGE_ME" .env; then
    sed -i "s|^${key}=CHANGE_ME|${key}=$(openssl rand -hex 32)|" .env
    echo "generated ${key}"
  fi
done

echo "== building images (first time takes a few minutes)"
$COMPOSE build
echo "== database and queue"
$COMPOSE up -d postgres redis
echo "== migrations"
$COMPOSE run --rm migrate
echo "== app"
$COMPOSE up -d --remove-orphans api worker web caddy
$COMPOSE ps
echo
echo "Done. Open $(grep '^PUBLIC_WEB_URL=' .env | cut -d= -f2-) and log in with a SUPER_ADMIN_PHONES number."
echo "Upgraded from an older version? Create thumbnails for old photos once:"
echo "  $COMPOSE exec api node apps/api/dist/backfill-images.js"
