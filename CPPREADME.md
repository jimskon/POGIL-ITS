
```
cd /opt/POGIL-ITS/ops
```
## 1) Provision once (Docker, Node, Nginx, snippet, PM2 logrotate)
```
sudo ./01-provision-host.sh
```
## 2) Deploy C++ runner behind Nginx
```
./02-deploy-cxx-runner.sh   # use sudo if you haven’t re-logged into docker group
```
## 3) Build & deploy frontend to /its/
```
sudo ./03-deploy-frontend.sh

sudo nginx -t
sudo systemctl reload nginx

## Test
```
# through nginx (what the browser does)
```
curl -i -X POST https://csits.kenyon.edu/cxx-run/session/new \
  -H 'Content-Type: application/json' \
  --data '{"code":"#include <iostream>\nint main(){std::cout<<\"hi\";}\n"}'
```
curl -sS http://127.0.0.1:5055/health
curl -sS https://$(hostname -f)/cxx-run/health
```

##1) Stop the stray uvicorn (it was running with 2 workers)
### Find and kill the foreground/background uvicorn you started earlier
```
pgrep -af 'uvicorn app:app'         # see PIDs/args
pkill -f 'uvicorn app:app'          # stop it
```
##2) Create a venv in ops and install deps (if not already)
```
cd ~/POGIL-ITS/ops
python3 -m venv .venv
source .venv/bin/activate
pip install -U pip
```
### If you have requirements.txt here, use it:
```
[ -f requirements.txt ] && pip install -r requirements.txt || pip install fastapi uvicorn[standard]
deactivate
```
##3) Run the runner from ops via PM2 (one worker)
```
pm2 start "bash -lc 'cd ~/POGIL-ITS/ops && source .venv/bin/activate && uvicorn app:app --host 0.0.0.0 --port 8000 --workers 1'" \
  --name cxx-runner
pm2 save
pm2 status
```
# Test

## through nginx (what the browser does)
```
curl -si -X POST https://csits.kenyon.edu/cxx-run/session/new \
  -H 'Content-Type: application/json' \
  --data '{"code":"#include <iostream>\nint main(){std::cout<<\"hi\";}\n"}'

```
