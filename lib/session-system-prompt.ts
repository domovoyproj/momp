import { findConfigFile } from "@oh-my-pi/pi-coding-agent/config";
import { resolvePromptInput } from "@oh-my-pi/pi-coding-agent/system-prompt";

/**
 * `SYSTEM.md` / `APPEND_SYSTEM.md` resolution for momp sessions.
 *
 * The `omp` CLI resolves both files before it creates a session — project-local
 * first (`.omp/`, `.claude/`, `.codex/`, `.gemini/`), then user-level
 * (`~/.omp/agent/`, …) — and hands the text to `createAgentSession` as
 * `customSystemPrompt` / `appendSystemPrompt`. momp builds its own session
 * options in `lib/rpc-manager.ts`, so a browser session used to silently drop
 * every prompt file the same user gets in the terminal (issue #28).
 *
 * The lookup itself is omp's own `findConfigFile`, not a re-implementation, so
 * the config roots and their precedence cannot drift from the CLI's. Two things
 * differ, both forced by serving many projects from one process:
 *
 * - The CLI resolves against `getProjectDir()`, i.e. the directory `omp` was
 *   started in. Here every lookup is bound to the session's own cwd.
 * - Project-local prompt files come from whatever repository the browser
 *   opened, so `lib/project-trust.ts` is in scope. They load for untrusted
 *   projects too, deliberately: they are data folded into the system prompt —
 *   the same category as skills, rules and `AGENTS.md`, which the trust gate
 *   leaves alone — and the gate exists for code omp *imports and executes*.
 *   They are a prompt-injection surface exactly as they are in the CLI; see
 *   `docs/project-trust.md`.
 */

export interface ResolvedSessionSystemPrompts {
  /** `SYSTEM.md` text, rendered through omp's custom system prompt template. */
  systemPrompt: string | undefined;
  /** `APPEND_SYSTEM.md` text, appended to the rendered system prompt. */
  appendPrompt: string | undefined;
}

/**
 * First match for `fileName`, project-level before user-level.
 *
 * `findConfigFile` orders user directories ahead of project ones, so the CLI
 * asks twice to invert that; mirror it rather than reordering the result.
 */
function discoverPromptFile(fileName: string, cwd: string): string | undefined {
  return findConfigFile(fileName, { user: false, cwd }) ?? findConfigFile(fileName, { user: true, cwd });
}

/**
 * Resolve the prompt files a session started in `cwd` should carry.
 *
 * Both fields are `undefined` when no file exists, which keeps the session on
 * omp's default prompt.
 */
export async function resolveSessionSystemPrompts(cwd: string): Promise<ResolvedSessionSystemPrompts> {
  const [systemPrompt, appendPrompt] = await Promise.all([
    resolvePromptInput(discoverPromptFile("SYSTEM.md", cwd), "system prompt"),
    resolvePromptInput(discoverPromptFile("APPEND_SYSTEM.md", cwd), "append system prompt"),
  ]);
  return { systemPrompt, appendPrompt };
}
