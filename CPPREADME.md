
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

curl -sS http://127.0.0.1:5055/health
curl -sS https://$(hostname -f)/cxx-run/health
```
## Open https://<host>/its/
