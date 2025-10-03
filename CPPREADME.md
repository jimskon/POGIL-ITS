1) Build JupyterLite for a subpath

When you build, set the base URL to /xcpp/ so all asset URLs and the service worker scope are correct:

python3 -m venv .venv && source .venv/bin/activate
pip install -U pip jupyterlite jupyterlite-xeus

# C++ kernel
cat > environment.yml << 'YAML'
name: xcpp-env
channels:
  - https://prefix.dev/emscripten-forge-dev
  - https://prefix.dev/conda-forge
dependencies:
  - xeus-cpp
YAML

# Build with a base URL
jupyter lite build --base-url /xcpp/ --XeusAddon.environment_file=environment.yml


Copy the output to the web root:

sudo mkdir -p /var/www/html/xcpp
sudo rsync -a _output/ /var/www/html/xcpp/
sudo find /var/www/html/xcpp -type d -exec chmod 755 {} \;
sudo find /var/www/html/xcpp -type f -exec chmod 644 {} \;

2) Nginx: add a static location for /xcpp/

In both the HTTP (80) and HTTPS (443) server blocks, add this above your location / { proxy_pass ... }:

# Serve JupyterLite statically at /xcpp/
location ^~ /xcpp/ {
  alias /var/www/html/xcpp/;    # note the trailing slash on alias
  try_files $uri $uri/ =404;
  expires 1h;
}


Your final shape will look like (showing the HTTPS block; do the same in HTTP):

server {
  listen 443 ssl http2;
  server_name csits.kenyon.edu;

  ssl_certificate     /etc/ssl/certs/csits.crt;
  ssl_certificate_key /etc/ssl/private/csits.key;

  access_log /var/log/nginx/csits.access.log;
  error_log  /var/log/nginx/csits.error.log;

  # 1) Carve out JupyterLite
  location ^~ /xcpp/ {
    alias /var/www/html/xcpp/;
    try_files $uri $uri/ =404;
    expires 1h;
  }

  # (keep phpMyAdmin blocks as-is)
  location /phpmyadmin { ... }

  location ~ \.php$ { ... }

  # 2) Everything else → React app on :4000
  location / {
    proxy_pass         http://127.0.0.1:4000/;
    proxy_http_version 1.1;
    proxy_set_header   Upgrade $http_upgrade;
    proxy_set_header   Connection "upgrade";
    proxy_set_header   Host $host;
    proxy_set_header   X-Forwarded-For  $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    proxy_read_timeout 60s;
  }
}


Reload Nginx:

sudo nginx -t && sudo systemctl reload nginx

3) Test it

Static site: curl -I https://csits.kenyon.edu/xcpp/index.html → 200 OK

Lab UI: open https://csits.kenyon.edu/xcpp/lab/

Lightweight REPL: https://csits.kenyon.edu/xcpp/repl/

If you see the React app instead, the location ^~ /xcpp/ isn’t above location / or the alias path is wrong.

4) (Optional) Embed in your app

You can now iframe the client-only C++ REPL anywhere in your React app:

const code = `#include <iostream>
int main(){ std::cout<<"Hello POGIL!\\n"; }`;
const src = `/xcpp/repl/index.html?kernel=cpp&toolbar=1&execute=0&code=${encodeURIComponent(code)}`;

<iframe
  src={src}
  style={{ width:'100%', height:520, border:'1px solid #eee', borderRadius:10 }}
  loading="lazy"
/>


That’s it—C++ runs fully in the browser, no server runtime, and your /xcpp/ path won’t get hijacked by the :4000 proxy.
