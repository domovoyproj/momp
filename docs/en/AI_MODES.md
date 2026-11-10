# AI connections and modes

[Русский](../ru/AI_MODES.md) · [Hybrid AI](HYBRID_MODE.md) · [Live verification](LIVE_VERIFICATION.md)

## ChatGPT

Open **Connections → ChatGPT**, then complete the Codex sign-in flow in the browser. Open a project and choose your ChatGPT model and reasoning level in the main composer. The chat supports files, tools, Git and saved sessions. OpenAI platform keys belong to the separate **OpenAI API** provider with its own billing.

## Google Antigravity

1. Install the [official Antigravity CLI](https://antigravity.google/docs/cli/install). Confirm that `agy acp --help` is available. CLI 1.5.0 or newer is required for the integrated usage report.
2. Set `MOMP_ANTIGRAVITY_CLI` to the full path to the trusted executable before starting momp. On Windows PowerShell, use `$env:MOMP_ANTIGRAVITY_CLI = (Get-Command agy.exe).Source` and launch momp from the same session. On Linux or macOS, use `export MOMP_ANTIGRAVITY_CLI="$(command -v agy)"`.
3. Open a project and choose **Antigravity chat**. Select **Sign in with Google** to open the CLI's browser sign-in on the machine running momp. The CLI owns the credential store. For a server without a browser, sign in on that machine with `agy acp --login`.
4. Review project trust and confirm use of Antigravity tools. **Start conversation** opens the project. Select a model and thinking level from the options reported by the CLI. Tool requests can be denied or allowed once when the CLI asks. The CLI's permission rules and terminal sandbox also apply.
5. Open a saved conversation from the history and choose **Reconnect conversation** when it is disconnected. The app preserves recent transcript entries and the CLI restores its own conversation context.

This mode runs independently of ChatGPT. The Google Gemini API is another independent connection. Configure a Google AI Studio key from **Connections → Gemini API**, then use a Gemini model in the main OMP chat. OMP currently retains credentials for its paused legacy Antigravity integration.

## Hybrid and limits

Open **AI tasks** to choose GPT, Gemini, or both. With the CLI configured, choose **Google Antigravity CLI** for the Gemini role and use a model from `agy models`. The workflow and review permissions are described in [Hybrid AI](HYBRID_MODE.md).

**Usage limits** refreshes account reports while open. The app shows provider-reported reset times, marks unavailable values and retains the latest successful report when a refresh fails. For Antigravity the app uses the CLI's read-only `/usage` output. It shows a countdown when the output contains a timestamp with a timezone. If quota runs out, save or pause the work and continue after recovery or explicitly choose an available model.
