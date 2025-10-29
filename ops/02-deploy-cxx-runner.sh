#!/usr/bin/env bash
set -euo pipefail

# ---------------------------
# Config (overridable via env)
# ---------------------------
REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${REPO_ROOT}/ops/cxx-runner"
DST="${DST:-/opt/cxx-runner}"

CONTAINER_IMAGE="${CONTAINER_IMAGE:-cxx-runner:stable}"
CONTAINER_NAME="${CONTAINER_NAME:-cxx-runner}"
HOST_PORT="${HOST_PORT:-5055}"           # host → container:8000
INTERNAL_PORT="${INTERNAL_PORT:-8000}"
PUBLIC_PREFIX="${PUBLIC_PREFIX:-/cxx-run/}"

# Nginx site detection:
#   1) --site /path.conf (arg)
#   2) ITS_SERVER_NAME env → match server_name
#   3) single 443 vhost in sites-available
SITE_OVERRIDE=""
if [[ "${1:-}" == "--site" ]]; then
  SITE_OVERRIDE="${2:-}"; shift 2 || true
fi

OWNER="${SUDO_USER:-$USER}"              # who owns the repo
FQDN="${ITS_SERVER_NAME:-$(hostname -f)}"

log(){ printf "\n[INFO] %s\n" "$*"; }
warn(){ printf "\n[WARN] %s\n" "$*"; }
die(){ printf "\n[ERROR] %s\n" "$*"; exit 1; }

# ---------------------------
# Helpers
# ---------------------------
docker_cmd() {
  local D="${DOCKER:-docker}"
  if ! $D ps >/dev/null 2>&1; then
    D="sudo docker"
  fi
  echo "$D"
}

detect_site_file() {
  # explicit override
  if [[ -n "$SITE_OVERRIDE" ]]; then
    [[ -f "$SITE_OVERRIDE" ]] || die "Specified --site not found: $SITE_OVERRIDE"
    echo "$SITE_OVERRIDE"; return
  fi

  # match by server_name
  local matches
  mapfile -t matches < <(grep -l "server_name[[:space:]]\+.*$FQDN" /etc/nginx/sites-available/* 2>/dev/null || true)
  if [[ ${#matches[@]} -eq 1 ]]; then
    echo "${matches[0]}"; return
  fi

  # fallback: only one 443 site
  mapfile -t matches < <(grep -l "listen[[:space:]]\+443" /etc/nginx/sites-available/* 2>/dev/null || true)
  if [[ ${#matches[@]} -eq 1 ]]; then
    echo "${matches[0]}"; return
  fi

  echo ""   # not found
}

patch_nginx_prefix() {
  local SITE="$1"
  if [[ -z "$SITE" || ! -f "$SITE" ]]; then
    warn "Could not find nginx vhost to patch. Use --site /etc/nginx/sites-available/<file> or set ITS_SERVER_NAME."
    return 0
  fi

  log "Patching nginx to serve ${PUBLIC_PREFIX} → http://127.0.0.1:${HOST_PORT}/"
  cp -f "$SITE" "$SITE.bak.$(date +%s)" || true

  # Insert/replace a location ${PUBLIC_PREFIX} block inside the HTTPS server
  # We keep it simple: put the one-liner before any generic 'location / { ... }'
  awk -v prefix="${PUBLIC_PREFIX}" -v hostport="${HOST_PORT}" '
    BEGIN{in_srv=0; in_https=0; replaced=0; skip=0; srv_depth=0}
    /^\s*server\s*\{/ {srv_depth=1; in_srv=1; in_https=0}
    in_srv && /\{/ { if ($0 !~ /^\s*server\s*\{/) srv_depth++ }
    in_srv && /\}/ { srv_depth--; if (srv_depth==0){in_srv=0; in_https=0} }

    in_srv && /listen[^;]*443/ { in_https=1 }

    in_https && $0 ~ "location[[:space:]]+" prefix "\\s*\\{" {
      print "  location " prefix " { proxy_pass http://127.0.0.1:" hostport "/; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection \"upgrade\"; proxy_set_header Host $host; }"
      replaced=1; skip=1; next
    }
    skip {
      if ($0 ~ /\}/) { skip=0 }
      next
    }

    in_https && !replaced && /^\s*location\s+\/\s*\{/ {
      print "  location " prefix " { proxy_pass http://127.0.0.1:" hostport "/; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection \"upgrade\"; proxy_set_header Host $host; }"
      replaced=1
    }

    {print}
  ' "$SITE" > "$SITE.tmp" && mv "$SITE.tmp" "$SITE"

  nginx -t
  systemctl reload nginx
}

wait_http() {
  local url="$1" max="${2:-30}"
  for i in $(seq 1 "$max"); do
    if curl -fsS "$url" >/dev/null 2>&1; then
      echo "ok"; return 0
    fi
    sleep 0.5
  done
  return 1
}

# ---------------------------
# Main
# ---------------------------
log "Sync runner to ${DST}"
sudo mkdir -p "$DST"
sudo rsync -a --delete "$SRC/" "$DST/"

log "Build & (re)start container"
cd "$DST"

D=$(docker_cmd)
$D system prune -f >/dev/null 2>&1 || true

# Build
$D build --pull -t "${CONTAINER_IMAGE}" .

# Prefer compose if present; otherwise run straight docker
if [[ -f docker-compose.yml || -f compose.yml ]]; then
  # Ensure compose uses our desired ports/env (optional: rely on file)
  $D compose down || true
  $D compose up -d
else
  # fallback plain docker run
  $D rm -f "${CONTAINER_NAME}" >/dev/null 2>&1 || true
  $D run -d --restart=always \
    --name "${CONTAINER_NAME}" \
    -p "${HOST_PORT}:${INTERNAL_PORT}" \
    "${CONTAINER_IMAGE}"
fi

log "Local health check (http://127.0.0.1:${HOST_PORT}/health)"
if ! wait_http "http://127.0.0.1:${HOST_PORT}/health" 60 >/dev/null; then
  warn "Local health endpoint not responding yet (continuing)."
fi

# OpenAPI paths (best effort)
curl -fsS "http://127.0.0.1:${HOST_PORT}/openapi.json" | jq '.paths' || true

# Patch nginx site to expose PUBLIC_PREFIX
SITE_FILE="$(detect_site_file)"
if [[ -z "$SITE_FILE" ]]; then
  warn "No nginx site auto-detected. Set ITS_SERVER_NAME or pass --site /etc/nginx/sites-available/<file>"
else
  log "Detected nginx site: ${SITE_FILE}"
  patch_nginx_prefix "$SITE_FILE"
fi

HTTPS_URL="https://${FQDN}${PUBLIC_PREFIX%/}/health"
log "HTTPS health check (${HTTPS_URL})"
curl -fsS "$HTTPS_URL" || true
echo

$D ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'

log "Runner deploy complete."
echo "Exposed at: https://${FQDN}${PUBLIC_PREFIX}"
