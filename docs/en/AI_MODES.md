# AI connections and modes

[Русский](../ru/AI_MODES.md) · [AI tasks and Hybrid](HYBRID_MODE.md) · [Live verification](LIVE_VERIFICATION.md)

- **ChatGPT.** Open **Connections → ChatGPT** and follow the OMP Codex sign-in flow. Select a model and reasoning level in the composer. A platform API key uses the separate OpenAI API provider and its own billing.
- **Gemini API.** Open **Connections → Gemini API** and configure a Google AI Studio key. Select a Gemini model in the composer. This connection provides the usual OMP chat, tools, files and session features with its own usage and billing.
- **Google Antigravity.** Set up and sign in through the [official CLI](https://antigravity.google/docs/cli/install). Set `MOMP_ANTIGRAVITY_CLI` to the absolute path to the trusted `agy` executable before starting momp. Choose **Google Antigravity CLI** in **AI tasks** and select or enter a Gemini slug from `agy models`. The adapter runs the CLI in plan mode from a temporary directory and returns proposals and reviews. OMP 18.18.5 pauses its legacy Antigravity OAuth path and retains its stored credentials.

Either GPT or Gemini can be selected independently. Hybrid uses two explicitly chosen providers. The model roles under Settings are for OMP chat and differ from the lead and review steps in AI tasks.

**Usage limits** shows SDK reports, known reset times and missing values. It refreshes while open. For configured Antigravity CLI 1.5.0 or newer, it also shows the official CLI's read-only `/usage` report when the CLI returns it. When a task hits a quota, retry after recovery or explicitly prepare a separate task with the other model. If the lead has completed, you can finish without the remaining reviews.
