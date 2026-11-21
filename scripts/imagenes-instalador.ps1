# Genera las imágenes del instalador (NSIS) con la identidad de MahzzTerm.
# Salen de src-tauri\icons\icon.png. Se vuelven a generar con:
#   .\scripts\imagenes-instalador.ps1
Add-Type -AssemblyName System.Drawing
$ErrorActionPreference = "Stop"
$raiz = Split-Path $PSScriptRoot -Parent
$salida = Join-Path $raiz "src-tauri\instalador"
New-Item -ItemType Directory -Force $salida | Out-Null
$logo = [Drawing.Image]::FromFile((Join-Path $raiz "src-tauri\icons\icon.png"))

function Color([string]$hex, [int]$alfa = 255) {
    $c = [Drawing.ColorTranslator]::FromHtml($hex)
    [Drawing.Color]::FromArgb($alfa, $c.R, $c.G, $c.B)
}

function Lienzo([int]$ancho, [int]$alto) {
    $imagen = New-Object Drawing.Bitmap $ancho, $alto, ([Drawing.Imaging.PixelFormat]::Format24bppRgb)
    $g = [Drawing.Graphics]::FromImage($imagen)
    $g.SmoothingMode = "AntiAlias"
    $g.InterpolationMode = "HighQualityBicubic"
    $g.TextRenderingHint = "AntiAliasGridFit"
    return $imagen, $g
}

function TextoCentrado($g, [string]$texto, $fuente, $pincel, [int]$ancho, [float]$y) {
    $formato = New-Object Drawing.StringFormat
    $formato.Alignment = "Center"
    $g.DrawString($texto, $fuente, $pincel, (New-Object Drawing.RectangleF 0, $y, $ancho, 60), $formato)
}

# Panel lateral (bienvenida y final): 164x314, oscuro con brillo violeta
$imagen, $g = Lienzo 164 314
$fondo = New-Object Drawing.Drawing2D.LinearGradientBrush (New-Object Drawing.Point 0, 0), (New-Object Drawing.Point 0, 314), (Color "#140a24"), (Color "#050507")
$g.FillRectangle($fondo, 0, 0, 164, 314)
$brillo = New-Object Drawing.Drawing2D.GraphicsPath
$brillo.AddEllipse(-30, 20, 224, 190)
$degradado = New-Object Drawing.Drawing2D.PathGradientBrush $brillo
$degradado.CenterColor = Color "#8b45ff" 110
$degradado.SurroundColors = @((Color "#8b45ff" 0))
$g.FillPath($degradado, $brillo)
$g.DrawImage($logo, 27, 46, 110, 110)
$titulo = New-Object Drawing.Font "Segoe UI Semibold", 16
$sub = New-Object Drawing.Font "Segoe UI", 8.5
$chica = New-Object Drawing.Font "Segoe UI", 7.5
TextoCentrado $g "MahzzTerm" $titulo (New-Object Drawing.SolidBrush (Color "#ffffff")) 164 172
TextoCentrado $g "La terminal para" $sub (New-Object Drawing.SolidBrush (Color "#c9a6ff")) 164 206
TextoCentrado $g "tus agentes de IA" $sub (New-Object Drawing.SolidBrush (Color "#c9a6ff")) 164 222
$g.FillRectangle((New-Object Drawing.SolidBrush (Color "#8b45ff")), 62, 252, 40, 2)
TextoCentrado $g "mahzzterm.xyz" $chica (New-Object Drawing.SolidBrush (Color "#9a98a8")) 164 284
$imagen.Save((Join-Path $salida "lateral.bmp"), [Drawing.Imaging.ImageFormat]::Bmp)
$imagen.Save((Join-Path $salida "lateral-vista.png"), [Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $imagen.Dispose()

# Encabezado de cada paso: 150x57, claro (la franja de arriba del instalador es blanca)
$imagen, $g = Lienzo 150 57
$g.Clear((Color "#ffffff"))
$g.DrawImage($logo, 104, 8, 41, 41)
$nombre = New-Object Drawing.Font "Segoe UI Semibold", 11
$formato = New-Object Drawing.StringFormat
$formato.Alignment = "Far"
$g.DrawString("MahzzTerm", $nombre, (New-Object Drawing.SolidBrush (Color "#3b1a7a")), (New-Object Drawing.RectangleF 0, 18, 100, 24), $formato)
$imagen.Save((Join-Path $salida "encabezado.bmp"), [Drawing.Imaging.ImageFormat]::Bmp)
$imagen.Save((Join-Path $salida "encabezado-vista.png"), [Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $imagen.Dispose()

$logo.Dispose()
Write-Host "Imágenes del instalador listas en $salida" -ForegroundColor Green
