# Se carga en cada sesión de mahzzterm sin modificar el $PROFILE del usuario.
# Marca dónde empieza y termina cada comando para poder armar los bloques.
$global:__mahzzEsc = [char]27
$global:__mahzzBel = [char]7
$global:__mahzzPromptOriginal = $function:prompt

function global:__mahzzBase64([string]$texto) {
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($texto))
}

# Lee la rama desde .git/HEAD: es mucho más rápido que ejecutar git en cada prompt.
function global:__mahzzRama {
    try {
        $carpeta = [IO.DirectoryInfo]::new((Get-Location).ProviderPath)
        while ($carpeta) {
            $git = [IO.Path]::Combine($carpeta.FullName, '.git')
            if ([IO.File]::Exists($git)) {
                $destino = ([IO.File]::ReadAllText($git).Trim() -replace '^gitdir:\s*', '')
                $git = [IO.Path]::GetFullPath($destino, $carpeta.FullName)
            }
            $head = [IO.Path]::Combine($git, 'HEAD')
            if ([IO.File]::Exists($head)) {
                $contenido = [IO.File]::ReadAllText($head).Trim()
                if ($contenido -like 'ref: refs/heads/*') { return $contenido.Substring(16) }
                return $contenido.Substring(0, [Math]::Min(7, $contenido.Length))
            }
            $carpeta = $carpeta.Parent
        }
    } catch { }
    ''
}

if (-not (Get-Module PSReadLine)) { Import-Module PSReadLine -ErrorAction Ignore }

if (Test-Path Function:\PSConsoleHostReadLine) {
    $global:__mahzzLeerOriginal = $function:PSConsoleHostReadLine

    # El editor manda el comando codificado para que varias líneas lleguen intactas.
    # Esa línea técnica no se guarda: en el historial queda el comando real.
    $global:__mahzzHistorialOriginal = (Get-PSReadLineOption).AddToHistoryHandler
    Set-PSReadLineOption -AddToHistoryHandler {
        param([string]$linea)
        if ($linea -like '#mahzz:*') { return $false }
        # PSReadLine guarda este filtro como delegado, por eso se llama con Invoke.
        if ($global:__mahzzHistorialOriginal) { return $global:__mahzzHistorialOriginal.Invoke($linea) }
        $true
    }

    function global:PSConsoleHostReadLine {
        $linea = & $global:__mahzzLeerOriginal
        if ($linea -like '#mahzz:*') {
            try {
                $linea = [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($linea.Substring(7)))
                [Microsoft.PowerShell.PSConsoleReadLine]::AddToHistory($linea)
            } catch { $linea = '' }
        }
        if (-not [string]::IsNullOrWhiteSpace($linea)) {
            [Console]::Write("$($global:__mahzzEsc)]133;C;$(__mahzzBase64 $linea)$($global:__mahzzBel)")
        }
        $linea
    }
}

# Las sesiones SSH interactivas cargan un script temporal para tener bloques en el servidor.
$global:__mahzzRemoto = "exec sh -c 'command -v bash >/dev/null 2>&1 && command -v base64 >/dev/null 2>&1 && f=`$(mktemp) && printf %s __MAHZZ_REMOTO__ | base64 -d > `$f && MAHZZ_RC=`$f exec bash --rcfile `$f -i; exec `${SHELL:-sh} -l'"

function global:ssh {
    $conValor = 'b', 'c', 'D', 'E', 'e', 'F', 'I', 'i', 'J', 'L', 'l', 'm', 'O', 'o', 'p', 'Q', 'R', 'S', 'W', 'w'
    $sinSesion = 'N', 'T', 'f', 'V', 'G', 'O', 'Q', 'W'
    $destino = $null
    $interactiva = $true

    for ($i = 0; $i -lt $args.Count; $i++) {
        $argumento = [string]$args[$i]
        if ($null -eq $destino -and $argumento -cmatch '^-.') {
            $letra = [string]$argumento[1]
            if ($sinSesion -ccontains $letra) { $interactiva = $false }
            if ($argumento.Length -eq 2 -and $conValor -ccontains $letra) { $i++ }
        } elseif ($null -eq $destino) {
            $destino = $argumento
        } else {
            $interactiva = $false
        }
    }

    $programa = (Get-Command ssh -CommandType Application | Select-Object -First 1).Source
    if ($destino -and $interactiva) { & $programa -t @args $global:__mahzzRemoto }
    else { & $programa @args }
}

# Órdenes para la propia terminal. Viajan como una marca invisible que lee la interfaz.
function global:mahzz {
    $orden = ($args | ForEach-Object { [string]$_ }) -join ' '
    $valida = $orden -match '^\s*(--resume|-r)(\s+\d+)?\s*$' -or $orden -match '^\s*(--agentes|--cambios)\s*$'
    if ($valida) {
        $orden = $orden.Trim() -replace '^-r\b', '--resume'
        [Console]::Write("$($global:__mahzzEsc)]133;X;$(__mahzzBase64 $orden)$($global:__mahzzBel)")
        return
    }
    if ($orden -and $orden -notmatch '^\s*(--help|-h)\s*$') {
        Write-Host "mahzz: no conozco '$orden'" -ForegroundColor Red
    }
    Write-Host 'MahzzTerm' -ForegroundColor Magenta
    Write-Host '  mahzz --resume      elegir una sesión anterior y abrir sus pestañas'
    Write-Host '  mahzz --resume 2    abrir directo la segunda sesión más reciente'
    Write-Host '  mahzz --agentes     ver los agentes que están corriendo'
    Write-Host '  mahzz --cambios     revisar los cambios del repositorio'
}

function global:prompt {
    $exito = $global:?
    $ultimoCodigo = $global:LASTEXITCODE
    $codigo = if ($exito) { 0 } elseif ($ultimoCodigo) { $ultimoCodigo } else { 1 }

    # Lo tecleado mientras corría un programa no debe mezclarse con el próximo comando.
    try { $Host.UI.RawUI.FlushInputBuffer() } catch { }

    $esc = $global:__mahzzEsc
    $bel = $global:__mahzzBel
    $marcas = "$esc]133;D;$codigo$bel$esc[2J$esc[3J$esc[H"

    # El editor usa estos datos para avisar si un comando no existe.
    $alias = Get-ChildItem Alias:
    $funciones = Get-ChildItem Function:
    $firma = "$($alias.Count)|$($funciones.Count)|$env:PATH"
    if ($firma -ne $global:__mahzzFirma) {
        $global:__mahzzFirma = $firma
        $nombres = (@($alias.Name) + @($funciones.Name)) -join "`n"
        $marcas += "$esc]133;L;$(__mahzzBase64 $nombres)$bel$esc]133;P;$(__mahzzBase64 $env:PATH)$bel"
    }

    $ubicacion = Get-Location
    if ($ubicacion.Provider.Name -eq 'FileSystem') {
        $uri = ([System.Uri]$ubicacion.ProviderPath).AbsoluteUri
        $marcas += "$esc]7;$uri$bel"
        $marcas += "$esc]133;A;$(__mahzzBase64 (__mahzzRama))$bel"
    } else {
        $marcas += "$esc]133;A;$bel"
    }
    [Console]::Write($marcas)

    $salida = & $global:__mahzzPromptOriginal
    $global:LASTEXITCODE = $ultimoCodigo
    $salida
}
