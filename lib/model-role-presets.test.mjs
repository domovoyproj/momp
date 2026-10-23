import { test } from "node:test";
import assert from "node:assert/strict";
import { createModelRolePreset } from "./model-role-presets.ts";
import { CHAT_MODEL_ROLE_IDS } from "@oh-my-pi/pi-coding-agent/config/model-roles";

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

test("every preset covers the SDK chat roles without assigning media providers", () => {
  for (const preset of ["balanced", "quality", "fast"]) {
    const roles = createModelRolePreset(preset, gpt, gemini);
    assert.deepEqual(Object.keys(roles).sort(), [...CHAT_MODEL_ROLE_IDS].sort());
    assert.equal(roles.tiny, gemini);
    assert.equal(roles.widget, gemini);
    assert.equal(roles.memory, preset === "quality" ? gpt : gemini);
  }
});
