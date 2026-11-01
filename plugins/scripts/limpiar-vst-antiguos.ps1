# Aparta las copias ANTIGUAS de los VST de JasWave que tapan a las nuevas en Reaper (y otros DAW):
# Reaper registra los VST por nombre de archivo e identificador, así que si encuentra una copia vieja con el
# mismo nombre (bin/, v1.0.0/, otra carpeta VST) puede cargar esa en vez de la recién desplegada.
#
#   powershell -File plugins/scripts/limpiar-vst-antiguos.ps1 [-Carpetas <rutas extra>]
#
# No borra nada: mueve cada copia antigua a %LOCALAPPDATA%\JasWave\vst3-antiguos\<fecha>\ y quita las entradas
# JasWave de la caché de Reaper (con copia de seguridad) para que las vuelva a escanear. Cierra Reaper antes.
param(
    [string[]]$Carpetas = @('C:\Studio_Musical\Reaper_VST')
)
$ErrorActionPreference = 'Stop'
if (Get-Process -Name reaper -ErrorAction SilentlyContinue) { throw 'Cierra Reaper antes de limpiar (tiene los VST cargados y reescribe su caché al salir).' }

$repo = Split-Path (Split-Path $PSScriptRoot -Parent) -Parent
$bueno = Join-Path $env:LOCALAPPDATA 'Programs\Common\VST3\JasWave'
$respaldo = Join-Path $env:LOCALAPPDATA ("JasWave\vst3-antiguos\" + (Get-Date -Format 'yyyyMMdd-HHmmss'))

# Copias antiguas: salidas de compilación previas dentro de cada paquete y carpetas VST indicadas
$antiguas = @()
$antiguas += Get-ChildItem (Join-Path $repo 'plugins') -Directory -Filter 'com.jaswave.plugin.*' | ForEach-Object {
    Get-ChildItem $_.FullName -Directory | Where-Object { $_.Name -eq 'bin' -or $_.Name -match '^v\d' } |
        ForEach-Object { Get-ChildItem $_.FullName -Directory -Filter 'JasWave*.vst3' }
}
# En otras carpetas VST: bundles, restos *.vst3.old_* y DLL .vst3 sueltas (formato antiguo, sin carpeta)
foreach ($c in $Carpetas) { if (Test-Path $c) { $antiguas += Get-ChildItem $c -Filter 'JasWave*.vst3*' } }
# Restos de despliegues anteriores junto a los buenos
$antiguas += Get-ChildItem $bueno -Directory -ErrorAction SilentlyContinue | Where-Object { $_.Name -match '\.vst3\.(old|viejo|nuevo)' }

foreach ($a in $antiguas) {
    $rel = $a.FullName.Replace(':', '').TrimStart('\')
    $destino = Join-Path $respaldo $rel
    New-Item -ItemType Directory -Force -Path (Split-Path $destino -Parent) | Out-Null
    Move-Item -LiteralPath $a.FullName -Destination $destino
    Write-Host "[APARTADO] $($a.FullName)"
}

# Caché de Reaper: fuera las entradas JasWave (las vuelve a escanear al abrir)
foreach ($ini in @("$env:APPDATA\REAPER\reaper-vstplugins64.ini", "$env:APPDATA\REAPER\reaper-vstplugins.ini")) {
    if (!(Test-Path $ini)) { continue }
    Copy-Item $ini "$ini.antes-limpieza-jaswave" -Force
    $lineas = Get-Content $ini | Where-Object { $_ -notmatch '^JasWave' }
    Set-Content -Path $ini -Value $lineas -Encoding Default
    Write-Host "[CACHÉ] entradas JasWave quitadas de $ini (copia en $ini.antes-limpieza-jaswave)"
}
Write-Host ''
Write-Host "Listo. Los VST buenos están en $bueno; las copias antiguas, en $respaldo."
Write-Host 'Abre Reaper: re-escaneará los JasWave. Si no, Opciones > Preferencias > Plug-ins > VST > "Re-scan".'
