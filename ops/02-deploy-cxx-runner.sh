#!/usr/bin/env bash
set -euo pipefail

# paths relative to repo root
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STACK_DIR="$REPO_ROOT/ops/cxx-runner"

echo "==> Building image and deploying compose stack from: $STACK_DIR"
cd "$STACK_DIR"

# Optional: prune old images/volumes (safe-ish)
docker system prune -f || true

# Build with a stable tag; compose will use it
docker build --pull --no-cache -t cxx-runner:stable .

# Up it goes
docker compose down
docker compose up -d

echo "==> Waiting for health..."
for i in {1..20}; do
  if curl -fsS http://127.0.0.1:5055/health >/dev/null; then
    echo "Health OK"
    break
  fi
  sleep 0.5
done

echo "==> Routes:"
curl -fsS http://127.0.0.1:5055/openapi.json | jq '.paths' || true

echo "==> Try via Nginx (if configured):"
set +e
curl -fsS https://$(hostname -f)/cxx-run/health || true
echo
set -e

echo "==> cxx-runner logs (tail):"
docker logs --tail=40 cxx-runner || true

echo "==> Done."
