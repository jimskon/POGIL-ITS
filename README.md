# POGIL-ITS Production Deployment Guide

This document describes how to deploy POGIL-ITS in **production** on Ubuntu 24.04 using:

- Node.js (Express backend)
- Vite (React frontend build)
- nginx (reverse proxy + static hosting)
- PM2 (process manager)
- Optional TLS (Let's Encrypt or internal CA)

This guide assumes:
- Ubuntu 24.04
- Firewall enabled (only 80/443 exposed)
- Backend runs locally on port 4000

---

# 1. Remove Apache (if installed)

```bash
sudo systemctl stop apache2
sudo systemctl disable apache2
```

---

# 2. Install Required Packages

```bash
sudo apt update
sudo apt install -y nginx
sudo apt install -y curl
sudo npm install -g pm2
```

Install Node LTS (if not already installed):

```bash
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt install -y nodejs
```

Verify:

```bash
node -v
npm -v
```

---

# 3. Clone Repository

```bash
git clone https://github.com/jimskon/POGIL-ITS.git
cd POGIL-ITS
```

---

# 4. Backend Setup

Install dependencies:

```bash
cd server
npm ci
cd ..
```

Create `server/.env`:

```env
PORT=4000
NODE_ENV=production

SESSION_SECRET=generate_a_secure_random_string

DB_HOST=localhost
DB_PORT=3306
DB_USER=pogil_user
DB_PASSWORD=strong_password_here
DB_NAME=pogil_db

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_REDIRECT_URI=

OPENAI_API_KEY=
```

---

# 5. Build Frontend

```bash
cd client
npm ci
npm run build
cd ..
```

This generates:

```
client/dist
```

Optional (recommended):  
In `client/.env`, set:

```env
VITE_API_BASE_URL=/api
```

This keeps API calls same-origin behind nginx.

---

# 6. Start Backend with PM2

From project root:

```bash
PORT=4000 NODE_ENV=production pm2 start server/index.js --name pogil-its
pm2 save
pm2 startup
```

Run the one-time `sudo` command PM2 prints.

Check status:

```bash
pm2 status
pm2 logs pogil-its
```

Restart later with:

```bash
pm2 restart pogil-its
```

---

# 7. nginx Configuration

Create:

```bash
sudo nano /etc/nginx/sites-available/pogil-its
```

Example config:

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name csits.kenyon.edu;

    root /path/to/POGIL-ITS/client/dist;
    index index.html;

    # React Router fallback
    location / {
        try_files $uri /index.html;
    }

    # Proxy API requests
    location /api/ {
        proxy_pass http://127.0.0.1:4000/;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_read_timeout 60s;
    }

    gzip on;
    gzip_types text/plain text/css application/javascript application/json image/svg+xml;
}
```

Enable site:

```bash
sudo ln -s /etc/nginx/sites-available/pogil-its /etc/nginx/sites-enabled/
sudo nginx -t
sudo systemctl reload nginx
```

Application is now available at:

```
http://csits.kenyon.edu
```

---

# 8. Enable HTTPS (Choose One)

## Option A: Let's Encrypt (DNS-01)

Best if public DNS is available.

```bash
sudo apt install -y certbot
sudo certbot certonly --manual --preferred-challenges dns \
  -d csits.kenyon.edu --agree-tos -m you@kenyon.edu --no-eff-email
```

Add certificate to nginx:

```nginx
listen 443 ssl http2;

ssl_certificate     /etc/letsencrypt/live/csits.kenyon.edu/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/csits.kenyon.edu/privkey.pem;
```

Reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

---

## Option B: Institutional Internal CA (Recommended for Campus)

Generate CSR:

```bash
sudo openssl req -new -newkey rsa:2048 -nodes \
  -keyout /etc/ssl/private/csits.kenyon.edu.key \
  -out /etc/ssl/csits.kenyon.edu.csr \
  -subj "/CN=csits.kenyon.edu" \
  -addext "subjectAltName=DNS:csits.kenyon.edu"
```

Submit CSR to internal CA.

Install returned cert:

```
/etc/ssl/certs/csits.kenyon.edu.crt
/etc/ssl/private/csits.kenyon.edu.key
```

Add to nginx:

```nginx
listen 443 ssl http2;

ssl_certificate     /etc/ssl/certs/csits.kenyon.edu.crt;
ssl_certificate_key /etc/ssl/private/csits.kenyon.edu.key;
```

Reload nginx.

---

# 9. Verify Deployment

```bash
sudo nginx -t
sudo systemctl reload nginx

curl -I http://csits.kenyon.edu
curl -I https://csits.kenyon.edu
```

Check backend:

```bash
pm2 status
pm2 logs pogil-its
```

---

# 10. Updating the System

Pull updates:

```bash
git pull
```

Rebuild frontend:

```bash
cd client
npm run build
cd ..
```

Restart backend:

```bash
pm2 restart pogil-its
```

---

# 11. Production Checklist

- [ ] Apache disabled
- [ ] nginx installed
- [ ] Database created
- [ ] Backend `.env` configured
- [ ] Frontend built
- [ ] PM2 running
- [ ] nginx proxy configured
- [ ] TLS configured
- [ ] Firewall allows 80/443 only

---

POGIL-ITS production deployment complete.
