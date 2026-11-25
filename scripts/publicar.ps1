# Compila el instalador firmado de MahzzTerm y arma los archivos del release.
# Con -Publicar, además crea el release en GitHub (es público: hacelo cuando estés seguro).
#
#   .\scripts\publicar.ps1             # solo compila y prepara los archivos
#   .\scripts\publicar.ps1 -Publicar   # compila y publica el release vX.Y.Z
#   .\scripts\publicar.ps1 -SinCompilar  # solo arma los archivos con un instalador ya hecho
#                                        # (lo usa GitHub Actions después de firmar con SignPath)
#
# Necesita la clave privada de firma en ~\.tauri\mahzzterm.key (nunca va al repo).
# Si se pierde, las copias instaladas no van a aceptar actualizaciones nuevas.
param([switch]$Publicar, [switch]$SinCompilar)

$ErrorActionPreference = "Stop"
$raiz = Split-Path $PSScriptRoot -Parent
Set-Location $raiz

$version = (Get-Content "src-tauri\tauri.conf.json" -Raw | ConvertFrom-Json).version
Write-Host "MahzzTerm $version" -ForegroundColor Magenta

if (-not $SinCompilar) {
$clave = Join-Path $env:USERPROFILE ".tauri\mahzzterm.key"
if (-not (Test-Path $clave)) { throw "Falta la clave de firma en $clave" }

# Si el .exe está abierto (la app o el MCP de Claude Code), se renombra sin cerrarlo.
# Se prueba abriéndolo en exclusiva en vez de comparar rutas: con la carpeta enlazada desde otro
# disco, el proceso puede haberlo abierto por otra ruta.
$exe = Join-Path $raiz "src-tauri\target\release\MahzzTerm.exe"
if (Test-Path $exe) {
    try {
        [IO.File]::Open($exe, 'Open', 'ReadWrite', 'None').Close()
    } catch {
        Move-Item -LiteralPath $exe -Destination ($exe -replace '\.exe$', "-en-uso-$(Get-Date -Format HHmmss).exe")
        Write-Host "El .exe estaba abierto: lo renombré sin cerrarlo."
    }
}

$env:TAURI_SIGNING_PRIVATE_KEY = [IO.File]::ReadAllText($clave)
# La clave se generó con la contraseña literal "" (dos comillas).
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = '""'
try {
    pnpm tauri build
    if ($LASTEXITCODE -ne 0) { throw "Falló la compilación" }
} finally {
    Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY, Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
}
}

$nsis = "src-tauri\target\release\bundle\nsis"
$instalador = Get-Item "$nsis\MahzzTerm_${version}_x64-setup.exe"
$firma = (Get-Content "$($instalador.FullName).sig" -Raw).Trim()

$salida = "src-tauri\target\release\publicar"
if (Test-Path $salida) { Remove-Item $salida -Recurse -Force }
New-Item -ItemType Directory $salida | Out-Null
Copy-Item $instalador.FullName "$salida\$($instalador.Name)"
# Nombre fijo para que la web pueda enlazar siempre al último instalador.
Copy-Item $instalador.FullName "$salida\MahzzTerm-setup.exe"

# Las notas salen de la sección de esta versión en CHANGELOG.md.
$changelog = Get-Content "CHANGELOG.md" -Raw
$seccion = [regex]::Match($changelog, "(?s)## \[$([regex]::Escape($version))\][^\n]*\n(.*?)(?=\n## \[|\z)")
$notas = if ($seccion.Success) { $seccion.Groups[1].Value.Trim() } else { "MahzzTerm $version" }
Set-Content "$salida\notas.md" $notas -Encoding utf8

# latest.json es lo que consulta la app para saber si hay una versión nueva.
$ultimo = [ordered]@{
    version   = $version
    notes     = "MahzzTerm $version"
    pub_date  = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ssZ")
    platforms = [ordered]@{
        "windows-x86_64" = [ordered]@{
            signature = $firma
            url       = "https://github.com/MateoHdzC/mahzz-term/releases/download/v$version/$($instalador.Name)"
        }
    }
}
$ultimo | ConvertTo-Json -Depth 5 | Set-Content "$salida\latest.json" -Encoding utf8

Write-Host "Archivos listos en $salida" -ForegroundColor Green
Get-ChildItem $salida | Format-Table Name, @{ n = "MB"; e = { [math]::Round($_.Length / 1MB, 1) } } -AutoSize

if ($Publicar) {
    gh release create "v$version" `
        "$salida\$($instalador.Name)" "$salida\MahzzTerm-setup.exe" "$salida\latest.json" `
        --repo MateoHdzC/mahzz-term --title "MahzzTerm $version" --notes-file "$salida\notas.md"
    if ($LASTEXITCODE -ne 0) { throw "No se pudo crear el release" }
    Write-Host "Release v$version publicado." -ForegroundColor Green
}
