$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '../install.ps1')

function Assert-Rejected {
    param([scriptblock]$Action)
    $rejected = $false
    try { & $Action | Out-Null } catch { $rejected = $true }
    if (-not $rejected) { throw 'Expected operation to be rejected' }
}

function New-TestPayload {
    param([string]$Directory)
    foreach ($relative in @('.next/BUILD_ID', 'package.json', 'bun.lock', 'next.config.js', 'bin/omp-web.js', 'node_modules/next/dist/bin/next', 'node_modules/@oh-my-pi/pi-coding-agent/package.json')) {
        $file = Join-Path $Directory $relative
        New-Item -ItemType Directory -Force -Path (Split-Path -Parent $file) | Out-Null
        Set-Content -LiteralPath $file -Value 'synthetic payload'
    }
}

$root = Join-Path ([IO.Path]::GetTempPath()) ('momp installer test ' + [guid]::NewGuid())
New-Item -ItemType Directory -Path $root | Out-Null
try {
    $archive = Join-Path $root 'download.tar.gz'
    Set-Content -LiteralPath $archive -Value 'synthetic download'
    $asset = [pscustomobject]@{
        name = 'momp-web-dist.tar.gz'
        browser_download_url = 'https://github.com/domovoyproj/momp/releases/download/v1.5.0/momp-web-dist.tar.gz'
        digest = 'sha256:' + (Get-FileHash -LiteralPath $archive).Hash.ToLowerInvariant()
        size = (Get-Item -LiteralPath $archive).Length
    }
    $release = [pscustomobject]@{ draft = $false; prerelease = $false; tag_name = 'v1.5.0'; assets = @($asset) }
    $null = Get-MompReleaseAsset $release
    Assert-MompDownloadedAsset -Path $archive -Asset $asset
    $release.draft = $true
    Assert-Rejected { Get-MompReleaseAsset $release }
    $release.draft = $false
    $asset.browser_download_url = 'https://example.com/untrusted.tar.gz'
    Assert-Rejected { Get-MompReleaseAsset $release }
    $asset.browser_download_url = 'https://github.com/domovoyproj/momp/releases/download/v1.5.0/momp-web-dist.tar.gz'
    Set-Content -LiteralPath $archive -Value 'corrupted download'
    Assert-Rejected { Assert-MompDownloadedAsset -Path $archive -Asset $asset }
    Assert-Rejected { Invoke-MompNative 'powershell.exe' @('-NoProfile', '-NonInteractive', '-Command', 'exit 7') }

    $destination = Join-Path $root ".momp's app"
    New-Item -ItemType Directory -Path $destination | Out-Null
    Set-Content -LiteralPath (Join-Path $destination 'previous.txt') -Value 'keep existing install'
    $staging = $destination + '.stage-' + [guid]::NewGuid().ToString('N')
    New-Item -ItemType Directory -Path $staging | Out-Null
    Assert-Rejected { Move-MompStagedInstall -Source $staging -Destination $destination }
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'previous.txt'))) { throw 'Incomplete payload removed the old install' }
    New-TestPayload $staging
    $script:failPromotion = $staging
    function Move-Item {
        param([string]$LiteralPath, [string]$Destination)
        if ($LiteralPath -eq $script:failPromotion) { throw 'Synthetic promotion failure' }
        Microsoft.PowerShell.Management\Move-Item -LiteralPath $LiteralPath -Destination $Destination
    }
    Assert-Rejected { Move-MompStagedInstall -Source $staging -Destination $destination }
    Remove-Item Function:\Move-Item
    if (-not (Test-Path -LiteralPath (Join-Path $destination 'previous.txt'))) { throw 'Failed promotion did not restore the old install' }
    $backup = Move-MompStagedInstall -Source $staging -Destination $destination
    Assert-MompInstallPayload -Directory $destination -Dependencies
    if (-not (Test-Path -LiteralPath (Join-Path $backup 'previous.txt'))) { throw 'Previous installation backup was lost' }
    $runtimeDirectory = Join-Path $root ("pinned bun's runtime " + [char]0x03A9)
    New-Item -ItemType Directory -Path $runtimeDirectory | Out-Null
    $runtime = Join-Path $runtimeDirectory 'bun.cmd'
    Set-Content -LiteralPath $runtime -Value "@echo off`r`necho PINNED_BUN`r`nexit /b 7" -Encoding ASCII
    $launcherDirectory = Join-Path $root 'launchers'
    Assert-Rejected { Write-MompLaunchers -Directory $launcherDirectory -BunExecutable 'bun.exe' }
    Write-MompLaunchers -Directory $launcherDirectory -BunExecutable $runtime
    $output = & (Join-Path $launcherDirectory 'momp.cmd') 'argument with spaces'
    if ($LASTEXITCODE -ne 7 -or ($output -join '') -ne 'PINNED_BUN') { throw 'CMD launcher did not use the pinned runtime' }
    $output = & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $launcherDirectory 'momp.ps1') 'argument with spaces'
    if ($LASTEXITCODE -ne 7 -or ($output -join '') -ne 'PINNED_BUN') { throw 'PowerShell launcher did not use the pinned runtime' }
    $escapedRuntime = Join-Path $runtimeDirectory 'bun%fixture%.exe'
    Set-Content -LiteralPath $escapedRuntime -Value 'fixture only'
    Write-MompLaunchers -Directory $launcherDirectory -BunExecutable $escapedRuntime
    $launcherSource = Get-Content -LiteralPath (Join-Path $launcherDirectory 'momp.cmd') -Raw
    if (-not $launcherSource.Contains('bun%%fixture%%.exe')) { throw 'CMD runtime percent characters are not escaped' }
    $source = Get-Content -LiteralPath (Join-Path $PSScriptRoot '../install.ps1') -Raw
    if ($source -match 'Add-MpPreference|ExclusionPath|Verb\s+RunAs') { throw 'Installer must not weaken antivirus protection or request elevation' }
    Write-Host 'PASS: release URL and SHA-256, corrupt payload, native failure, incomplete install, rollback, backup and pinned launchers with quoted paths'
} finally {
    $resolved = [IO.Path]::GetFullPath($root)
    if ((Split-Path -Parent $resolved) -eq [IO.Path]::GetTempPath().TrimEnd('\') -and (Split-Path -Leaf $resolved) -like 'momp installer test *') {
        Remove-Item -LiteralPath $resolved -Recurse -Force
    }
}
$global:LASTEXITCODE = 0
