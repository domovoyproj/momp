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

## Stable 1.6.0 preparation

- The released RC web archive matched GitHub's SHA-256 and launched under Bun 1.4.4 in a temporary profile. Its ChatGPT route emitted an OpenAI PKCE authorization request. The official Windows Antigravity CLI 1.5.4 matched Google's SHA-512 manifest, negotiated ACP v1 and returned the expected sign-in requirement. With no Google account on that profile, the usage endpoint reported Antigravity quota data as unavailable.
- The owner approved the stable release with automated checks and protocol verification. Interactive account sign-in, real model responses and account quota values remain pending live verification. The stable artifacts go through the same Windows and web release gates.

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

## 1.6.3-rc.1 — automatic Xbox DNS route (2026-11-11)

Branch: `codex/xbox-dns-routing`. Windows startup enables the app-scoped Google route automatically. Downloads and Google model requests use Xbox DNS over HTTPS; native Antigravity uses only the SHA-512-verified managed CLI 1.5.5. Bun remains pinned to 1.4.4 and OMP to 18.18.5.

Sign-in opens installed Microsoft Edge in a separate persistent momp profile, with a Google-only proxy, TLS verification, direct DNS disabled and QUIC disabled. The official CLI owns OAuth, token exchange and credential storage. A temporary launcher and narrowly scoped callback extension return the official one-time code to that CLI after validating the relay nonce, PKCE parameters, state, callback destination, expiry and replay protection. No coding task is submitted during sign-in. No API key, pasted code or manual DNS configuration is required. Windows and the user's normal browser profile are unchanged. The login process sets the official session-only `modelProvider: ""` option so a previously saved API-key preference cannot turn this Google sign-in action into API-key mode; the saved preference is not overwritten.

First use can require Google credentials and two-factor authentication because existing browser cookies are not copied. The official CLI allows approximately 60 seconds for authentication; retry after expiry retains the momp browser profile. Edge may show its developer-extension notification; it is not suppressed. Other platforms do not yet have this automatic browser flow. The authenticated native proxy permits non-Google **public HTTPS on port 443** through ordinary DNS so common coding tools can work. This is not transparent routing for arbitrary protocols, internal services or nonstandard ports; existing loopback bypass remains available.

Verification recorded for this candidate:

| Check | Result |
| --- | --- |
| Full `bun test --timeout 20000` | **733 passed, 6 skipped, 0 failed (739 tests, 134 files).** Includes relay/state/replay/cancellation, transport redirects, browser lifecycle, offline GUI-launcher compilation, cancelled sign-in cleanup and release-link rendering checks. |
| Typecheck / ESLint / release consistency | Passed. ESLint: zero errors and two existing warnings. |
| Actual Edge synthetic callback | `scripts/verify-google-browser.mjs` exited 0. Real isolated Edge and the callback helper delivered synthetic data to a fake CLI; no account or OAuth exchange. |
| Official native launch contract | Pinned CLI 1.5.5 reached the browser-launch handoff in an isolated, account-free probe; authentication was deliberately blocked. |
| Public network probes | Google public HTTPS endpoints responded through the Xbox DNS route with TLS verification. The managed CLI download and pinned SHA-512 verification passed. |
| Production build | Final rebuild passed (60-second compile), including the native provider preference and cancellation gate, with the existing session-export dynamic-import warning. Release CI must also build and validate the exact candidate commit. |
| Default Windows route UI | `scripts/verify-google-route-ui.mjs` passed in an empty isolated profile. Four real desktop/mobile light/dark [screenshots](screenshots/xbox-dns/README.md) were captured; no OAuth request was started. |
| Final native sign-in preference regression | 15 targeted tests passed after adding the session-only provider selection override; the final full suite above includes this change. |
| Cancel-and-retry regression | The production browser reproduced a race between client cancellation and release of the server lease. The new gate waits only for cancelled cleanup, rejects active concurrent sign-ins and rechecks competing retries. Five deterministic regression tests, six API access tests and the final production browser cancellation/retry scenario passed, including confirmation that the cancelled process exited. |
| Full browser E2E / Windows release CI | Final production E2E passed: moved-workspace recovery, desktop/mobile light/dark collaboration, Antigravity, persisted history, keyboard and viewport checks. Windows release CI is pending; candidate artifacts must not be created before its required gates pass. |

Xbox DNS reported an outage on November 11, 2026, and returned `0.0.0.0` / `::` for `generativelanguage.googleapis.com`. The app rejects these answers and does not silently change DNS providers. **PENDING LIVE VERIFICATION:** successful Google account sign-in, real Antigravity/Gemini inference, model discovery, account quotas and reauthorization. Public TLS and synthetic callback evidence do not prove these scenarios. Follow the [English](en/LIVE_VERIFICATION.md) or [Russian](ru/LIVE_VERIFICATION.md) checklist after service recovery.

Resume from this candidate's checkout in Windows PowerShell; the first command downloads/reuses the project's pinned Bun when needed, without replacing the global installation:

```powershell
git switch codex/xbox-dns-routing
bun scripts/fetch-bun.mjs windows-x64
$mompBun = (Resolve-Path '.\src-tauri\resources\bun-windows-x64.exe').Path
& $mompBun --version
& $mompBun install --frozen-lockfile
& $mompBun run typecheck
& $mompBun run lint
& $mompBun test --timeout 20000
& $mompBun scripts/check-release.mjs
$env:OMP_WEB_DIST_DIR = '.next-xbox-verification'
& $mompBun --bun node_modules/next/dist/bin/next build --webpack
$env:PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH = Join-Path ${env:ProgramFiles(x86)} 'Microsoft\Edge\Application\msedge.exe'
& $mompBun scripts/test-browser.mjs
$env:MOMP_SCREENSHOTS_DIR = 'test-artifacts/google-route'
& $mompBun scripts/verify-google-route-ui.mjs
# Optional network-dependent probe: opens real Edge using synthetic OAuth data.
& $mompBun scripts/verify-google-browser.mjs
```

Release notes are rendered with links pinned to the verified commit, preserving local source documents and working links to both languages and the screenshot gallery. Five tests cover the current notes, safe path handling and the standalone Node CLI used by the release job.

Next priorities: record the full browser E2E result; build and validate the exact final commit in Windows release CI, including desktop, installer/update/rollback and EXE smoke gates; prepare verified candidate artifacts and checksums; complete the live checklist before claiming validated account access. No stable-release readiness is implied by this checkpoint.
