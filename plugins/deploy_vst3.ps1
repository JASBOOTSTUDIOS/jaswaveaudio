$ErrorActionPreference = "Stop"

$plugins = @(
    @{ Name = 'JasWaveParamEq'; Dir = 'com.jaswave.plugin.param-eq' },
    @{ Name = 'JasWaveBusCompressor'; Dir = 'com.jaswave.plugin.bus-compressor' },
    @{ Name = 'JasWaveTruePeakLimiter'; Dir = 'com.jaswave.plugin.truepeak-limiter' }
)

$destReaper = 'C:\Studio_Musical\Reaper_VST'
if (!(Test-Path $destReaper)) { New-Item -ItemType Directory -Path $destReaper -Force | Out-Null }

$destCommon = Join-Path $env:LOCALAPPDATA 'Programs\Common\VST3\JasWave'
if (!(Test-Path $destCommon)) { New-Item -ItemType Directory -Path $destCommon -Force | Out-Null }

foreach ($p in $plugins) {
    $srcVst = "C:\src\jaswave-ia\plugins\$($p.Dir)\build\Release\$($p.Name).vst3"
    if (!(Test-Path $srcVst)) {
        Write-Host "[ERROR] No existe $srcVst"
        continue
    }

    $dirBin = "C:\src\jaswave-ia\plugins\$($p.Dir)\bin"
    $dirVer = "C:\src\jaswave-ia\plugins\$($p.Dir)\v1.0.0"
    $dirRoot = "C:\src\jaswave-ia\plugins\$($p.Dir)\$($p.Name).vst3"

    if (!(Test-Path $dirBin)) { New-Item -ItemType Directory -Path $dirBin -Force | Out-Null }
    if (!(Test-Path $dirVer)) { New-Item -ItemType Directory -Path $dirVer -Force | Out-Null }

    Copy-Item $srcVst -Destination "$dirBin\$($p.Name).vst3" -Force
    Copy-Item $srcVst -Destination "$dirVer\$($p.Name).vst3" -Force
    Copy-Item $srcVst -Destination $dirRoot -Force

    $reaperTarget = "$destReaper\$($p.Name).vst3"
    if (Test-Path $reaperTarget) {
        $oldTarget = "$reaperTarget.old_" + (Get-Date -Format 'yyyyMMdd_HHmmss')
        try { Move-Item -Path $reaperTarget -Destination $oldTarget -Force } catch {
            Write-Host "[WARN] No se pudo mover $reaperTarget, intentando sobreescribir..."
        }
    }
    Copy-Item $srcVst -Destination $reaperTarget -Force

    $commonTarget = "$destCommon\$($p.Name).vst3"
    if (Test-Path $commonTarget) {
        $oldTarget = "$commonTarget.old_" + (Get-Date -Format 'yyyyMMdd_HHmmss')
        try { Move-Item -Path $commonTarget -Destination $oldTarget -Force } catch {}
    }
    Copy-Item $srcVst -Destination $commonTarget -Force

    Write-Host "[DEPLOYED] $($p.Name).vst3 distribuido a bin, v1.0.0, raíz, Reaper y Common VST3"
}
