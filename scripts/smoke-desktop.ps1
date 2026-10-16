param([string]$Executable = (Join-Path $PSScriptRoot '../src-tauri/target/release/momp.exe'))
$ErrorActionPreference = 'Stop'
$executablePath = (Resolve-Path -LiteralPath $Executable).Path
$root = Join-Path ([IO.Path]::GetTempPath()) ('momp-smoke-' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
$log = Join-Path $root 'desktop.log'
$saved = @{}
foreach ($key in @('HOME', 'USERPROFILE', 'LOCALAPPDATA', 'APPDATA', 'PI_CODING_AGENT_DIR', 'MOMP_DESKTOP_LOG')) { $saved[$key] = [Environment]::GetEnvironmentVariable($key) }
$app = $null
try {
    $env:HOME = $root
    $env:USERPROFILE = $root
    $env:LOCALAPPDATA = $root
    $env:APPDATA = $root
    $env:PI_CODING_AGENT_DIR = Join-Path $root 'agent'
    $env:MOMP_DESKTOP_LOG = $log
    $app = Start-Process -FilePath $executablePath -WorkingDirectory $root -WindowStyle Hidden -PassThru
    $deadline = (Get-Date).AddMinutes(8)
    $origin = $null
    while ((Get-Date) -lt $deadline) {
        if ($app.HasExited) { throw "Desktop exited with code $($app.ExitCode)" }
        if (Test-Path -LiteralPath $log) {
            $content = Get-Content -LiteralPath $log -Raw
            if ($content -match 'server ready on (http://127\.0\.0\.1:\d+)/') { $origin = $Matches[1]; break }
        }
        Start-Sleep -Seconds 2
    }
    if (!$origin) { throw 'Packaged server failed to start within eight minutes' }
    $page = Invoke-WebRequest -Uri "$origin/" -UseBasicParsing -TimeoutSec 60
    if ($page.StatusCode -ne 200 -or $page.Content -notmatch 'momp') { throw 'Application page failed' }
    foreach ($endpoint in @('/api/display-settings', '/api/auth/providers', '/api/auth/all-providers', '/api/settings', '/api/models')) {
        $response = Invoke-WebRequest -Uri "$origin$endpoint" -UseBasicParsing -TimeoutSec 90
        if ($response.StatusCode -ne 200) { throw "Failed: $endpoint" }
        $null = $response.Content | ConvertFrom-Json
        Write-Host "PASS $endpoint"
    }
    Write-Host "PASS packaged EXE startup, SFX extraction, bundled Bun, UI and SDK-backed APIs: $executablePath"
} catch {
    if (Test-Path -LiteralPath $log) { Get-Content -LiteralPath $log -Tail 60 | Write-Host }
    throw
} finally {
    if ($app -and !$app.HasExited) { & taskkill.exe /PID $app.Id /T /F | Out-Null }
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
    Write-Host "Smoke logs retained at $root"
}
