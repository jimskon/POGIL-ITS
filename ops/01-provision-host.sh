#!/usr/bin/env bash
set -euo pipefail

# --- sanity: must be root or sudo ---
if [[ $EUID -ne 0 ]]; then
  echo "Please run as root: sudo $0"
  exit 1
fi

echo "==> Install Docker if missing"
if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
    > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker

echo "==> Add '${SUDO_USER:-$USER}' to docker group (won't take effect until re-login)"
usermod -aG docker "${SUDO_USER:-$USER}" || true

echo "==> Install/enable logrotate for PM2 (prevents giant logs)"
if command -v pm2 >/dev/null 2>&1; then
  sudo -u "${SUDO_USER:-$USER}" pm2 install pm2-logrotate || true
  sudo -u "${SUDO_USER:-$USER}" pm2 set pm2-logrotate:max_size 10M || true
  sudo -u "${SUDO_USER:-$USER}" pm2 set pm2-logrotate:retain 5 || true
  sudo -u "${SUDO_USER:-$USER}" pm2 set pm2-logrotate:compress true || true
  sudo -u "${SUDO_USER:-$USER}" pm2 save || true
fi

echo "==> Install Nginx (if missing)"
if ! command -v nginx >/dev/null 2>&1; then
  apt-get update && apt-get install -y nginx
fi

echo "==> Write /etc/nginx/snippets/cxx-run.conf"
install -d /etc/nginx/snippets
cp -f "$(dirname "$0")/nginx/cxx-run.conf" /etc/nginx/snippets/cxx-run.conf

echo "==> REMINDER: include the snippet in your TLS server block:"
echo "   include /etc/nginx/snippets/cxx-run.conf;"
echo "   Then: nginx -t && systemctl reload nginx"

echo "==> Done."
