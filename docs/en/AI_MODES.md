# AI connections and modes

[Русский](../ru/AI_MODES.md) · [Hybrid AI](HYBRID_MODE.md) · [Live verification](LIVE_VERIFICATION.md)

## ChatGPT

Open **Connections → ChatGPT**, then complete the Codex sign-in flow in the browser. Open a project and choose your ChatGPT model and reasoning level in the main composer. The chat supports files, tools, Git and saved sessions. OpenAI platform keys belong to the separate **OpenAI API** provider with its own billing.

## Google Antigravity

1. On the computer running momp, choose **Connections → Google Antigravity → Sign in with Google**. You can do this before selecting a project.
2. Choose your Google Account in the browser and return to momp. If needed, momp downloads the component directly from Google on first sign-in, verifies it and keeps it for later use. The initial download on Windows x64 is about 226 MB. Google's official client stores your credentials. [How Antigravity sign-in works](https://antigravity.google/docs/ide/extensions/acp#authentication)
3. Open a project and choose **Antigravity chat**. Review project trust, allow Antigravity tools and select **Start conversation**. If Antigravity requests permission, you can deny the action or allow it once.
4. To return to a saved conversation, select it from the history and choose **Reconnect conversation**.

Automatic setup supports x64 and ARM64 on Windows, macOS and Linux with glibc. momp reuses the official client if it is already installed. For a custom installation, administrators can set the absolute path in `MOMP_ANTIGRAVITY_CLI`. Usage reports require client version 1.5.0 or newer.

This mode runs independently of ChatGPT. The Google Gemini API is another independent connection. Configure a Google AI Studio key from **Connections → Gemini API**, then use a Gemini model in the main OMP chat. OMP currently retains credentials for its paused legacy Antigravity integration.

## Hybrid and limits

Open **AI tasks** to choose GPT, Gemini, or both. After Google sign-in, choose **Google Antigravity CLI** for the Gemini role and select a model from the list in the same window. The workflow and review permissions are described in [Hybrid AI](HYBRID_MODE.md).

**Usage limits** refreshes account reports while open. The app shows provider-reported reset times, marks unavailable values and retains the latest successful report when a refresh fails. For Antigravity the app uses the CLI's read-only `/usage` output. It shows a countdown when the output contains a timestamp with a timezone. If quota runs out, save or pause the work and continue after recovery or explicitly choose an available model.
