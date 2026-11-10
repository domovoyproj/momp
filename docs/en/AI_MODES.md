# AI connections and modes

[Русский](../ru/AI_MODES.md) · [Hybrid AI](HYBRID_MODE.md) · [Live verification](LIVE_VERIFICATION.md)

## ChatGPT

Open **Connections → ChatGPT**, then complete the Codex sign-in flow in the browser. Open a project and choose your ChatGPT model and reasoning level in the main composer. The chat supports files, tools, Git and saved sessions. OpenAI platform keys belong to the separate **OpenAI API** provider with its own billing.

## Google Antigravity

1. On the computer running momp, choose **Connections → Google Antigravity → Sign in with Google**. You can do this before selecting a project.
2. On Windows, momp prepares the official component if needed and opens a separate Microsoft Edge window through Xbox DNS. Sign in to your Google Account there and return to momp. There is no DNS setup, API key or authorization code to copy. The initial Windows x64 download is about 226 MB; momp verifies the Google-hosted file and reuses it later. Google's official CLI completes OAuth and stores your credentials. [Official CLI reference](https://antigravity.google/docs/cli/reference/)
3. Open a project and choose **Antigravity chat**. Review project trust, allow Antigravity tools and select **Start conversation**. If Antigravity requests permission, you can deny the action or allow it once.
4. To return to a saved conversation, select it from the history and choose **Reconnect conversation**.

### Automatic Google routing on Windows

The Windows server enables Xbox DNS for Google downloads, sign-in and model requests by default. This route requires an installed Edge for automatic Antigravity sign-in. It uses an app-owned browser profile; settings and cookies in your everyday browser stay separate. On first use, Google may request your password and two-factor confirmation. The selected account can be remembered for later attempts.

The official CLI allows approximately 60 seconds for authentication. If it times out during the first sign-in, select **Sign in with Google** again; the momp browser profile is retained. A narrow temporary helper returns only the one-time code from the official Antigravity callback to the CLI. You may see Edge's developer-extension notification; momp does not hide it. If browser management policies block the helper, sign-in fails with an error rather than changing your policies or using a direct connection.

Downloads and browser transport have been checked against public Google endpoints, and automatic callback delivery has been tested with synthetic data. **Real account sign-in and real model responses remain PENDING LIVE VERIFICATION.** On November 11, 2026, Xbox DNS reported a service outage and returned unusable addresses for the Gemini API hostname. The app reports route failures and does not silently change resolvers. See the [live checklist and optional diagnostics](LIVE_VERIFICATION.md).

Component download supports x64 and ARM64 on Windows, macOS and Linux with glibc. The automatic Xbox DNS browser route described above is currently Windows-only and uses the hash-verified managed client 1.5.5, including for chat and usage reports. It does not launch a different system or custom CLI. Outside that mode, momp reuses an installed client or the administrator's `MOMP_ANTIGRAVITY_CLI` path; usage reports require version 1.5.0 or newer.

This mode runs independently of ChatGPT. The Google Gemini API is another independent connection. Configure a Google AI Studio key from **Connections → Gemini API**, then use a Gemini model in the main OMP chat. OMP currently retains credentials for its paused legacy Antigravity integration.

## Hybrid and limits

Open **AI tasks** to choose GPT, Gemini, or both. After Google sign-in, choose **Google Antigravity CLI** for the Gemini role and select a model from the list in the same window. The workflow and review permissions are described in [Hybrid AI](HYBRID_MODE.md).

**Usage limits** refreshes account reports while open. The app shows provider-reported reset times, marks unavailable values and retains the latest successful report when a refresh fails. For Antigravity the app uses the CLI's read-only `/usage` output. It shows a countdown when the output contains a timestamp with a timezone. If quota runs out, save or pause the work and continue after recovery or explicitly choose an available model.
