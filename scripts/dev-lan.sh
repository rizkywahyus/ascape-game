#!/usr/bin/env bash
# Runs the server and the client so a phone on the same Wi-Fi can play: http://<laptop-ip>:5173.
# Ctrl+C stops both.
#
#   scripts/dev-lan.sh          guest mode: no sign-in, nothing saved to the database
#   scripts/dev-lan.sh --auth   Supabase sign-in and persistence from .env (add the printed URL to
#                               Supabase Auth → URL configuration first)
#   LAN_IP=10.0.0.5 scripts/dev-lan.sh   when the address is detected wrong
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SERVER_PORT=8080
CLIENT_PORT=5173
HEALTH_URL="http://localhost:${SERVER_PORT}/actuator/health/liveness"
SERVER_START_TIMEOUT_SECONDS=180

detect_lan_ip() {
  if [[ "$(uname)" == "Darwin" ]]; then
    local interface
    interface="$(route -n get default 2>/dev/null | awk '/interface:/ { print $2 }')"
    ipconfig getifaddr "${interface:-en0}" 2>/dev/null || true
  else
    hostname -I 2>/dev/null | awk '{ print $1 }'
  fi
}

LAN_IP="${LAN_IP:-$(detect_lan_ip)}"
if [[ -z "$LAN_IP" ]]; then
  echo "Could not find this machine's Wi-Fi address; run with LAN_IP=<address> $0" >&2
  exit 1
fi

USE_AUTH=false
[[ "${1:-}" == "--auth" ]] && USE_AUTH=true

CLIENT_URL="http://${LAN_IP}:${CLIENT_PORT}"
# The client proxies /api and /ws to the server, so the browser's origin is the client's.
ALLOWED="${CLIENT_URL},http://localhost:${CLIENT_PORT}"

# Stops a process and everything it spawned (Maven forks the app's JVM, npx spawns node). The subshells above
# exec, so the script's children are Maven and npx themselves and a `pkill -f dev-lan.sh` hits only the script.
kill_tree() {
  local child
  for child in $(pgrep -P "$1"); do kill_tree "$child"; done
  kill "$1" 2>/dev/null || true
}

cleanup() {
  trap - EXIT
  local child
  for child in $(pgrep -P $$); do kill_tree "$child"; done
}
trap cleanup EXIT
trap 'exit 130' INT TERM HUP

if [[ ! -d "$ROOT/client/node_modules" ]]; then
  echo "Installing client dependencies…"
  (cd "$ROOT/client" && npm install --silent)
fi

echo "Starting the server on :${SERVER_PORT}…"
if $USE_AUTH; then
  (cd "$ROOT/server" && ALLOWED_ORIGINS="$ALLOWED" exec ./mvnw -q spring-boot:run) &
else
  # Empty values override .env: no token needed, profiles and stats stay in memory.
  (cd "$ROOT/server" && ALLOWED_ORIGINS="$ALLOWED" AUTH_ALLOW_UNAUTHENTICATED=true DB_URL= exec ./mvnw -q spring-boot:run) &
fi

for ((waited = 0; waited < SERVER_START_TIMEOUT_SECONDS; waited++)); do
  curl -sf "$HEALTH_URL" >/dev/null && break
  sleep 1
done
if ! curl -sf "$HEALTH_URL" >/dev/null; then
  echo "The server did not start within ${SERVER_START_TIMEOUT_SECONDS}s (see the log above)." >&2
  exit 1
fi

echo "Starting the client on :${CLIENT_PORT}…"
if $USE_AUTH; then
  (cd "$ROOT/client" && exec npx vite --host 0.0.0.0 --port "$CLIENT_PORT" --strictPort) &
else
  # Without Supabase keys the client skips sign-in and plays as a guest.
  (cd "$ROOT/client" && VITE_SUPABASE_URL= VITE_SUPABASE_PUBLISHABLE_KEY= \
    exec npx vite --host 0.0.0.0 --port "$CLIENT_PORT" --strictPort) &
fi

echo
echo "  Laptop: http://localhost:${CLIENT_PORT}"
echo "  Phone:  ${CLIENT_URL}   (same Wi-Fi)"
$USE_AUTH || echo "  Mode:   guest (no sign-in, nothing saved)"
echo "  Ctrl+C stops both."
echo

wait
