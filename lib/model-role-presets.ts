export const MODEL_ROLE_PRESETS = ["balanced", "quality", "fast"] as const;
export type ModelRolePreset = typeof MODEL_ROLE_PRESETS[number];

export function createModelRolePreset(preset: string, gpt: string, gemini: string): Record<string, string> {
  if (!MODEL_ROLE_PRESETS.includes(preset as ModelRolePreset)) throw new Error("Unknown model-role preset");
  if (!/^(openai-codex|openai|github-copilot)\/(?:[^/]*gpt|[^/]*codex)/i.test(gpt)) {
    throw new Error("Select a GPT model");
  }
  if (!/^(google-antigravity|google|google-gemini-cli|github-copilot)\/[^/]*gemini/i.test(gemini)) {
    throw new Error("Select a Gemini model");
  }
  const roles = { default: gpt, plan: gpt, slow: gpt, smol: gemini, task: gemini, vision: gemini, commit: gemini, advisor: gemini, tiny: gemini, memory: gemini, widget: gemini };
  if (preset === "quality") return { ...roles, task: gpt, commit: gpt, memory: gpt };
  if (preset === "fast") return { ...roles, default: gemini, plan: gemini, advisor: gpt };
  return roles;
}
