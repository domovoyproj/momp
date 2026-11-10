# Installation, upgrade and rollback

[Русский](../ru/INSTALLATION.md) · [Workspace guide](USER_GUIDE.md)

For a published stable version, open [GitHub Releases](https://github.com/domovoyproj/momp/releases) and download the Windows portable executable or follow the web installation instructions. Match the asset against the SHA-256 in the release. On Windows, run `Get-FileHash .\momp.exe -Algorithm SHA256`. Preview builds are tested separately and are outside the stable update channel.

To run from source, install Git and Bun 1.4.4 or newer, then run the following from the repository root.

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://127.0.0.1:30141` and choose a Git project. Native Windows builds also require Rust, the Visual C++ build tools and WebView2.

Open **Update center** in the sidebar to see the installed and latest stable versions, check for updates or read the rollback instructions. Finish active tasks before installing. Stable Windows updates verify the SHA-256, restart momp and save the previous executable as `previous.exe` in a `.momp-update-*` folder next to `momp.exe`. Close momp, keep a copy of the current EXE and restore `previous.exe` to roll back. For a web install, stop the server and restore its previous installation from backup. Keep the same OMP profile, including `agent.db`, configuration and sessions. The portable EXE has no Authenticode signature.
