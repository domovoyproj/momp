const ANTIGRAVITY_HINT = /(?:google[- ]antigravity|cloud code assist|gemini)/i;
const QUOTA_HINT = /(?:resource_exhausted|quota|rate.?limit|(?:^|\D)429(?:\D|$))/i;
const AUTH_HINT = /(?:unauthorized|forbidden|invalid[_ -]?grant|token.+expired|(?:^|\D)(?:401|403)(?:\D|$))/i;

export function formatProviderError(message: string): string {
  const trimmed = message.trim();
  if (!trimmed) return "Неизвестная ошибка провайдера";

  if (ANTIGRAVITY_HINT.test(trimmed) && QUOTA_HINT.test(trimmed)) {
    return "Google Antigravity: лимит запросов исчерпан (429). Откройте «Лимиты», дождитесь сброса или временно выберите другую модель.";
  }

  if (ANTIGRAVITY_HINT.test(trimmed) && AUTH_HINT.test(trimmed)) {
    return "Google Antigravity: авторизация устарела или была отозвана. Переподключите аккаунт в «Модели → Google Antigravity».";
  }

  return trimmed;
}
