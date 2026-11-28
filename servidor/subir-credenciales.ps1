param([string]$Json)
$ErrorActionPreference = "Stop"
if (-not $Json) {
    $Json = (Get-ChildItem "$HOME\Downloads\client_secret_*.json" | Sort-Object LastWriteTime -Descending | Select-Object -First 1).FullName
}
if (-not $Json -or -not (Test-Path $Json)) { throw "No encontré el JSON del cliente en Descargas" }
$web = (Get-Content $Json -Raw | ConvertFrom-Json).web
if (-not $web.client_id -or -not $web.client_secret) { throw "Ese JSON no es de un cliente 'Aplicación web'" }
$contenido = "GOOGLE_CLIENT_ID=$($web.client_id)`nGOOGLE_CLIENT_SECRET=$($web.client_secret)`nBASE_URL=https://mahzzterm.xyz`n"
$contenido | ssh hrdzz-claude 'set -e; sudo mkdir -p /srv/apps/mahzz-api; sudo install -m 600 /dev/stdin /srv/apps/mahzz-api/.env; echo ".env creado"'
if ($LASTEXITCODE -ne 0) { throw "No se pudo subir a la VPS" }
Remove-Item $Json
Write-Host "Listo. Borré el JSON de Descargas para que no quede dando vueltas." -ForegroundColor Green
