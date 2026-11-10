# Next generation release candidate

Baseline: `a110438` on `main`. Working branch: `feat/next-generation-rc`.

## Current repository map

| Area | Current implementation and modernization boundary |
| --- | --- |
| Web and desktop | Next.js App Router and React share the UI. Next externalizes the TypeScript OMP SDK as ESM so Bun loads it at runtime. Tauri extracts a staged payload and starts it on loopback. Preserve that boundary. |
| Sessions | `AppShell` and `ChatWindow` call `useAgentSession`, the agent API, and `AgentSessionWrapper`. Session files remain SDK-owned. Existing tests cover session promotion, streaming reconciliation, compaction, and branch selection. |
| Models and auth | `omp-runtime` owns the process-wide SQLite `AuthStorage`, `Settings`, and `ModelRegistry`. Auth routes and the settings UI use the catalog and OAuth registry. Chat role presets select models but do not coordinate work across agents. |
| Quotas | The limits endpoint already reads SDK usage reports. The projection currently substitutes zero for unknown usage and the dialog only refreshes provider data on open or manual request. |
| Projects and tools | Worktree, file, and Git routes use the existing project roots and trust gates. File drafts, safe file responses, skill discovery, plugin diagnostics, and MCP controls already have regression coverage. |
| Delivery | `publish-dist.yml` tests web and desktop and can create a draft with SHA-256 checksums. The updater checks published stable releases. The October audit and the `1.5.0` artifacts are historical evidence only. |

The code-only Graphify index covered 371 files, 2,750 nodes and 6,529 edges. The heaviest integration points are `AgentSessionWrapper`, request validation, and file roots. The existing GitNexus checkout had no index. Graphify and direct source inspection supplied the initial map.

## Implementation order

1. Upgrade OMP and pin a compatible Bun across local, desktop and CI. Confirm SDK contracts and preserve on-disk data.
2. Surface provider availability and quota provenance. Use independent OpenAI and Google routes, with Google's supported `agy` interface for Antigravity sign-in and execution.
3. Add resumable collaboration with explicit model selection, bounded context, isolated proposed changes and an approval step.
4. Refine workspace navigation and collaboration UI, then verify responsive layouts and settings in a browser.
5. Prepare RU/EN guides and notes, run the release gates, and create a draft only if the required gates pass.

## Upstream findings

- GitHub and npm identify [OMP 18.18.5](https://github.com/can1357/oh-my-pi/releases/tag/v18.18.5) as the latest stable release checked on 2026-11-10. The coding agent requires Bun `>=1.4.4`.
- [OMP paused its built-in Antigravity OAuth path](https://github.com/can1357/oh-my-pi/releases/tag/v18.18.4), including login, refresh, model requests and usage probes. Existing credentials are retained. Google's [official Antigravity CLI](https://antigravity.google/docs/cli/headless/) supports programmatic headless operation and its own Google sign-in.
- OpenAI documents ChatGPT sign-in and platform API keys as separate modes, and publishes a [Codex App Server quota contract](https://learn.chatgpt.com/docs/app-server#authentication-and-accounts). The existing OMP SDK remains the source for momp's OAuth and account usage reports.

## Implemented in the candidate branch

- Pins the OMP packages to 18.18.5, raises the launcher floor to Bun 1.4.4, and uses that pin for CI and the embedded desktop runtime. TypeScript and the existing SDK-backed tests exercise session, settings, models and credential integration.
- Separates ChatGPT, OpenAI API, Gemini API and official Antigravity CLI setup. The OAuth bridge binds a cryptographically random, single-use callback token to the exact provider. The quota UI preserves unknown values and shows reported times, stale data and refresh errors.
- Adds persistent AI tasks, solo and two-provider strategies, parallel independent review, task-type routing with a preferred lead, explicit retry or fallback, and downloadable Git patches. A disposable Git index provides the actual diff and whitespace check. The workspace and its uncommitted files are outside the proposal write path.
- Adds a Windows release smoke fixture with Git and verifies the embedded Bun version. GitHub Actions runs typecheck, lint, Bun, browser, installer and native desktop checks before creating any draft. Bilingual user and live-verification guides are under `docs/en/` and `docs/ru/`.

## Verification for 1.6.0-rc.1

| Check | Result |
| --- | --- |
| `bun test` on Windows | 659 passed, 5 platform-dependent skips, 0 failed. |
| `bun run typecheck`, `bun run lint`, `bun run test:release` | Passed. ESLint reported two existing unused-variable warnings. |
| `bun audit --production --audit-level=high` | No advisories at high severity or above in the 180 checked packages. |
| Web production build | Passed with the existing dynamic-import warning from the session export route. |
| `bun run test:browser` | Production build verified in Edge at 1440×960 and 390×844 in both themes. GPT and Gemini were synthetic HTTP providers. Usage used synthetic reports. |
| PowerShell/Bash installers and update helper | Passed hash, incomplete payload, backup and rollback cases. |
| Windows native build and EXE smoke | Passed in [release CI #49](https://github.com/domovoyproj/momp/actions/runs/42724223875) for `ed1a902`: 10 Rust tests, SFX extraction, bundled Bun, UI and SDK-backed APIs. Local MSVC `link.exe` is absent. |
| Draft release | [1.6.0-rc.1](https://github.com/domovoyproj/momp/releases/tag/untagged-40ead598f02af6bf4f63) created after the release gates with the EXE, web archive, browser evidence and SHA-256 checksums. |
| Live provider checks | **PENDING LIVE VERIFICATION.** No real model response or OAuth login was exercised. |

## Follow-up candidate 1.6.0-rc.2

- The independent Antigravity chat launches Google's `agy acp --sandbox` and uses OMP's ACP transport. The CLI owns Google OAuth and restores its conversation context. momp persists the recent transcript, reconnects a browser stream from a full snapshot and displays plan updates, tools, diffs and one-time permissions. The Windows ACP contract test uses a compiled fixture with no accounts.
- Hybrid can generate, verify, review, apply and reverse scoped Git patches. An optional offline, unprivileged Docker runner executes `bun test` on an isolated archive of the patched commit. Model review receives exact diff and test evidence. In-app application checks HEAD, staged changes, symlinks and content digests. The task journal permits retry after an interruption without overwriting mismatched files.
- The workspace gained narrower split-pane composer controls, a native settings dialog with mobile search, translated file modes, a keyboard exit from the editor and an Update center with active-task checks. MCP protects credentials in native and imported config views and preserves stored values during editing. Quota countdowns require an explicit timestamp from the provider.
- Fixed Windows short-path aliases in Git status and diff. The regression covers an aliased working directory and a deleted file whose parent directory is gone.
- Local Windows verification passed 668 Bun tests with six skips, including the Linux Docker contract, and no failures. Typecheck, ESLint, the 180-package production dependency audit, release metadata, Windows installer and update helper passed. ESLint retained two existing warnings and the production build retained the session export dynamic-import warning.
- The extended production browser suite passed all four light/dark desktop/mobile runs, including normal GPT and Gemini chat, Antigravity stream recovery, MCP saving and redaction, file edits, Git diff, skills, plugins and update checks. The [gallery](screenshots/next/README.md) contains 35 captured states. The Linux Docker contract and native Windows EXE smoke are enforced by GitHub Actions.
- **PENDING LIVE VERIFICATION.** Follow the [English checklist](en/LIVE_VERIFICATION.md) or [Russian checklist](ru/LIVE_VERIFICATION.md) with real accounts. Prepare a new GitHub draft only after the automated gates pass.

## Resume

```powershell
git switch feat/next-generation-rc
bun --version
bun install --frozen-lockfile
bun run typecheck
bun run lint
bun test
bun run test:release

$env:OMP_WEB_DIST_DIR = '.next-desktop'
bun run build
bun x playwright install chromium
bun run test:browser
```

Use Bun 1.4.4 or newer and an isolated `PI_CODING_AGENT_DIR` for interactive tests. Use `bun run desktop:build` or an isolated Next.js output directory for production checks. Live provider verification is pending and no account is required for the automated suite.

On a clean Windows runner with MSVC and WebView2, run `cargo test --manifest-path src-tauri/Cargo.toml --locked`, `bun run desktop:fetch-bun windows-x64`, `bun run desktop:build` and `./scripts/smoke-desktop.ps1`. To build a draft prerelease, the owner can dispatch `publish-dist.yml` for the candidate branch or add the `[prepare-rc] ` prefix to the title of a same-repository draft PR. The title action pins all jobs to the PR head commit and the draft step requires successful checks and an RC version. Verify its `SHA256SUMS` and complete the owner review before publishing.
