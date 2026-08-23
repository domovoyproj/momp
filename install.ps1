# === momp max Installer for Windows PowerShell ===
$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "       Установка momp max                 " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# 1. Проверка наличия Bun
$bunInstalled = (Get-Command bun -ErrorAction SilentlyContinue)
if (-not $bunInstalled) {
    if (Test-Path "$HOME\.bun\bin\bun.exe") {
        $env:PATH = "$HOME\.bun\bin;$env:PATH"
    } else {
        Write-Host "[1/4] Bun не найден. Установка Bun..." -ForegroundColor Yellow
        try {
            Invoke-RestMethod -Uri "https://bun.sh/install.ps1" | Invoke-Expression
            $env:PATH = "$HOME\.bun\bin;$env:PATH"
        } catch {
            Write-Host "Ошибка при установке Bun. Попробуйте установить вручную: https://bun.sh" -ForegroundColor Red
            Exit 1
        }
    }
}

# 2. Определение директории установки
$installDir = "$HOME\.momp-app"
Write-Host "[2/4] Загрузка исходного кода в $installDir..." -ForegroundColor Yellow

$gitInstalled = (Get-Command git -ErrorAction SilentlyContinue)
if ($gitInstalled) {
    if (Test-Path "$installDir\.git") {
        Push-Location $installDir
        try {
            git pull
        } catch {
            Write-Host "Не удалось обновить git, продолжаем..." -ForegroundColor DarkGray
        }
        Pop-Location
    } else {
        if (Test-Path $installDir) { Remove-Item -Recurse -Force $installDir }
        git clone https://github.com/domovoyproj/momp.git $installDir
    }
} else {
    $zipUrl = "https://github.com/domovoyproj/momp/archive/refs/heads/main.zip"
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

# 3. Установка зависимостей и сборка
Push-Location $installDir
Write-Host "[3/4] Установка зависимостей и сборка проекта..." -ForegroundColor Yellow

try {
    bun pm cache rm | Out-Null
    bun install --backend=copyfile
} catch {
    Write-Host "Bun install не удался, пробуем через npm..." -ForegroundColor DarkGray
    npm install
}

Write-Host "Сборка Next.js..." -ForegroundColor Yellow
bun run build

Pop-Location

# 4. Регистрация глобальной команды `momp`
Write-Host "[4/4] Настройка команды 'momp' в системе..." -ForegroundColor Yellow

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
