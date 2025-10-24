# C++ Implementation

## Deploy
```
cd /opt/cxx-runner
sudo docker compose down
sudo docker compose up -d

```

## Check
```
curl -sS http://127.0.0.1:5055/health
curl -sS http://127.0.0.1:5055/openapi.json | jq '.paths'

```
