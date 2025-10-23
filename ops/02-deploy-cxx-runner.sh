#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/ops/cxx-runner"
DST="/opt/cxx-runner"

echo "==> Sync runner to $DST"
sudo mkdir -p "$DST"
sudo rsync -a --delete "$SRC/" "$DST/"

echo "==> Build & deploy"
cd "$DST"

# If user is not in docker group, fall back to sudo
DOCKER="${DOCKER:-docker}"
if ! $DOCKER ps >/dev/null 2>&1; then
  DOCKER="sudo docker"
fi

$DOCKER system prune -f || true
$DOCKER build --pull -t cxx-runner:stable .
$DOCKER compose down || true
$DOCKER compose up -d

echo "==> Health checks"
for i in {1..30}; do
  if curl -fsS http://127.0.0.1:5055/health >/dev/null; then
    echo "Health OK"
    break
  fi
  sleep 0.5
done

curl -fsS http://127.0.0.1:5055/openapi.json | jq '.paths' || true
curl -fsS https://"$(hostname -f)"/cxx-run/health || true
echo
$DOCKER ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo "==> Runner deploy complete."
