import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { PRESET_DEFAULT, PRESET_FULL, getPresetFromTools, getToolNamesForPreset } = await createJiti(import.meta.url)
  .import("./tool-presets.ts");

function entries(names, extra = []) {
  return [...names, ...extra].map((name) => ({ name, description: name, active: true }));
}

test("tool presets use the SDK's canonical coding tool names", () => {
  assert.deepEqual(PRESET_DEFAULT, ["read", "bash", "edit", "write"]);
  assert.deepEqual(PRESET_FULL, ["read", "bash", "edit", "write", "grep", "glob"]);
  assert.deepEqual(getToolNamesForPreset("full"), [...PRESET_FULL]);
});

test("tool preset inference keeps extension tools separate from the full core set", () => {
  assert.equal(getPresetFromTools(entries(PRESET_DEFAULT, ["my_extension_tool"])), "default");
  assert.equal(getPresetFromTools(entries(PRESET_FULL, ["my_extension_tool"])), "full");
  assert.equal(getPresetFromTools(entries([], ["my_extension_tool"])), "default");
  assert.equal(getPresetFromTools([]), "none");
});
