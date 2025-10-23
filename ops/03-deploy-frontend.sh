#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CLIENT="$REPO_ROOT/client"
SITE="/etc/nginx/sites-available/jimskon.com"
WWW="/var/www/html/its"

need_root() {
  if [[ $EUID -ne 0 ]]; then
    echo "Please run as root: sudo $0"
    exit 1
  fi
}

ensure_vite_base() {
  # Ensure Vite builds for subpath /its/
  if grep -q "base:" "$CLIENT/vite.config"*.js 2>/dev/null; then
    echo "vite.config already has base setting (please confirm /its/)."
  else
    echo "NOTE: make sure your vite.config sets base: '/its/' for correct asset paths."
  fi
}

ensure_xterm_deps() {
  cd "$CLIENT"
  # Ensure package.json has dependencies (idempotent)
  npm pkg get dependencies.xterm | grep -q null && npm pkg set dependencies.xterm="^5.5.0" || true
  npm pkg get dependencies["xterm-addon-fit"] | grep -q null && npm pkg set dependencies["xterm-addon-fit"]="^0.9.0" || true
  npm ci
}

build_and_install() {
  cd "$CLIENT"
  npm run build

  install -d "$WWW"
  rsync -a --delete "$CLIENT/dist/" "$WWW/"
}

fix_nginx_its_block() {
  # Replace any proxying /its/ with a static try_files block
  if [[ -f "$SITE" ]]; then
    cp -f "$SITE" "$SITE.bak.$(date +%s)" || true
    awk '
      BEGIN{in_its=0}
      # start of any location /its/ block
      $0 ~ /^[ \t]*location[ \t]+\/its\/[ \t]*\{/ { in_its=1; print "  location /its/ { try_files $uri $uri/ /its/index.html; }"; next }
      in_its {
        # consume lines until closing brace of that block
        if ($0 ~ /\}/) { in_its=0; next }
        next
      }
      { print }
    ' "$SITE" > "$SITE.tmp" && mv "$SITE.tmp" "$SITE"
    nginx -t
    systemctl reload nginx
  else
    echo "WARN: $SITE not found. Ensure your TLS vhost serves /var/www/html and has SPA fallback."
  fi
}

main() {
  need_root
  ensure_vite_base
  ensure_xterm_deps
  build_and_install
  fix_nginx_its_block

  echo "==> Frontend deployed to $WWW"
  echo "Try: https://$(hostname -f)/its/"
}

main "$@"
