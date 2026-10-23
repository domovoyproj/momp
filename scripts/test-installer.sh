#!/usr/bin/env bash
set -euo pipefail
ROOT="$(mktemp -d "${TMPDIR:-/tmp}/momp-installer-test-XXXXXXXX")"
cleanup() {
    case "$ROOT" in "${TMPDIR:-/tmp}"/momp-installer-test-*) rm -rf -- "$ROOT";; esac
}
trap cleanup EXIT
source "$(dirname "${BASH_SOURCE[0]}")/../install.sh"

destination="$ROOT/momp's app"
staging="$destination.stage-fixture"
mkdir -p "$destination" "$staging"
echo previous > "$destination/previous.txt"
if momp_promote_install "$staging" "$destination"; then echo 'Accepted an incomplete installation' >&2; exit 1; fi
[[ -f "$destination/previous.txt" ]]
for relative in .next/BUILD_ID package.json bun.lock next.config.js bin/omp-web.js node_modules/next/dist/bin/next node_modules/@oh-my-pi/pi-coding-agent/package.json; do
    mkdir -p "$(dirname "$staging/$relative")"
    echo fixture > "$staging/$relative"
done
mv() {
    if [[ "$1" == "$staging" ]]; then return 1; fi
    command mv "$@"
}
if momp_promote_install "$staging" "$destination"; then echo 'Expected a promotion failure' >&2; exit 1; fi
unset -f mv
[[ -f "$destination/previous.txt" ]]
momp_promote_install "$staging" "$destination"
momp_validate_payload "$destination" dependencies
[[ -f "$destination.backup-fixture/previous.txt" ]]
runtime_directory="$ROOT/pinned bun's runtime!"
mkdir -p "$runtime_directory"
runtime="$runtime_directory/bun"
printf '#!/usr/bin/env bash\nprintf "PINNED_BUN\\n"\nexit 7\n' > "$runtime"
chmod +x "$runtime"
if momp_write_launcher "$destination/cmd" bun; then echo 'Accepted a relative runtime' >&2; exit 1; fi
momp_write_launcher "$destination/cmd" "$runtime"
status=0
output="$("$destination/cmd/momp" 'argument with spaces')" || status=$?
[[ "$status" == 7 && "$output" == PINNED_BUN ]]
echo 'PASS: incomplete package rejection, failed promotion rollback, retained backup and pinned launcher with quoted paths'
