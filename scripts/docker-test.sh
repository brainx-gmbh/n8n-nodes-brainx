#!/usr/bin/env bash
set -euo pipefail

# Test this community node inside the official n8n Docker image.
#
# What it does:
#   1. Builds the node (npm run build)
#   2. Packs it with npm pack and installs the tarball into .n8n-docker/custom
#   3. Starts n8n in Docker with that folder mounted as custom extensions
#
# n8n is reachable at http://localhost:5678 once the container is up.
# Workflow/user data is persisted in .n8n-docker/data across restarts.
# Stop with Ctrl+C; the container is removed automatically (--rm).

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$ROOT/.n8n-docker"
CUSTOM="$WORK/custom"
DATA="$WORK/data"
CONTAINER="n8n-nodes-brainx-test"
PORT="${N8N_PORT:-5678}"
IMAGE="${N8N_IMAGE:-docker.n8n.io/n8nio/n8n}"

echo ">> Building node..."
cd "$ROOT"
npm run build

echo ">> Packing node..."
mkdir -p "$CUSTOM" "$DATA"
TARBALL="$(npm pack --silent --pack-destination "$WORK")"
TARBALL_PATH="$WORK/$TARBALL"

echo ">> Installing node into $CUSTOM..."
cd "$CUSTOM"
if [ ! -f package.json ]; then
  cat > package.json <<'EOF'
{ "name": "n8n-custom", "version": "1.0.0", "private": true }
EOF
fi
npm install --silent --no-audit --no-fund "$TARBALL_PATH"
rm -f "$TARBALL_PATH"

echo ">> Stopping any previous container..."
docker rm -f "$CONTAINER" >/dev/null 2>&1 || true

echo ">> Starting n8n on http://localhost:$PORT"
echo "   (Ctrl+C to stop. Re-run this script after code changes.)"
exec docker run --rm -it \
  --name "$CONTAINER" \
  -p "$PORT:5678" \
  -v "$CUSTOM:/home/node/.n8n/custom" \
  -v "$DATA:/home/node/.n8n" \
  -e N8N_CUSTOM_EXTENSIONS=/home/node/.n8n/custom \
  "$IMAGE"
