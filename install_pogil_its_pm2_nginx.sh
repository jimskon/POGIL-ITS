#!/usr/bin/env bash
# POGIL-ITS installer (PM2 + Nginx) for Ubuntu 24.04
# Usage: sudo bash install_pogil_its_pm2_nginx.sh
set -euo pipefail

APP_USER=${SUDO_USER:-$(logname)}
APP_HOME=$(getent passwd "$APP_USER" | cut -d: -f6)

# -------- Inputs --------
read -rp "Domain or IP (server_name) (e.g., csits.kenyon.edu or 10.0.0.5): " SITE_DOMAIN
read -rp "Install phpMyAdmin? (y/N): " WANT_PHPMYADMIN
WANT_PHPMYADMIN=${WANT_PHPMYADMIN,,}

read -rp "MariaDB root password (press Enter if none yet): " -s DB_ROOT_PW || true
echo
read -rp "Create DB user password for 'pogil_user': " -s DB_USER_PW
echo
read -rp "OpenAI API key (optional): " OPENAI_API_KEY
echo

# -------- Constants --------
APP_DIR="/opt/POGIL-ITS"
SERVER_DIR="$APP_DIR/server"
CLIENT_DIR="$APP_DIR/client"
FRONT_DIST="$CLIENT_DIR/dist"
NODE_PORT=4000
DB_NAME="pogil_db"
DB_USER="pogil_user"

NGINX_SITE_AV="/etc/nginx/sites-available/pogil-its"
NGINX_SITE_EN="/etc/nginx/sites-enabled/pogil-its"

# -------- Helpers --------
mysql_root() {
  if [[ -n "${DB_ROOT_PW:-}" ]]; then mysql -u root -p"$DB_ROOT_PW" -e "$1"
  else mysql -u root -e "$1"; fi
}

schema_path() {
  if [[ -f "$APP_DIR/schema.sql" ]]; then echo "$APP_DIR/schema.sql"
  elif [[ -f "$SERVER_DIR/schema.sql" ]]; then echo "$SERVER_DIR/schema.sql"
  else echo ""; fi
}

# -------- Begin --------
if [[ $EUID -ne 0 ]]; then echo "Run as root: sudo bash $0"; exit 1; fi

apt-get update
DEBIAN_FRONTEND=noninteractive apt-get install -y ca-certificates curl git build-essential ufw software-properties-common

# Nginx (disable Apache if present)
if systemctl is-enabled --quiet apache2 2>/dev/null || systemctl is-active --quiet apache2 2>/dev/null; then
  systemctl disable --now apache2 || true
fi
apt-get install -y nginx
systemctl enable --now nginx

# Optional: phpMyAdmin & PHP-FPM (for Nginx)
if [[ "$WANT_PHPMYADMIN" == "y" ]]; then
  apt-get install -y php-fpm php-mysql php-zip php-gd php-json php-curl php-mbstring php-cli phpmyadmin
  PHP_FPM_SOCK=$(find /run/php -maxdepth 1 -name 'php*-fpm.sock' | head -n1 || true)
  [[ -z "$PHP_FPM_SOCK" ]] && PHP_FPM_SOCK="/run/php/php8.3-fpm.sock"
else
  PHP_FPM_SOCK="/run/php/php8.3-fpm.sock"
fi

# MariaDB
apt-get install -y mariadb-server
systemctl enable --now mariadb

# Set root pw if provided and none set yet
if mysql -u root -e "SELECT 1" >/dev/null 2>&1 && [[ -n "${DB_ROOT_PW:-}" ]]; then
  mysql -u root <<SQL
ALTER USER 'root'@'localhost' IDENTIFIED BY '${DB_ROOT_PW}';
FLUSH PRIVILEGES;
SQL
fi

# DB + user
mysql_root "CREATE DATABASE IF NOT EXISTS ${DB_NAME} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
mysql_root "CREATE USER IF NOT EXISTS '${DB_USER}'@'localhost' IDENTIFIED BY '${DB_USER_PW}';"
mysql_root "GRANT ALL PRIVILEGES ON ${DB_NAME}.* TO '${DB_USER}'@'localhost'; FLUSH PRIVILEGES;"

# Node 18.x
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs
node -v && npm -v

# Clone / update repo
if [[ -d "$APP_DIR/.git" ]]; then
  git -C "$APP_DIR" fetch --all --prune
  git -C "$APP_DIR" reset --hard origin/HEAD
else
  git clone https://github.com/jimskon/POGIL-ITS.git "$APP_DIR"
fi

# Backend deps
cd "$SERVER_DIR"
rm -rf node_modules package-lock.json 2>/dev/null || true
npm install

# Frontend deps
cd "$CLIENT_DIR"
rm -rf node_modules package-lock.json 2>/dev/null || true
npm install

# Env files
cat > "$SERVER_DIR/.env" <<ENV
PORT=$NODE_PORT
DB_HOST=localhost
DB_PORT=3306
DB_USER=$DB_USER
DB_PASSWORD=$DB_USER_PW
DB_NAME=$DB_NAME
SESSION_SECRET=$(openssl rand -hex 24)
OPENAI_API_KEY=$OPENAI_API_KEY
# (If you add Google OAuth later, drop GOOGLE_* here)
ENV

# Important: use same-origin API
cat > "$CLIENT_DIR/.env" <<ENV
VITE_API_BASE_URL=
VITE_SERVICE_ACCOUNT_EMAIL=pogil-sheets-reader@pogil-its.iam.gserviceaccount.com
ENV

# Build frontend for ROOT (/)
cd "$CLIENT_DIR"
npx vite build

# PM2 (run under your login user, not root)
npm i -g pm2
sudo -u "$APP_USER" -H bash -lc "cd '$SERVER_DIR' && pm2 start index.js --name pogil-its"
sudo -u "$APP_USER" -H bash -lc "pm2 save"
# persist on boot
sudo -u "$APP_USER" -H bash -lc "pm2 startup systemd -u '$APP_USER' --hp '$APP_HOME' | tail -n +1"
STARTUP_CMD=$(sudo -u "$APP_USER" -H bash -lc "pm2 startup systemd -u '$APP_USER' --hp '$APP_HOME' | grep sudo" || true)
if [[ -n "$STARTUP_CMD" ]]; then eval "$STARTUP_CMD"; fi
sudo -u "$APP_USER" -H bash -lc "pm2 save"

# Nginx site (proxy all "/" to Node; carve out /phpmyadmin and /xcpp)
cat > "$NGINX_SITE_AV" <<NGINX
server {
  listen 80;
  server_name ${SITE_DOMAIN};

  access_log /var/log/nginx/pogil-its.access.log;
  error_log  /var/log/nginx/pogil-its.error.log;

  # phpMyAdmin (optional)
  location /phpmyadmin {
    alias /usr/share/phpmyadmin;
    index index.php index.html index.htm;

    location ~* ^/phpmyadmin/(.+\.(css|js|png|jpg|jpeg|gif|ico|svg|woff2?|ttf))$ {
      try_files \$uri =404;
    }
    location ~ ^/phpmyadmin/(.+\.php)$ {
      include snippets/fastcgi-php.conf;
      fastcgi_param SCRIPT_FILENAME \$request_filename;
      fastcgi_pass unix:${PHP_FPM_SOCK};
    }
  }

  # JupyterLite C++ (if present)
  location ^~ /xcpp/ {
    alias /var/www/html/xcpp/;
    try_files \$uri \$uri/ =404;
    expires 1h;
  }

  # Everything else -> Node (PM2) on 4000
  location / {
    proxy_pass         http://127.0.0.1:${NODE_PORT}/;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade \$http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host \$host;
    proxy_set_header   X-Forwarded-For  \$proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto \$scheme;
    proxy_read_timeout 60s;
  }
}
NGINX

ln -sf "$NGINX_SITE_AV" "$NGINX_SITE_EN"
nginx -t
systemctl reload nginx

# Import schema if present
SCHEMA_FILE="$(schema_path)"
if [[ -n "$SCHEMA_FILE" ]]; then
  echo "Importing schema: $SCHEMA_FILE"
  mysql -u "$DB_USER" -p"$DB_USER_PW" "$DB_NAME" < "$SCHEMA_FILE" || true
else
  echo "NOTE: No schema.sql found; import manually if needed."
fi

# Firewall (optional)
if command -v ufw >/dev/null 2>&1; then
  ufw allow OpenSSH >/dev/null 2>&1 || true
  ufw allow "Nginx Full" >/dev/null 2>&1 || true
fi

echo
echo "====================== DONE ======================"
echo " App via Nginx:   http://${SITE_DOMAIN}/"
echo " API path:        http://${SITE_DOMAIN}/api"
echo " PM2:             sudo -u $APP_USER pm2 status | pm2 logs pogil-its"
echo "=================================================="
