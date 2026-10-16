$ErrorActionPreference = 'Stop'
$root = Join-Path ([IO.Path]::GetTempPath()) ('momp updater test ' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
$helper = Join-Path $PSScriptRoot '../src-tauri/src/update-helper.ps1'
$saved = @{}
foreach ($key in @('MOMP_UPDATE_TARGET', 'MOMP_UPDATE_SOURCE', 'MOMP_UPDATE_PARENT', 'MOMP_UPDATE_SHA256')) { $saved[$key] = [Environment]::GetEnvironmentVariable($key) }
try {
    $target = Join-Path $root "momp's app.exe"
    Copy-Item -LiteralPath "$env:SystemRoot\System32\whoami.exe" -Destination $target
    $original = (Get-FileHash -LiteralPath $target).Hash
    foreach ($valid in @($false, $true)) {
        $staging = Join-Path $root ('.momp-update-' + [guid]::NewGuid())
        New-Item -ItemType Directory -Path $staging | Out-Null
        $source = Join-Path $staging 'momp.exe'
        Copy-Item -LiteralPath "$env:SystemRoot\System32\hostname.exe" -Destination $source
        $parent = Start-Process -FilePath 'powershell.exe' -ArgumentList '-NoProfile', '-NonInteractive', '-Command', 'Start-Sleep -Seconds 2' -WindowStyle Hidden -PassThru
        $env:MOMP_UPDATE_TARGET = $target
        $env:MOMP_UPDATE_SOURCE = $source
        $env:MOMP_UPDATE_PARENT = [string]$parent.Id
        $env:MOMP_UPDATE_SHA256 = if ($valid) { (Get-FileHash -LiteralPath $source).Hash } else { '0' * 64 }
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File $helper
        if ($valid) {
            if ($LASTEXITCODE -ne 0 -or (Get-FileHash -LiteralPath $target).Hash -ne $env:MOMP_UPDATE_SHA256) { throw 'Verified update did not install' }
            if ((Get-FileHash -LiteralPath (Join-Path $staging 'previous.exe')).Hash -ne $original) { throw 'Rollback copy missing' }
        } elseif ($LASTEXITCODE -eq 0 -or (Get-FileHash -LiteralPath $target).Hash -ne $original) { throw 'Corrupt update modified the installed executable' }
    }
    Write-Host 'PASS: checksum rejection, in-place replacement, backup, spaces and apostrophes in paths'
} finally {
    foreach ($key in $saved.Keys) { [Environment]::SetEnvironmentVariable($key, $saved[$key]) }
    $resolved = [IO.Path]::GetFullPath($root)
    if ($resolved.StartsWith([IO.Path]::GetFullPath([IO.Path]::GetTempPath())) -and (Split-Path -Leaf $resolved) -like 'momp updater test *') {
        Start-Sleep -Seconds 2
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
