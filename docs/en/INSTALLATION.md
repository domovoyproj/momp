# Installation, upgrade and rollback

[Русский](../ru/INSTALLATION.md) · [Workspace guide](USER_GUIDE.md)

For a published stable version, open [GitHub Releases](https://github.com/domovoyproj/momp/releases) and download the Windows portable executable or follow the web installation instructions. Match the asset against the SHA-256 in the release. On Windows, run `Get-FileHash .\momp.exe -Algorithm SHA256`. Preview builds are tested separately and are outside the stable update channel.

To run from source, install Git and Bun 1.4.4 or newer, then run the following from the repository root.

```sh
bun install --frozen-lockfile
bun run dev
```

Open `http://127.0.0.1:30141` and choose a Git project. Native Windows builds also require Rust, the Visual C++ build tools and WebView2.

Before upgrading, keep the previous executable or the web installer's backup. Close the current app before replacing it. To roll back, launch the previous executable, or restore the previous web installation while the server is stopped. Preserve the OMP profile, including `agent.db`, configuration and sessions. Stable in-app updates check the asset's source and SHA-256 and preserve a backup. The portable executable has no Authenticode signature.
