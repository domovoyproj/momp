$ErrorActionPreference = 'Stop'

function Invoke-MompNative {
    param([string]$Executable, [string[]]$Arguments)
    & $Executable @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$Executable завершился с кодом $LASTEXITCODE" }
}

function Get-MompReleaseAsset {
    param($Release)
    if ($Release.draft -ne $false -or $Release.prerelease -ne $false -or $Release.tag_name -notmatch '^v\d+\.\d+\.\d+$') {
        throw 'Ожидался опубликованный стабильный релиз momp'
    }
    $assets = @($Release.assets | Where-Object { $_.name -ceq 'momp-web-dist.tar.gz' })
    if ($assets.Count -ne 1) { throw 'В релизе нет единственного проверяемого web-пакета' }
    $asset = $assets[0]
    $expected = "https://github.com/domovoyproj/momp/releases/download/$($Release.tag_name)/momp-web-dist.tar.gz"
    if ($asset.browser_download_url -cne $expected -or $asset.digest -notmatch '^sha256:[a-fA-F0-9]{64}$' -or $asset.size -le 0 -or $asset.size -gt 1GB) {
        throw 'Недопустимые метаданные пакета: адрес, размер или SHA-256'
    }
    return $asset
}

function Assert-MompDownloadedAsset {
    param([string]$Path, $Asset)
    if ((Get-Item -LiteralPath $Path).Length -ne $Asset.size -or (Get-FileHash -LiteralPath $Path -Algorithm SHA256).Hash -ne $Asset.digest.Substring(7)) {
        throw 'Проверка размера или SHA-256 пакета не пройдена'
    }
}

function Assert-MompInstallPayload {
    param([string]$Directory, [switch]$Dependencies)
    $required = @('.next/BUILD_ID', 'package.json', 'bun.lock', 'next.config.js', 'bin/omp-web.js')
    if ($Dependencies) { $required += @('node_modules/next/dist/bin/next', 'node_modules/@oh-my-pi/pi-coding-agent/package.json') }
    foreach ($relative in $required) {
        if (-not (Test-Path -LiteralPath (Join-Path $Directory $relative) -PathType Leaf)) { throw "Неполный пакет: $relative" }
    }
}

function Move-MompStagedInstall {
    param([string]$Source, [string]$Destination)
    $sourcePath = [IO.Path]::GetFullPath($Source)
    $destinationPath = [IO.Path]::GetFullPath($Destination)
    if ((Split-Path -Parent $sourcePath) -ne (Split-Path -Parent $destinationPath) -or -not (Split-Path -Leaf $sourcePath).StartsWith((Split-Path -Leaf $destinationPath) + '.stage-')) {
        throw 'Небезопасный каталог установки'
    }
    foreach ($path in @($sourcePath, $destinationPath)) {
        if ((Test-Path -LiteralPath $path) -and ((Get-Item -LiteralPath $path -Force).Attributes -band [IO.FileAttributes]::ReparsePoint)) { throw 'Каталог установки не должен быть ссылкой' }
    }
    Assert-MompInstallPayload -Directory $sourcePath -Dependencies
    $backup = $null
    if (Test-Path -LiteralPath $destinationPath) {
        $backup = $destinationPath + '.backup-' + [guid]::NewGuid().ToString('N')
        Move-Item -LiteralPath $destinationPath -Destination $backup
    }
    try {
        Move-Item -LiteralPath $sourcePath -Destination $destinationPath
    } catch {
        if ($backup -and -not (Test-Path -LiteralPath $destinationPath)) { Move-Item -LiteralPath $backup -Destination $destinationPath }
        throw
    }
    return $backup
}

function Write-MompLaunchers {
    param([string]$Directory, [string]$BunExecutable)
    if (-not [IO.Path]::IsPathRooted($BunExecutable) -or -not (Test-Path -LiteralPath $BunExecutable -PathType Leaf)) { throw 'Bun executable must be an existing absolute path' }
    $bunPath = [IO.Path]::GetFullPath($BunExecutable)
    [IO.Directory]::CreateDirectory($Directory) | Out-Null
    $cmd = @'
@echo off
setlocal DisableDelayedExpansion
chcp 65001 >nul
set "BUN_BIN=__MOMP_BUN_PATH__"
"%BUN_BIN%" --bun "%~dp0..\bin\omp-web.js" %*
'@
    $launcher = @'
$bunBin = '__MOMP_BUN_PATH__'
& $bunBin --bun "$PSScriptRoot\..\bin\omp-web.js" @args
exit $LASTEXITCODE
'@
    [IO.File]::WriteAllText((Join-Path $Directory 'momp.cmd'), $cmd.Replace('__MOMP_BUN_PATH__', $bunPath.Replace('%', '%%')), (New-Object Text.UTF8Encoding($false)))
    [IO.File]::WriteAllText((Join-Path $Directory 'momp.ps1'), $launcher.Replace('__MOMP_BUN_PATH__', $bunPath.Replace("'", "''")), (New-Object Text.UTF8Encoding($true)))
}

function Install-MompPayload {
    $installDir = [IO.Path]::GetFullPath((Join-Path $HOME '.momp-app'))
    $staging = $installDir + '.stage-' + [guid]::NewGuid().ToString('N')
    $archive = Join-Path $staging 'momp-web-dist.tar.gz'
    Write-Host 'Установка momp из проверенного GitHub Release' -ForegroundColor Cyan

    if (-not (Get-Command bun -ErrorAction SilentlyContinue)) {
        if (Test-Path -LiteralPath (Join-Path $HOME '.bun/bin/bun.exe')) {
            $env:PATH = (Join-Path $HOME '.bun/bin') + ';' + $env:PATH
        } else {
            Invoke-RestMethod -Uri 'https://bun.sh/install.ps1' | Invoke-Expression
            $env:PATH = (Join-Path $HOME '.bun/bin') + ';' + $env:PATH
        }
    }
    $bun = (Get-Command bun -CommandType Application -ErrorAction Stop).Source
    $tar = (Get-Command tar -ErrorAction Stop).Source
    $release = Invoke-RestMethod -Uri 'https://api.github.com/repos/domovoyproj/momp/releases/latest' -Headers @{ 'User-Agent' = 'momp-installer' } -TimeoutSec 60
    $asset = Get-MompReleaseAsset $release
    New-Item -ItemType Directory -Path $staging | Out-Null
    try {
        Invoke-WebRequest -Uri $asset.browser_download_url -OutFile $archive -UseBasicParsing -TimeoutSec 300
        Assert-MompDownloadedAsset -Path $archive -Asset $asset
        $entries = & $tar -tzf $archive
        if ($LASTEXITCODE -ne 0) { throw 'Архив не читается' }
        foreach ($entry in $entries) {
            $normalized = $entry.Replace('\', '/')
            if ($normalized.StartsWith('/') -or $normalized.Contains(':') -or $normalized.Split('/') -contains '..') { throw 'Небезопасный путь в архиве' }
        }
        Invoke-MompNative $tar @('-xzf', $archive, '-C', $staging)
        Remove-Item -LiteralPath $archive
        Assert-MompInstallPayload -Directory $staging
        Push-Location $staging
        try { Invoke-MompNative $bun @('install', '--production', '--frozen-lockfile') } finally { Pop-Location }
        Assert-MompInstallPayload -Directory $staging -Dependencies
        Write-MompLaunchers -Directory (Join-Path $staging 'cmd') -BunExecutable $bun
        $backup = Move-MompStagedInstall -Source $staging -Destination $installDir
        $commandPath = Join-Path $installDir 'cmd'
        $userPath = [Environment]::GetEnvironmentVariable('Path', 'User')
        if (@($userPath -split ';') -notcontains $commandPath) {
            [Environment]::SetEnvironmentVariable('Path', (@($userPath, $commandPath) | Where-Object { $_ }) -join ';', 'User')
        }
        if (@($env:PATH -split ';') -notcontains $commandPath) { $env:PATH = $commandPath + ';' + $env:PATH }
        Write-Host "momp $($release.tag_name) установлен. Команда запуска: momp" -ForegroundColor Green
        if ($backup) { Write-Host "Предыдущая установка сохранена: $backup" }
    } finally {
        $resolved = [IO.Path]::GetFullPath($staging)
        if ($resolved -eq $staging -and (Split-Path -Parent $resolved) -eq (Split-Path -Parent $installDir) -and (Split-Path -Leaf $resolved) -match '^\.momp-app\.stage-[a-f0-9]{32}$' -and (Test-Path -LiteralPath $resolved)) {
            Remove-Item -LiteralPath $resolved -Recurse -Force
        }
    }
}

function Install-Momp {
    $lockPath = Join-Path $HOME '.momp-install.lock'
    $lock = [IO.File]::Open($lockPath, [IO.FileMode]::OpenOrCreate, [IO.FileAccess]::ReadWrite, [IO.FileShare]::None)
    try { Install-MompPayload } finally { $lock.Dispose() }
}

if ($MyInvocation.InvocationName -ne '.') { Install-Momp }
