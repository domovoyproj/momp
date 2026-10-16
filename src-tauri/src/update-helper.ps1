$ErrorActionPreference = 'Stop'
$target = [IO.Path]::GetFullPath($env:MOMP_UPDATE_TARGET)
$source = [IO.Path]::GetFullPath($env:MOMP_UPDATE_SOURCE)
$staging = Split-Path -Parent $source
$backup = Join-Path $staging 'previous.exe'
$log = Join-Path $staging 'update.log'
try {
    if ((Split-Path -Parent $staging) -ne (Split-Path -Parent $target) -or (Split-Path -Leaf $staging) -notlike '.momp-update-*') { throw 'Unsafe update directory' }
    if ((Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $env:MOMP_UPDATE_SHA256) { throw 'Update checksum mismatch' }
    'ready' | Set-Content -LiteralPath (Join-Path $staging 'ready')
    $parentId = [int]$env:MOMP_UPDATE_PARENT
    Wait-Process -Id $parentId -Timeout 120 -ErrorAction SilentlyContinue
    if (Get-Process -Id $parentId -ErrorAction SilentlyContinue) { throw 'Application did not exit; update cancelled' }
    Move-Item -LiteralPath $target -Destination $backup
    try {
        Move-Item -LiteralPath $source -Destination $target
        Start-Process -FilePath $target -WorkingDirectory (Split-Path -Parent $target) -WindowStyle Hidden
    } catch {
        if (Test-Path -LiteralPath $target) { Remove-Item -LiteralPath $target }
        Move-Item -LiteralPath $backup -Destination $target
        Start-Process -FilePath $target -WindowStyle Hidden
        throw
    }
    'Update installed. previous.exe is retained for manual rollback.' | Set-Content -LiteralPath $log
} catch {
    $_ | Out-String | Set-Content -LiteralPath $log
    exit 1
}
