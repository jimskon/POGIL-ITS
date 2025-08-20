Perfect—here’s a tight, production-ready setup for your Express + Vite React app on Ubuntu 24.04, **behind a firewall**, with **nginx** in front and a **proper TLS cert**.

---

# 0) Stop Apache and install nginx + PM2

```bash
sudo systemctl stop apache2
sudo systemctl disable apache2

sudo apt update
sudo apt install -y nginx
sudo npm i -g pm2
```

# 1) Build & run your app (PM2)

From your repo root (with `server/` and `client/`):

```bash
# Install deps
(cd server && npm ci)
(cd client && npm ci)

# Build the React frontend (Vite → client/dist)
cd client && npm run build && cd ..

# Start API with PM2 (adjust PORT to whatever your server uses; 4000 is common)
PORT=4000 NODE_ENV=production pm2 start server/index.js --name pogil-its
pm2 save
pm2 startup   # run the one-time sudo command it prints
```

> Optional: in `client/.env`, set `VITE_API_BASE_URL=/api` so the browser hits same-origin `/api` (cleanest behind nginx).

# 2) nginx config (serve React, proxy /api to Node)

Create `/etc/nginx/sites-available/pogil-its` (replace the paths and port if needed):

```nginx
server {
  listen 80;
  listen [::]:80;
  server_name csits.kenyon.edu;

  # Serve built frontend
  root /path/to/POGIL-ITS/client/dist;
  index index.html;

  # React router fallback
  location / {
    try_files $uri /index.html;
  }

  # API → Node
  location /api/ {
    proxy_pass         http://127.0.0.1:4000/;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_read_timeout 60s;
  }

  # (optional) gzip
  gzip on;
  gzip_types text/plain text/css application/javascript application/json image/svg+xml;
}
```

Enable & reload:

```bash
sudo ln -s /etc/nginx/sites-available/pogil-its /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

# 3) TLS on an internal-only host: choose one path

## A) Best if you control public DNS for `kenyon.edu`: **Let’s Encrypt DNS-01**

You don’t need inbound 80/443 open for DNS-01.

```bash
sudo apt install -y certbot
sudo certbot certonly --manual --preferred-challenges dns \
  -d csits.kenyon.edu --agree-tos -m you@kenyon.edu --no-eff-email
```

Certbot will show a TXT value. Add it to the **public** DNS as
`_acme-challenge.csits.kenyon.edu` → TXT `...value...`, wait a minute, then continue.
When it succeeds, point nginx at the certs:

```nginx
# Add to your server block (or create a :443 block)
listen 443 ssl http2;
ssl_certificate     /etc/letsencrypt/live/csits.kenyon.edu/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/csits.kenyon.edu/privkey.pem;
```

And add an HTTP→HTTPS redirect server on :80 if you like.
⚠️ Renewal: manual DNS-01 isn’t automatic. For automation, use a DNS plugin (e.g., Cloudflare/Route53) or ask IT to provide an API/ACME integration.

## B) If your institution has an **internal CA** (recommended for campus-only)

1. Make a key & CSR with SAN:

```bash
sudo openssl req -new -newkey rsa:2048 -nodes \
  -keyout /etc/ssl/private/csits.kenyon.edu.key \
  -out /etc/ssl/csits.kenyon.edu.csr \
  -subj "/CN=csits.kenyon.edu" \
  -addext "subjectAltName=DNS:csits.kenyon.edu"
```

2. Submit the CSR to the internal CA, get back the cert (and chain). Save as:

```
/etc/ssl/certs/csits.kenyon.edu.crt
/etc/ssl/certs/csits.kenyon.edu.chain.crt   # if provided
```

3. Point nginx to them:

```nginx
listen 443 ssl http2;
ssl_certificate     /etc/ssl/certs/csits.kenyon.edu.crt;
ssl_certificate_key /etc/ssl/private/csits.kenyon.edu.key;
ssl_trusted_certificate /etc/ssl/certs/csits.kenyon.edu.chain.crt;  # if you have a chain
```

Campus-managed devices usually already trust the internal root, so no browser warnings.

## C) Small, trusted audience only: **mkcert** (locally trusted)

Generate a cert trusted by your own machines (you must install mkcert’s local CA on each client):

```bash
# On a dev/workstation:
mkcert -install
mkcert csits.kenyon.edu
# copies two files, e.g., csits.kenyon.edu.pem and csits.kenyon.edu-key.pem
# move them to the server:
sudo mv csits.kenyon.edu.pem /etc/ssl/certs/
sudo mv csits.kenyon.edu-key.pem /etc/ssl/private/
```

Point nginx to them (like in option B). Good for small internal teams; not scalable to an entire campus.

> **Self-signed** is possible but will show browser warnings unless every client imports your CA—usually not worth it.

# 4) Reload nginx and test

```bash
sudo nginx -t && sudo systemctl reload nginx

# Local tests from the server
curl -I http://csits.kenyon.edu
curl -I https://csits.kenyon.edu  # after TLS is configured

# App health
pm2 status
pm2 logs pogil-its
```

---

## What I’d pick for you

* Keep **nginx**.
* Build client → serve `/client/dist` from nginx; proxy `/api` to Node on `:4000`.
* For certs:

  * If you can add a public TXT record in `kenyon.edu`, use **Let’s Encrypt DNS-01**.
  * Otherwise, ask Kenyon IT for an **internal CA cert** for `csits.kenyon.edu` (cleanest for a firewall-only host).

If you tell me which cert route you’ll use (DNS-01 vs internal CA), I’ll give you the exact nginx server block with TLS included.
