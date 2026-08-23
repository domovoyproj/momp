#!/usr/bin/env bash
set -e

echo "=== Установка momp max ==="

# 1. Проверка Bun
if ! command -v bun &> /dev/null; then
    if [ -f "$HOME/.bun/bin/bun" ]; then
        export PATH="$HOME/.bun/bin:$PATH"
    else
        echo "[1/4] Установка Bun..."
        curl -fsSL https://bun.sh/install | bash
        export PATH="$HOME/.bun/bin:$PATH"
    fi
fi

# 2. Получение приложения: сперва готовая сборка из GitHub Release
# (только ~275 production-пакетов, без сборки webpack), иначе — сборка из исходников.
REPO="domovoyproj/momp"
INSTALL_DIR="$HOME/.momp-app"
DIST_URL="https://github.com/$REPO/releases/latest/download/momp-web-dist.tar.gz"
PREBUILT=0

echo "[2/3] Загрузка готовой сборки momp max..."
TAR_PATH="$HOME/.momp-web-dist.tar.gz"
rm -f "$TAR_PATH"
if curl -fsSL "$DIST_URL" -o "$TAR_PATH" 2>/dev/null && [ -s "$TAR_PATH" ]; then
    rm -rf "$INSTALL_DIR"
    mkdir -p "$INSTALL_DIR"
    if tar -xzf "$TAR_PATH" -C "$INSTALL_DIR" && [ -d "$INSTALL_DIR/.next" ]; then
        PREBUILT=1
    fi
    rm -f "$TAR_PATH"
fi

if [ "$PREBUILT" = "1" ]; then
    # 3a. Быстрый путь: только production-зависимости, без сборки
    cd "$INSTALL_DIR"
    echo "[3/3] Установка зависимостей (production)..."
    bun install --production --frozen-lockfile || bun install --production
else
    # 3b. Откат: загрузка исходников и полная сборка
    echo "      Готовая сборка недоступна, собираю из исходников..."
    if command -v git &> /dev/null; then
        if [ -d "$INSTALL_DIR/.git" ]; then
            cd "$INSTALL_DIR" && git pull --ff-only || true
        else
            rm -rf "$INSTALL_DIR"
            git clone --depth 1 "https://github.com/$REPO.git" "$INSTALL_DIR"
        fi
    else
        rm -rf "$INSTALL_DIR" "$HOME/.momp-temp.zip"
        curl -fsSL "https://github.com/$REPO/archive/refs/heads/main.zip" -o "$HOME/.momp-temp.zip"
        unzip -q "$HOME/.momp-temp.zip" -d "$HOME/.momp-extract"
        mv "$HOME/.momp-extract/momp-main" "$INSTALL_DIR"
        rm -rf "$HOME/.momp-extract" "$HOME/.momp-temp.zip"
    fi
    cd "$INSTALL_DIR"
    echo "[3/3] Установка зависимостей и сборка..."
    echo "      → Установка пакетов (Bun)..."
    bun install --frozen-lockfile || bun install
    echo "      → Сборка веб-интерфейса (Next.js)..."
    OMP_WEB_FAST_BUILD=1 bun run build
fi
# 4. Настройка глобальной команды
echo "Настройка команды momp..."
mkdir -p "$INSTALL_DIR/cmd"
cat << 'EOF' > "$INSTALL_DIR/cmd/momp"
#!/usr/bin/env bash
BUN_BIN="$HOME/.bun/bin/bun"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [ -f "$BUN_BIN" ]; then
    exec "$BUN_BIN" --bun "$SCRIPT_DIR/../bin/omp-web.js" "$@"
else
    exec bun --bun "$SCRIPT_DIR/../bin/omp-web.js" "$@"
fi
EOF
chmod +x "$INSTALL_DIR/cmd/momp"

# Симлинк в /usr/local/bin или ~/.local/bin
if [ -w "/usr/local/bin" ]; then
    ln -sf "$INSTALL_DIR/cmd/momp" /usr/local/bin/momp
elif [ -d "$HOME/.local/bin" ]; then
    ln -sf "$INSTALL_DIR/cmd/momp" "$HOME/.local/bin/momp"
else
    mkdir -p "$HOME/.local/bin"
    ln -sf "$INSTALL_DIR/cmd/momp" "$HOME/.local/bin/momp"
    export PATH="$HOME/.local/bin:$PATH"
fi

echo ""
echo "=== momp max успешно установлен! ==="
echo "Запустите команду:"
echo "   momp"
echo ""
