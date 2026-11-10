# GitHub, ChatGPT and Gemini

Open **Connections** for ChatGPT through Codex OAuth or for GitHub Copilot. Open **Antigravity chat** for Google sign-in through the official CLI. OpenAI API and Gemini API have their own connections. Models and quotas depend on the connected account. [Provider setup](en/AI_MODES.md)

Откройте **Подключения** для входа в ChatGPT через Codex OAuth или для GitHub Copilot. Для входа через Google откройте **Чат Antigravity** и используйте официальный CLI. OpenAI API и Gemini API подключаются отдельно. Модели и квоты зависят от подключённого аккаунта. [Настройка провайдеров](ru/AI_MODES.md)

Under model roles, choose a GPT model and a Gemini model from the current available-model list. The presets affect all 11 chat roles: `default`, `plan`, `slow`, `smol`, `task`, `vision`, `commit`, `advisor`, `tiny`, `memory`, and `widget`. The SDK's separate kind roles (`image`, `web`, `speech`, `dictation`, `judge`) are not changed by these chat presets. Global assignments are written to OMP's global configuration; project overrides still win. Applying in project scope changes that project's configuration. Existing sessions may retain an explicitly selected model; start a new chat to use the new defaults. For the fast recipe, select a fast Gemini variant; the recipe itself does not change model capabilities, prices, or quotas.

GitHub shortcuts read `git remote get-url origin` and the current branch locally. They accept only public github.com host URLs and never render embedded URL credentials. GitHub repository access and Copilot model authentication are independent. No token is required merely to show the repository shortcut; private repository pages use your browser's normal GitHub login.

## Skills

momp discovers existing user directories `~/.agents/skills`, `$CODEX_HOME/skills` (default `~/.codex/skills`), `~/.gemini/skills`, and `~/.gemini/antigravity/skills`. Project directories `.agents/skills`, `.agent/skills`, `.codex/skills` and `.gemini/skills` are also discovered. OMP's own configured sources remain available. The master skills switch and ignore filters still apply.

Use a directory containing `SKILL.md` with YAML `name` and `description`, and keep referenced scripts/resources beside it. The same loaded skills feed the UI and session prompt. Reload skills after changing files. `agents/openai.yaml` with `policy.allow_implicit_invocation: false` hides a skill from automatic model discovery; invoke it explicitly instead. Invalid policy YAML is treated conservatively and reported as a warning. UI branding metadata and connector declarations are not automatically executable tools.

Skills are instructions, not a security sandbox. Review downloaded code before running it. Tool names, hosted ChatGPT apps, MCP servers, shell tools and runtime dependencies are not portable merely because their instructions are. Project trust gates executable project extensions and MCP resources; it does not make arbitrary instructions trustworthy.

[Codex skills](https://developers.openai.com/codex/skills/) · [skills CLI](https://github.com/vercel-labs/skills) · [OMP 18.18.5](https://github.com/can1357/oh-my-pi/releases/tag/v18.18.5)
