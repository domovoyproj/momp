# momp release checklist

Repository: https://github.com/domovoyproj/momp. Releases contain `momp.exe`, `momp-web-dist.tar.gz`, and `SHA256SUMS`. Do not publish this fork to the upstream npm package.

1. Bump `package.json`, refresh `bun.lock` and `package-lock.json`, and run `bun run desktop:sync-version`.
2. Update `docs/release-notes.md` with actual changes and compatibility limits.
3. Run `bun run typecheck`, `bun test`, `cargo test --manifest-path src-tauri/Cargo.toml --locked`, and `scripts/test-update-helper.ps1`.
4. Build with `bun run desktop:fetch-bun windows-x64` and `bun run desktop:build`. Windows compilation requires Rust MSVC, Visual Studio C++ Build Tools and the Windows SDK.
5. Run `scripts/smoke-desktop.ps1` against the exact packaged executable. It isolates the runtime and agent directories, starts the EXE, verifies the page and SDK-backed API endpoints, then terminates only its own process tree. Logs remain in the printed temporary directory.
6. Review the native window controls, light/dark appearance, small viewport, connections, skills and role presets. Do not publish a build that only passes unit tests but fails to launch.
7. Push the version change to main. The Verified release workflow builds on Linux and Windows, runs checks and uploads intermediate artifacts. A manual workflow run additionally creates a draft release after both jobs succeed; publish that draft in GitHub only after the final UI review. Matching version tags also run verification. Published assets are immutable: use a new version rather than overwriting an existing release.
8. Download the published EXE, verify its SHA-256 against both the release API digest and SHA256SUMS, and run the smoke test again.

## Portable updater

The desktop checks the stable GitHub latest-release endpoint on launch, every 30 minutes, and on returning to the window. Installation is explicit so running tasks are never interrupted without a user action. Native code fetches only this repository's momp.exe, requires a newer stable semantic version, validates the HTTPS asset URL, length, GitHub SHA-256 digest and SFX footer, and stages beside the current EXE.

A hidden helper independently checks the hash, signals readiness, waits for the original process to exit, retains previous.exe, installs the replacement and restarts. Failed preparation leaves the running app intact. If replacement or launch fails, it restores the backup where possible. Logs and the backup remain in .momp-update-* for diagnosis/manual rollback. The EXE is not Authenticode-signed; digest verification is not an independent publisher signature.

A read-only installation directory must be moved to a writable folder. Do not silently elevate or disable endpoint protection. If the network, GitHub rate limit or missing asset digest blocks updating, keep the current app and offer the normal release download link.

## Upstream refreshes

Read the OMP release notes and update all @oh-my-pi runtime packages together. Changes to Settings, AuthStorage and session events require adapter migrations; a successful package install is not sufficient validation. Keep failed upstream updates out of published releases.
