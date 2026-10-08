import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { formatProviderError } = await jiti.import("./provider-errors.ts");

test("turns Antigravity quota responses into an actionable message", () => {
  assert.equal(
    formatProviderError('Cloud Code Assist API error (429): {"status":"RESOURCE_EXHAUSTED"}'),
    "Google Antigravity: лимит запросов исчерпан (429). Откройте «Лимиты», дождитесь сброса или временно выберите другую модель.",
  );
});

test("explains expired Antigravity authentication", () => {
  assert.match(
    formatProviderError("google-antigravity request failed: 401 unauthorized"),
    /Переподключите аккаунт/,
  );
});

test("keeps unrelated provider errors intact", () => {
  assert.equal(formatProviderError("OpenAI API error (500)"), "OpenAI API error (500)");
});
