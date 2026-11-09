export const FEATURED_PROVIDERS = [
  { id: "openai-codex", name: "ChatGPT", descriptionKey: "connections.chatgpt", auth: "oauth" },
  { id: "google", name: "Gemini API", descriptionKey: "connections.geminiApi", auth: "apikey" },
  { id: "google-antigravity", name: "Antigravity", descriptionKey: "connections.antigravity", auth: "oauth" },
  { id: "github-copilot", name: "GitHub Copilot", descriptionKey: "connections.github", auth: "oauth" },
] as const;

export function sortFeaturedProviders<Provider extends { id: string }>(providers: readonly Provider[]): Provider[] {
  const priority = new Map<string, number>(FEATURED_PROVIDERS.map((provider, index) => [provider.id, index]));
  return [...providers].sort((left, right) =>
    (priority.get(left.id) ?? 99) - (priority.get(right.id) ?? 99) || left.id.localeCompare(right.id));
}
