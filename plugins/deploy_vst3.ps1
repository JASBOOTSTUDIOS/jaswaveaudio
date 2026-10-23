# Copia (solo desarrollo) los bundles compilados a una carpeta VST3 de USUARIO para probarlos en un DAW.
#   powershell -File plugins/deploy_vst3.ps1 [-Build plugins/build] [-Config Release] [-Dest <carpeta>]
# Por defecto: %LOCALAPPDATA%\Programs\Common\VST3\JasWave (no requiere administrador; Reaper la escanea).
# No toca C:\Program Files\Common Files\VST3.
param(
    [string]$Build = (Join-Path $PSScriptRoot 'build'),
    [string]$Config = 'Release',
    [string]$Dest = (Join-Path $env:LOCALAPPDATA 'Programs\Common\VST3\JasWave')
)
$ErrorActionPreference = 'Stop'
$src = Join-Path $Build "VST3\$Config"
if (!(Test-Path $src)) { throw "No existe $src: compila primero (cmake --build plugins/build --config $Config)" }
New-Item -ItemType Directory -Force -Path $Dest | Out-Null
Get-ChildItem $src -Directory -Filter '*.vst3' | ForEach-Object {
    $target = Join-Path $Dest $_.Name
    if (Test-Path $target) { Remove-Item $target -Recurse -Force }
    Copy-Item $_.FullName -Destination $target -Recurse -Force
    Write-Host "[DEPLOYED] $($_.Name) -> $target"
}
