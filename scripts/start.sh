#!/bin/sh
set -eu
cd "$(dirname "$0")/.."
if [ ! -f .env ]; then
  node -e "require('node:fs').writeFileSync('.env', 'SEARXNG_SECRET=' + require('node:crypto').randomBytes(32).toString('hex') + '\\n', { mode: 0o600, flag: 'wx' })"
fi
docker compose up --build -d
printf 'Fieldnotes is starting at http://localhost:3000\n'
