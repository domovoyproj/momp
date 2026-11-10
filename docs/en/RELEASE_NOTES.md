# momp 1.6.2

- Choose **Connections → Google Antigravity → Sign in with Google**. If needed, momp downloads and verifies the official client and keeps it for later use. You complete sign-in in the browser and can cancel it in momp.
- If you open Antigravity while the workspace is loading, the project history appears when it is ready.
- The project menu stays within the window on desktop and mobile. Escape closes it and returns focus to the project.
- File Explorer lists an explicitly selected Windows drive root. If a project folder moves, File Explorer and Skills offer to open another folder.

Google sign-in with a real account remains **PENDING LIVE VERIFICATION**. Automatic setup, cache reuse and the Google sign-in method were checked with the official client on Windows x64. [AI modes](AI_MODES.md) · [Live checklist](LIVE_VERIFICATION.md)

## momp 1.6.0

[Русский](../ru/RELEASE_NOTES.md) · [Install or roll back](INSTALLATION.md) · [Live verification](LIVE_VERIFICATION.md)

## Provider modes

Use ChatGPT through Codex sign-in, Gemini through Antigravity chat, or both in AI tasks. Antigravity chat uses the official CLI and supports model and thinking selection, streamed responses, tool permissions and saved conversations. Gemini API and OpenAI API remain separate connections. Usage limits keeps provider-reported figures and shows the reset countdown when an exact timestamp is available.

## Tasks and workspace

Review a diff and optional offline project test evidence before applying a patch. AI tasks can also reverse their own patches after verifying the working files. Select the models and file scope before execution. The workspace keeps the file editor and composer readable in a split view, provides mobile settings search, and shows update status and rollback instructions in the Update center.

## Compatibility and checks

Oh My Pi 18.18.5, Bun 1.4.4, Next.js 16.4.3, React 19.2.8 and Tauri 2.11.5. Existing OMP sessions, settings and credentials use their existing stores. MCP secret values in supported configuration fields stay on the server.

The Windows EXE is portable and ships without an Authenticode signature. The published candidate started under Bun 1.4.4 and produced the OpenAI OAuth authorization request. Google's Antigravity CLI 1.5.4 negotiated ACP v1 on Windows. Real account sign-in, inference and quota reporting are [pending live verification](LIVE_VERIFICATION.md). See [implementation progress](../IMPLEMENTATION_PROGRESS.md) for the release gates and [the screenshot gallery](../screenshots/next/README.md) for captured application states.
