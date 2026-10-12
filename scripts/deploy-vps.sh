#!/usr/bin/env bash
# Sends the code to a VPS and (re)builds the containers there with docker-compose.vps.yml.
#
#   scripts/deploy-vps.sh <ssh-host> [remote-dir]     remote-dir defaults to /opt/ascape
#
# The server's own <remote-dir>/.env (see README → Deploying → VPS) must exist and is never overwritten.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${1:?usage: $0 <ssh-host> [remote-dir]}"
REMOTE_DIR="${2:-/opt/ascape}"
COMPOSE_FILE=docker-compose.vps.yml
# Everything the two Dockerfiles read. Local secrets (.env) and notes stay on this machine.
SOURCES=(client server shared "$COMPOSE_FILE" .dockerignore)

if ! ssh "$HOST" "test -f '$REMOTE_DIR/.env'"; then
  echo "Missing $HOST:$REMOTE_DIR/.env — create it first (README → Deploying → VPS)." >&2
  exit 1
fi

cd "$ROOT"
# --delete only prunes inside the directories sent, so the remote .env survives.
rsync -az --delete \
  --exclude node_modules --exclude dist --exclude target --exclude .DS_Store \
  "${SOURCES[@]}" "$HOST:$REMOTE_DIR/"

ssh "$HOST" "cd '$REMOTE_DIR' \
  && docker compose -f $COMPOSE_FILE up -d --build --remove-orphans \
  && docker compose -f $COMPOSE_FILE ps"
