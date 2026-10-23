import assert from "node:assert/strict";
import test from "node:test";
import { readDefaultModelRole } from "./model-roles.ts";

test("default model roles preserve colon tags and strip only thinking suffixes", () => {
  const read = (selector) => readDefaultModelRole({ getModelRole: () => selector });
  assert.deepEqual(read("ollama/llama3:8b"), { provider: "ollama", modelId: "llama3:8b" });
  assert.deepEqual(read("ollama/llama3:8b:high"), { provider: "ollama", modelId: "llama3:8b" });
  assert.deepEqual(read("openrouter/vendor/model:free"), { provider: "openrouter", modelId: "vendor/model:free" });
  assert.deepEqual(read("openai-codex/gpt-test:max"), { provider: "openai-codex", modelId: "gpt-test" });
  assert.equal(read(undefined), undefined);
  assert.equal(read("gpt-test"), undefined);
});
