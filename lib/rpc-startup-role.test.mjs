import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import ts from "typescript";
import { Settings } from "@oh-my-pi/pi-coding-agent";
import { resolveRoleModelFull } from "@oh-my-pi/pi-coding-agent/session/role-models";
import { selectInitialModelScope } from "./model-scope.ts";
import { persistExplicitStartupPreferences } from "./startup-preferences.ts";

const source = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const startupSource = source.slice(source.indexOf("export async function startRpcSession")).replace("export async", "async");
const startupCode = ts.transpileModule(`${startupSource}\nreturn startRpcSession;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;

async function startupHarness(context, thinkingPin = "low") {
  const model = { provider: "google-antigravity", id: "gemini-test", name: "Gemini", reasoning: true };
  const defaultModel = { provider: "openai-codex", id: "gpt-test", name: "GPT", reasoning: true };
  const roles = { default: "openai-codex/gpt-test", smol: `google-antigravity/gemini-test:${thinkingPin}` };
  const fixture = await mkdtemp(join(tmpdir(), "momp-startup-role-"));
  context.after(() => rm(fixture, { recursive: true, force: true }));
  const settings = await Settings.loadIsolated({ cwd: fixture, agentDir: fixture, inMemory: true });
  settings.setModelRole("default", roles.default);
  settings.setModelRole("smol", roles.smol);
  settings.setModelRole = () => assert.fail("Role selection must not modify global roles");
  const applied = [];
  const captures = [];
  const inner = {
    sessionId: "created-session", model, thinkingLevel: "off",
    applyRoleModel: async (entry) => { applied.push(entry); inner.thinkingLevel = entry.thinkingLevel ?? "off"; },
    setThinkingLevel: (level) => { inner.thinkingLevel = level; },
    dispose: async () => {},
  };
  const bindings = {
    getRegistry: () => new Map(), getLocks: () => new Map(),
    initTheme: async () => {}, getAgentDir: () => "/agent",
    SessionManager: { create: () => ({ getCwd: () => "/project", buildSessionContext: () => ({ messages: [] }) }) },
    trackStartingSession: () => () => {},
    getOmpRuntime: async () => ({ settings, modelRegistry: { getAvailable: () => [defaultModel, model] } }),
    getSettingsForCwd: async () => settings,
    process: { platform: "linux" },
    cfgBrowserEnabled: { get: () => false }, cfgEnabledModels: { get: () => [] },
    discoverSessionExtensionPaths: async () => [], discoverCustomToolPaths: async () => [],
    untrustedProjectSessionOptions: () => undefined,
    resolveSessionSystemPrompts: async () => ({}),
    resolveVisibleModels: async () => ({ visible: [defaultModel, model], scopedModels: [] }),
    readDefaultModelRole: () => ({ provider: defaultModel.provider, modelId: defaultModel.id }),
    resolveRoleModelFull, selectInitialModelScope,
    loadCompatibleSkills: async () => ({ skills: [] }), applyResolvedSystemPromptInputs() {},
    createAgentSession: async (options) => { captures.push(options); inner.model = options.model; return { session: inner }; },
    bindCompatibleSkillRefresh() {}, persistExplicitStartupPreferences, invalidateModelsCache() {},
    AgentSessionWrapper: class {
      bindToolUiContext() {} start() {} onDestroy() {} beginExtensionBinding() {}
    },
  };
  const start = new Function(...Object.keys(bindings), startupCode)(...Object.values(bindings));
  return { start, captures, applied, inner, roles };
}

for (const pin of ["low", "off", "auto"]) {
  test(`role startup uses Gemini with ${pin}, retains smol identity and leaves GPT default unchanged`, async (context) => {
    const harness = await startupHarness(context, pin);
    await harness.start("temporary", "", "/project", { initialRole: "smol" });
    assert.equal(harness.captures[0].model.provider, "google-antigravity");
    assert.equal(harness.applied[0].role, "smol");
    assert.equal(harness.applied[0].thinkingLevel, pin);
    assert.equal(harness.inner.thinkingLevel, pin);
    assert.equal(harness.roles.default, "openai-codex/gpt-test");
  });
}

test("manual thinking overrides a startup role pin without persisting a global default", async (context) => {
  const harness = await startupHarness(context);
  await harness.start("temporary", "", "/project", { initialRole: "smol", thinkingLevel: "high" });
  assert.equal(harness.captures[0].thinkingLevel, "high");
  assert.equal(harness.inner.thinkingLevel, "high");
});

test("unresolvable startup role fails before constructing a session", async (context) => {
  const harness = await startupHarness(context);
  await assert.rejects(harness.start("temporary", "", "/project", { initialRole: "missing" }), /No model configured/);
  assert.equal(harness.captures.length, 0);
});
