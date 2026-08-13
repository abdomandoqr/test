#!/usr/bin/env bash
set -euo pipefail

PORT=8081
PROJECT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
ROOT_DIR="$PROJECT_DIR/alnoor-dental-clinic"
SCREENSHOT_SCRIPT="$PROJECT_DIR/scripts/take-screenshot.mjs"

cleanup() {
  if [[ -n "${SERVER_PID:-}" ]]; then
    echo "Stopping server (PID: $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT

echo "Starting static server on port $PORT from $ROOT_DIR..."
cd "$ROOT_DIR"
python3 -m http.server "$PORT" &
SERVER_PID=$!

echo "Waiting for server to respond..."
for i in {1..30}; do
  if curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/"; then
    echo "Server is ready."
    break
  fi
  sleep 1
done

echo "Taking screenshot..."
cd "$PROJECT_DIR"
node "$SCREENSHOT_SCRIPT"
