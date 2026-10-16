import { test } from "node:test";
import assert from "node:assert/strict";
import { createModelRolePreset } from "./model-role-presets.ts";

const gpt = "openai-codex/gpt-test";
const gemini = "google-antigravity/gemini-test";

test("presets route work across explicit GPT and Gemini selections", () => {
  assert.equal(createModelRolePreset("balanced", gpt, gemini).default, gpt);
  assert.equal(createModelRolePreset("balanced", gpt, gemini).task, gemini);
  assert.equal(createModelRolePreset("quality", gpt, gemini).task, gpt);
  assert.equal(createModelRolePreset("fast", gpt, gemini).default, gemini);
  assert.equal(createModelRolePreset("fast", gpt, gemini).advisor, gpt);
  assert.equal(createModelRolePreset("quality", gpt, gemini).vision, gemini);
});

test("presets reject unknown recipes and mismatched families", () => {
  assert.throws(() => createModelRolePreset("unknown", gpt, gemini));
  assert.throws(() => createModelRolePreset("balanced", gemini, gpt));
  assert.throws(() => createModelRolePreset("fast", gpt, "google-antigravity/claude-test"));
});
