#!/usr/bin/env bash
set -euo pipefail

momp_validate_payload() {
    local directory="$1" relative
    for relative in .next/BUILD_ID package.json bun.lock next.config.js bin/omp-web.js; do
        [[ -f "$directory/$relative" ]] || { echo "Incomplete package: $relative" >&2; return 1; }
    done
    if [[ "${2:-}" == dependencies ]]; then
        for relative in node_modules/next/dist/bin/next node_modules/@oh-my-pi/pi-coding-agent/package.json; do
            [[ -f "$directory/$relative" ]] || { echo "Missing dependency: $relative" >&2; return 1; }
        done
    fi
}

momp_promote_install() {
    local source="$1" destination="$2" backup=""
    [[ "${source%/*}" == "${destination%/*}" && "$source" == "$destination".stage-* && ! -L "$source" && ! -L "$destination" ]] || return 1
    momp_validate_payload "$source" dependencies || return 1
    if [[ -e "$destination" ]]; then
        backup="$destination.backup-${source##*.stage-}"
        [[ ! -e "$backup" ]] || return 1
        mv "$destination" "$backup" || return 1
    fi
    if ! mv "$source" "$destination"; then
        if [[ -n "$backup" && ! -e "$destination" ]]; then mv "$backup" "$destination"; fi
        return 1
    fi
    [[ -z "$backup" ]] || echo "Previous installation retained: $backup"
}

momp_write_launcher() {
    local directory="$1" executable="$2" quoted_executable
    [[ "$executable" == /* && -x "$executable" ]] || return 1
    mkdir -p "$directory"
    printf -v quoted_executable '%q' "$executable"
    cat > "$directory/momp" <<LAUNCHER
#!/usr/bin/env bash
set -e
BUN_BIN=$quoted_executable
SCRIPT_DIR="\$(cd "\$(dirname "\${BASH_SOURCE[0]}")" && pwd)"
exec "\$BUN_BIN" --bun "\$SCRIPT_DIR/../bin/omp-web.js" "\$@"
LAUNCHER
    chmod +x "$directory/momp"
}

install_momp() (
    local install_dir="$HOME/.momp-app" staging="" lock="$HOME/.momp-install.lock" archive metadata url digest bytes entry bun_executable
    if ! mkdir "$lock" 2>/dev/null; then
        echo "Installer lock exists: $lock. Finish the other installation first." >&2
        exit 1
    fi
    cleanup() {
        if [[ -n "$staging" && "${staging%/*}" == "$HOME" && "$staging" == "$install_dir".stage-* && -d "$staging" ]]; then rm -rf -- "$staging"; fi
        rmdir "$lock" 2>/dev/null || true
    }
    trap cleanup EXIT
    trap 'exit 130' INT
    trap 'exit 143' TERM
    if ! command -v bun >/dev/null; then
        if [[ -f "$HOME/.bun/bin/bun" ]]; then
            export PATH="$HOME/.bun/bin:$PATH"
        else
            curl --proto '=https' --tlsv1.2 -fsSL https://bun.sh/install | bash
            export PATH="$HOME/.bun/bin:$PATH"
        fi
    fi
    bun_executable="$(type -P bun)"
    bun_executable="$(cd "$(dirname "$bun_executable")" && pwd)/$(basename "$bun_executable")"
    [[ -x "$bun_executable" ]]
    command -v tar >/dev/null
    staging="$(mktemp -d "$install_dir.stage-XXXXXXXX")"
    archive="$staging/momp-web-dist.tar.gz"
    metadata="$(curl --proto '=https' --tlsv1.2 -fsSL -H 'User-Agent: momp-installer' https://api.github.com/repos/domovoyproj/momp/releases/latest)"
    printf '%s' "$metadata" | "$bun_executable" -e '
        const release = JSON.parse(await Bun.stdin.text());
        if (release.draft !== false || release.prerelease !== false || !/^v\d+\.\d+\.\d+$/.test(release.tag_name)) throw Error("Expected a stable published release");
        const assets = release.assets.filter(asset => asset.name === "momp-web-dist.tar.gz");
        if (assets.length !== 1) throw Error("Verified web package is missing");
        const asset = assets[0];
        const expected = "https://github.com/domovoyproj/momp/releases/download/" + release.tag_name + "/momp-web-dist.tar.gz";
        if (asset.browser_download_url !== expected || !/^sha256:[a-fA-F0-9]{64}$/.test(asset.digest) || !Number.isSafeInteger(asset.size) || asset.size <= 0 || asset.size > 1073741824) throw Error("Invalid release metadata");
        console.log([expected, asset.digest.slice(7), asset.size].join("\t"));
    ' > "$staging/release.tsv"
    IFS=$'\t' read -r url digest bytes < "$staging/release.tsv"
    curl --proto '=https' --proto-redir '=https' --tlsv1.2 -fsSL "$url" -o "$archive"
    MOMP_INSTALL_ARCHIVE="$archive" MOMP_INSTALL_DIGEST="$digest" MOMP_INSTALL_SIZE="$bytes" "$bun_executable" -e '
        import { createHash } from "node:crypto";
        const file = Bun.file(process.env.MOMP_INSTALL_ARCHIVE);
        if (file.size !== Number(process.env.MOMP_INSTALL_SIZE)) throw Error("Release size mismatch");
        const digest = createHash("sha256").update(Buffer.from(await file.arrayBuffer())).digest("hex");
        if (digest !== process.env.MOMP_INSTALL_DIGEST.toLowerCase()) throw Error("Release SHA-256 mismatch");
    '
    tar -tzf "$archive" > "$staging/archive-files.txt"
    while IFS= read -r entry; do
        if [[ "$entry" == /* || "$entry" == *:* || "/$entry/" == *"/../"* ]]; then echo "Unsafe archive path" >&2; exit 1; fi
    done < "$staging/archive-files.txt"
    tar -xzf "$archive" -C "$staging"
    rm -f "$archive" "$staging/release.tsv" "$staging/archive-files.txt"
    momp_validate_payload "$staging"
    (cd "$staging" && "$bun_executable" install --production --frozen-lockfile)
    momp_validate_payload "$staging" dependencies
    momp_write_launcher "$staging/cmd" "$bun_executable"
    momp_promote_install "$staging" "$install_dir"
    mkdir -p "$HOME/.local/bin"
    ln -sf "$install_dir/cmd/momp" "$HOME/.local/bin/momp"
    echo "momp installed. Run: $HOME/.local/bin/momp"
    case ":$PATH:" in
        *":$HOME/.local/bin:"*) ;;
        *) echo 'Add $HOME/.local/bin to PATH in your shell profile.' ;;
    esac
)

if [[ -z "${BASH_SOURCE[0]:-}" || "${BASH_SOURCE[0]}" == "$0" ]]; then install_momp; fi
