# momp 1.6.0-rc.1

[Русский](../ru/RELEASE_NOTES.md) · [Install or roll back](INSTALLATION.md) · [Live verification](LIVE_VERIFICATION.md)

The 1.6 candidate branch upgrades Oh My Pi to 18.18.5 and pins Bun 1.4.4 for local, CI and desktop runs. It keeps Next.js 16.4.3, React 19.2.8 and Tauri 2.11.5.

**AI tasks** adds single-provider runs, lead-and-review workflows, dual review, and selection by task type. The task panel shows the lead, reviewers, results, progress and an exportable Git patch. Failed stages can resume independently. The working checkout stays available for other work.

**Connections** distinguishes ChatGPT OAuth, OpenAI API, Gemini API and the official Antigravity CLI. **Usage limits** preserves unknown usage, refreshes while visible and displays provider reset timestamps where available.

The existing chat and SDK credential store remain in place. The official Antigravity integration is limited to AI tasks through `agy`; native OMP Antigravity OAuth is paused upstream. Project test execution and patch application are manual. Real provider sign-in, inference and account quotas are [pending live verification](LIVE_VERIFICATION.md).

See [implementation progress](../IMPLEMENTATION_PROGRESS.md) for test results, outstanding release gates and build instructions.
