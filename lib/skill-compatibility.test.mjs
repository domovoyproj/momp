import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { getCompatibleSkillRoots, readSkillInvocationPolicy } from "./skill-compatibility.ts";
import { loadCompatibleSkills, bindCompatibleSkillRefresh } from "./compatible-skills.ts";
import { Settings } from "@oh-my-pi/pi-coding-agent";

function fixture(context) {
  const root = mkdtempSync(path.join(tmpdir(), "momp-skills-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function settings(enabled = true) {
  return Settings.isolated({ "skills.enabled": enabled, "skills.enablePiUser": false, "skills.enablePiProject": false,
    "skills.enableAgentsUser": false, "skills.enableAgentsProject": false, "skills.enableClaudeUser": false,
    "skills.enableClaudeProject": false, "skills.enableCodexUser": false });
}

test("discovers shared, Codex-home and Antigravity skill directories without inventing missing roots", (context) => {
  const home = fixture(context);
  const cwd = path.join(home, "project");
  const codexHome = path.join(home, "custom-codex");
  const expected = [path.join(home, ".agents", "skills"), path.join(codexHome, "skills"),
    path.join(home, ".gemini", "antigravity", "skills"), path.join(cwd, ".agent", "skills")];
  for (const directory of expected) mkdirSync(directory, { recursive: true });
  assert.deepEqual(getCompatibleSkillRoots(cwd, home, codexHome), expected);
});

test("respects Codex explicit-only policy and fails closed on invalid YAML", (context) => {
  const root = fixture(context);
  mkdirSync(path.join(root, "agents"));
  const policy = path.join(root, "agents", "openai.yaml");
  assert.deepEqual(readSkillInvocationPolicy(root), { hidden: false });
  writeFileSync(policy, "policy:\n  allow_implicit_invocation: false\n");
  assert.equal(readSkillInvocationPolicy(root).hidden, true);
  writeFileSync(policy, "policy: [broken");
  assert.equal(readSkillInvocationPolicy(root).hidden, true);
  assert.match(readSkillInvocationPolicy(root).warning, /Invalid/);
});

test("SDK loads compatible skills, keeps scripts relative and honors invocation policy", async (context) => {
  const root = fixture(context);
  const skillDir = path.join(root, ".agent", "skills", "shared-review");
  mkdirSync(path.join(skillDir, "agents"), { recursive: true });
  writeFileSync(path.join(skillDir, "SKILL.md"), "---\nname: shared-review\ndescription: Review changes\n---\nRead scripts/review.js.\n");
  writeFileSync(path.join(skillDir, "agents", "openai.yaml"), "policy:\n  allow_implicit_invocation: false\n");
  const roots = [path.dirname(skillDir)];
  const result = await loadCompatibleSkills(root, settings(), roots);
  const skill = result.skills.find((entry) => entry.name === "shared-review");
  assert.ok(skill);
  assert.equal(skill.baseDir, skillDir);
  assert.equal(skill.hide, true);
  assert.deepEqual((await loadCompatibleSkills(root, settings(false), roots)).skills, []);
});

test("refresh replaces stale compatible skills and rebuilds the session prompt", async (context) => {
  const root = fixture(context);
  const skills = [{ name: "stale" }];
  let rebuilds = 0;
  const session = { settings: settings(false), sessionManager: { getCwd: () => root },
    refreshSkills: async () => { rebuilds++; } };
  bindCompatibleSkillRefresh(session, skills);
  await session.refreshSkills();
  assert.deepEqual(skills, []);
  assert.equal(rebuilds, 1);
});
