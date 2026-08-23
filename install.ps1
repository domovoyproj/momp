# === momp max Installer for Windows PowerShell ===
$ErrorActionPreference = "Stop"

# Переходим в домашнюю папку, чтобы не блокировать .momp-app текущим процессом терминала
Set-Location $HOME

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "       Установка momp max                 " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

$repo = "domovoyproj/momp"
$installDir = "$HOME\.momp-app"
$distUrl = "https://github.com/$repo/releases/latest/download/momp-web-dist.tar.gz"
# 1. Проверка наличия Bun
$bunInstalled = (Get-Command bun -ErrorAction SilentlyContinue)
if (-not $bunInstalled) {
    if (Test-Path "$HOME\.bun\bin\bun.exe") {
        $env:PATH = "$HOME\.bun\bin;$env:PATH"
    } else {
        Write-Host "[1/3] Bun не найден. Установка Bun..." -ForegroundColor Yellow
        try {
            Invoke-RestMethod -Uri "https://bun.sh/install.ps1" | Invoke-Expression
            $env:PATH = "$HOME\.bun\bin;$env:PATH"
        } catch {
            Write-Host "Ошибка при установке Bun. Попробуйте установить вручную: https://bun.sh" -ForegroundColor Red
            Exit 1
        }
    }
}

# Ускорение: исключаем папки из проверки Защитника Windows.
# Иначе антивирус синхронно сканирует каждый распаковываемый файл, замедляя установку.
function Test-Admin {
    $id = [Security.Principal.WindowsIdentity]::GetCurrent()
    (New-Object Security.Principal.WindowsPrincipal($id)).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
}
$defenderPaths = @($installDir, "$HOME\.bun")
try {
    if (Test-Admin) {
        Add-MpPreference -ExclusionPath $defenderPaths -ErrorAction SilentlyContinue
    } else {
        Write-Host "Запрашиваю права администратора, чтобы отключить сканирование антивирусом (ускоряет установку)..." -ForegroundColor DarkGray
        $excl = ($defenderPaths | ForEach-Object { "'$_'" }) -join ","
        $cmd = "Add-MpPreference -ExclusionPath $excl -ErrorAction SilentlyContinue"
        Start-Process powershell -Verb RunAs -WindowStyle Hidden -Wait -ArgumentList "-NoProfile","-Command",$cmd -ErrorAction Stop
    }
} catch {
    Write-Host "Ускорение через антивирус пропущено (нет прав администратора)." -ForegroundColor DarkGray
}

# 2. Получение приложения: сперва пробуем готовую сборку из GitHub Release
# (только ~275 production-пакетов, без сборки webpack на машине пользователя),
# при неудаче — откат на сборку из исходников.
$prebuilt = $false
Write-Host "[2/3] Загрузка готовой сборки momp max..." -ForegroundColor Yellow
$tarPath = "$env:TEMP\momp-web-dist.tar.gz"
try {
    $tarExe = (Get-Command tar -ErrorAction SilentlyContinue)
    if (-not $tarExe) { throw "tar недоступен" }
    Write-Host "      → Скачивание готового пакета..." -ForegroundColor Cyan
    if (-not (Test-Path $installDir)) {
        New-Item -ItemType Directory -Path $installDir -Force | Out-Null
    } else {
        Get-ChildItem -Path $installDir -Force -ErrorAction SilentlyContinue | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue
    }
    Write-Host "      → Распаковка..." -ForegroundColor Cyan
    tar -xzf $tarPath -C $installDir
    Remove-Item -Force $tarPath -ErrorAction SilentlyContinue
    if (-not (Test-Path "$installDir\.next")) { throw "в архиве нет .next" }
    $prebuilt = $true
} catch {
    Write-Host "      Готовая сборка недоступна ($($_.Exception.Message)), собираю из исходников..." -ForegroundColor DarkGray
    Remove-Item -Force $tarPath -ErrorAction SilentlyContinue
}

if ($prebuilt) {
    # 3a. Быстрый путь: только production-зависимости, без сборки
    Push-Location $installDir
    Write-Host "[3/3] Установка зависимостей (production)..." -ForegroundColor Yellow
    try {
        & bun install --production --frozen-lockfile
    } catch {
        & bun install --production
    }
    Pop-Location
} else {
    # 3b. Откат: загрузка исходного кода и полная сборка
    Write-Host "      Загрузка исходного кода в $installDir..." -ForegroundColor Yellow
    $gitInstalled = (Get-Command git -ErrorAction SilentlyContinue)
    if ($gitInstalled) {
        if (Test-Path "$installDir\.git") {
            Push-Location $installDir
            try { git pull --ff-only } catch { Write-Host "      Не удалось обновить git, продолжаем..." -ForegroundColor DarkGray }
            Pop-Location
        } else {
            if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
            git clone --depth 1 "https://github.com/$repo.git" $installDir
        }
    } else {
        $zipUrl = "https://github.com/$repo/archive/refs/heads/main.zip"
        $zipPath = "$env:TEMP\momp-main.zip"
        $extractPath = "$env:TEMP\momp-extract"
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipPath
        if (Test-Path $extractPath) { Remove-Item -Recurse -Force $extractPath }
        Expand-Archive -Path $zipPath -DestinationPath $extractPath -Force
        if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
        Move-Item -Path "$extractPath\momp-main" -Destination $installDir -Force
        Remove-Item -Recurse -Force $extractPath -ErrorAction SilentlyContinue
        Remove-Item -Force $zipPath -ErrorAction SilentlyContinue
    }

    Push-Location $installDir
    Write-Host "[3/3] Установка зависимостей и сборка проекта..." -ForegroundColor Yellow
    Write-Host "      → Установка пакетов (Bun)..." -ForegroundColor Cyan
    try { & bun install --frozen-lockfile } catch { & bun install }
    $env:OMP_WEB_FAST_BUILD = "1"
    & bun run build
    if ($LASTEXITCODE -ne 0) {
        Write-Host "Ошибка при сборке проекта." -ForegroundColor Red
        Pop-Location
        Exit 1
    }
    Pop-Location
}

# 4. Регистрация глобальной команды `momp`
Write-Host "Настройка команды 'momp' в системе..." -ForegroundColor Yellow

$cmdDir = "$installDir\cmd"
if (-not (Test-Path $cmdDir)) {
    New-Item -ItemType Directory -Path $cmdDir -Force | Out-Null
}

$mompCmdContent = @"
@echo off
setlocal
set "BUN_BIN=%USERPROFILE%\.bun\bin\bun.exe"
if exist "%BUN_BIN%" (
    "%BUN_BIN%" --bun "%~dp0..\bin\omp-web.js" %*
) else (
    bun --bun "%~dp0..\bin\omp-web.js" %*
)
"@

$mompPs1Content = @"
`$bunBin = if (Test-Path "`$HOME\.bun\bin\bun.exe") { "`$HOME\.bun\bin\bun.exe" } else { "bun" }
& `$bunBin --bun "`$PSScriptRoot\..\bin\omp-web.js" @args
"@

Set-Content -Path "$cmdDir\momp.cmd" -Value $mompCmdContent -Encoding ASCII
Set-Content -Path "$cmdDir\momp.ps1" -Value $mompPs1Content -Encoding UTF8

# Добавление в системный PATH пользователя
$userPath = [Environment]::GetEnvironmentVariable("Path", "User")
if ($userPath -notlike "*$cmdDir*") {
    $newPath = if ($userPath) { "$userPath;$cmdDir" } else { $cmdDir }
    [Environment]::SetEnvironmentVariable("Path", $newPath, "User")
}
if ($env:PATH -notlike "*$cmdDir*") {
    $env:PATH = "$cmdDir;$env:PATH"
}

Write-Host ""
Write-Host "==========================================" -ForegroundColor Green
Write-Host "       momp max успешно установлен!       " -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Green
Write-Host ""
Write-Host "Теперь вы можете запускать его из любого терминала командой:" -ForegroundColor Cyan
Write-Host "   momp" -ForegroundColor Yellow
Write-Host ""
