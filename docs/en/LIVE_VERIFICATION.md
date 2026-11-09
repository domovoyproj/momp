# PENDING LIVE VERIFICATION

[Русский](../ru/LIVE_VERIFICATION.md) · [Connection instructions](AI_MODES.md)

Use a disposable Git project with one committed text file. Start with one connected provider at a time. Never include credentials in reports.

1. Sign in to ChatGPT from Connections. Select a model and reasoning level, send a short prompt, close and reopen the session. Check the usage window and timestamp, if the provider returns them. Repeat sign-in after a deliberate sign-out.
2. Sign in to the official Google Antigravity CLI, run `agy models` and configure the executable path. Choose Gemini only in AI tasks, select the CLI and send a short task. Verify the selected model, result and official usage view. Repeat after re-authentication.
3. With Gemini API configured separately, run a normal chat with a file read and confirm the session reopens.
4. Configure both providers. Run GPT lead, then Gemini lead, verify the second provider saw the exact diff, and verify the Git checkout remained unchanged. Switch the selected model and rerun. When a real quota or connection error occurs, check pause and explicit resume without a provider switch.

Record outcomes separately for real OAuth, model discovery, quota reporting and inference. Account-free automated tests use local fixtures.
