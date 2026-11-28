$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot
tar -czf - mahzz_api.py Dockerfile compose.yaml | ssh hrdzz-claude 'set -e
D=/srv/apps/mahzz-api
sudo mkdir -p $D
sudo tar -C $D --no-same-permissions --no-same-owner -xzf -
sudo chmod 644 $D/mahzz_api.py $D/Dockerfile $D/compose.yaml
sudo test -f $D/.env || { echo "Falta $D/.env"; exit 1; }
sudo docker compose --project-directory $D -f $D/compose.yaml up -d --build
sleep 3
sudo docker exec mahzz-api python -c "import urllib.request; print(urllib.request.urlopen(\"http://127.0.0.1:8080/api/salud\").read().decode())"'
if ($LASTEXITCODE -ne 0) { throw "No se pudo desplegar el backend" }
Write-Host "Backend actualizado: https://mahzzterm.xyz/api/salud" -ForegroundColor Green
