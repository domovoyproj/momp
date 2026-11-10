# Troubleshooting

[Русский](../ru/TROUBLESHOOTING.md) · [Installation and rollback](INSTALLATION.md)

| Symptom | What to check |
| --- | --- |
| ChatGPT does not appear | Open Connections and check the OAuth sign-in. The OpenAI API key connects a separate provider. |
| Legacy Antigravity sign-in is missing | OMP paused that route. Set up the official CLI as described in [AI modes](AI_MODES.md), or configure Gemini API separately. |
| Antigravity chat cannot connect | Check `agy acp --help`, the executable path in `MOMP_ANTIGRAVITY_CLI`, project trust and Google sign-in on the momp host. |
| A task reports quota exhaustion | Check Usage limits, or check the official Antigravity client. Keep the task paused until the provider recovers. |
| A task cannot read a file | Supply a tracked UTF-8 file from the selected Git project. Uncommitted edits and excluded credential paths are unavailable to the task. |
| A patch no longer applies | Check that you are in the correct repo and compare the current file with the task's baseline commit. Review and resolve conflicts manually. |
| Isolated tests are unavailable | Check the local Linux container engine and the preloaded image named in `MOMP_TEST_RUNNER_IMAGE`. See [Hybrid AI](HYBRID_MODE.md) for snapshot and dependency requirements. |
| Installation or update failed | Check the asset hash and Bun version. Close the process and restore the previous verified executable or installation backup. Preserve the OMP profile. |

See [live verification](LIVE_VERIFICATION.md) for real sign-in and inference checks. Capture provider name, timestamp, stage and error status when reporting a failure. Keep credentials and project contents out of issue logs.
