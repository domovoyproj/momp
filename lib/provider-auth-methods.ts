import { getOAuthProviders } from "@oh-my-pi/pi-ai/oauth";
import { authPolicyFor } from "@oh-my-pi/pi-catalog/compat/auth";
import { PROVIDER_DESCRIPTORS } from "@oh-my-pi/pi-catalog/provider-models/descriptors";

const apiKeyProviders = new Set(PROVIDER_DESCRIPTORS.map((provider) => provider.providerId));

/** The SDK's login list also contains interactive API-key prompts. */
export function getOAuthLoginProviders() {
  return getOAuthProviders().filter((provider) =>
    provider.available && authPolicyFor(provider.id)?.login?.kind !== "api-key",
  );
}

export function supportsApiKeyLogin(provider: string): boolean {
  const oauthOnly = getOAuthLoginProviders().some((candidate) =>
    (candidate.storeCredentialsAs ?? candidate.id) === provider,
  );
  return apiKeyProviders.has(provider) || !oauthOnly;
}

export function apiKeyLoginError(provider: string): string {
  return provider === "openai-codex"
    ? "ChatGPT requires OAuth sign-in. Open Models → Add provider → ChatGPT Plus/Pro and sign in. For an OpenAI API key, choose the openai provider."
    : `${provider} requires OAuth sign-in; API-key login is not supported.`;
}
