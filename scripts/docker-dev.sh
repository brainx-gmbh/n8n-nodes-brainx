#!/usr/bin/env bash
set -euo pipefail

# Dev loop: run n8n in Docker with live-reload for this community node.
#
# What it does:
#   1. First run only: builds the node, packs it, installs into
#      .n8n-docker/custom (same layout as docker-test.sh).
#   2. Always: does a fresh `npm run build` so the SVG icon is in dist/
#      (tsc --watch doesn't copy non-TS assets).
#   3. Starts n8n in Docker, bind-mounting the project's dist/ read-only
#      over the installed package's dist/ inside the container.
#   4. Runs `tsc --watch` in the background to recompile on source changes.
#   5. Watches dist/ and restarts the container on change (n8n loads
#      community nodes at startup; a restart is required to pick them up).
#
# Open http://localhost:5678. Ctrl+C tears everything down.

trap 'echo "!! Failed at line $LINENO (exit $?)" >&2' ERR

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/.n8n-docker"
CUSTOM="$WORK/custom"
DATA="$WORK/data"
CONTAINER="n8n-nodes-brainx-dev"
PORT="${N8N_PORT:-5678}"
IMAGE="${N8N_IMAGE:-docker.n8n.io/n8nio/n8n}"

PKG_NAME="$(node -p "require('$ROOT/package.json').name")"
INSTALLED_PKG="$CUSTOM/node_modules/$PKG_NAME"

NPM_FLAGS=(--no-audit --no-fund)
if [ "$(id -u)" = "0" ]; then
  NPM_FLAGS+=(--unsafe-perm)
fi

cd "$ROOT"

echo ">> Building node..."
npm run build

if [ ! -d "$INSTALLED_PKG" ]; then
  echo ">> First-time setup: installing node into $CUSTOM"
  mkdir -p "$CUSTOM" "$DATA"
  npm pack "${NPM_FLAGS[@]}" --pack-destination "$WORK" >/dev/null
  TARBALL_PATH="$(/bin/ls -t "$WORK"/*.tgz | head -n1)"
  (
    cd "$CUSTOM"
    if [ ! -f package.json ]; then
      cat > package.json <<'EOF'
{ "name": "n8n-custom", "version": "1.0.0", "private": true }
EOF
    fi
    npm install "${NPM_FLAGS[@]}" "$TARBALL_PATH"
  )
  rm -f "$TARBALL_PATH"
fi

echo ">> Stopping any previous container..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo ">> Starting n8n on http://localhost:$PORT"
docker run -d \
  --name "$CONTAINER" \
  -p "$PORT:5678" \
  -v "$CUSTOM:/home/node/.n8n/custom" \
  -v "$DATA:/home/node/.n8n" \
  -v "$ROOT/dist:/home/node/.n8n/custom/node_modules/$PKG_NAME/dist:ro" \
  -e N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom \
  "$IMAGE" >/dev/null

cleanup() {
  set +e
  echo ""
  echo ">> Shutting down..."
  [ -n "${TSC_PID:-}" ] && kill "$TSC_PID" 2>/dev/null
  [ -n "${LOGS_PID:-}" ] && kill "$LOGS_PID" 2>/dev/null
  docker rm -f "$CONTAINER" >/dev/null 2>&1
}
trap cleanup EXIT INT TERM

echo ">> Starting tsc --watch..."
npm run build:watch &
TSC_PID=$!

docker logs -f "$CONTAINER" &
LOGS_PID=$!

echo ">> Watching dist/ for changes. Ctrl+C to stop."
DIST_DIR="$ROOT/dist" CONTAINER_NAME="$CONTAINER" node -e '
const { watch } = require("fs");
const { spawn } = require("child_process");

const distDir = process.env.DIST_DIR;
const container = process.env.CONTAINER_NAME;

let timer = null;
let restarting = false;
let pendingRestart = false;

function restart() {
  if (restarting) { pendingRestart = true; return; }
  restarting = true;
  console.log(">> Change detected, restarting container...");
  const p = spawn("docker", ["restart", container], { stdio: "inherit" });
  p.on("exit", () => {
    restarting = false;
    if (pendingRestart) { pendingRestart = false; restart(); }
  });
}

watch(distDir, { recursive: true }, (_event, filename) => {
  if (!filename) return;
  clearTimeout(timer);
  timer = setTimeout(restart, 300);
});

setInterval(() => {}, 1 << 30);
'
