import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("./useAgentSession.ts", import.meta.url), "utf8").replaceAll("\r\n", "\n");

function evaluate(start, end, bindings, result = "undefined") {
  const block = source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
  const compiled = ts.transpileModule(`${block}\nreturn ${result};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
  }).outputText;
  return new Function(...Object.keys(bindings), compiled)(...Object.values(bindings));
}

function loadHarness({ missing = false, includeState = false } = {}) {
  const levels = [];
  const bindings = {
    useCallback: (callback) => callback,
    clientSessionCache: new Map(),
    inFlightSessionLoads: new Map(),
    sessionIdRef: { current: "session-a" },
    modelSwitchPendingRef: { current: false },
    fetch: async (url) => ({
      ok: !missing,
      status: missing ? 404 : 200,
      json: async () => url.endsWith("/state")
        ? { running: true, state: { thinkingLevel: "high" } }
        : { leafId: "leaf-a", context: { messages: [], entryIds: [], thinkingLevel: "off" } },
    }),
    setThinkingLevel: (level) => levels.push(level),
    setCachedClientSession() {}, setData() {}, setActiveLeafId() {}, setMessages() {},
    setEntryIds() {}, setContextUsage() {}, setCurrentModelOverride() {}, setError() {},
    setLoading() {}, setSystemPrompt() {}, setExtensionStatuses() {}, setExtensionWidgets() {},
    setQueuedMessages() {}, setSubagents() {},
  };
  const loadSession = evaluate("  const loadSession = useCallback", "  const loadContext", bindings, "loadSession");
  return { levels, run: () => loadSession("session-a", false, includeState) };
}

test("successful transcript-only reload remains truthy for slash-command session promotion", async () => {
  const { run, levels } = loadHarness();
  const result = await run();
  assert.equal(result?.loaded, true);
  assert.deepEqual(levels, ["off"]);
});

test("missing transcript cannot promote a provisional session", async () => {
  assert.equal(await loadHarness({ missing: true }).run(), null);
});

test("state reload retains running metadata alongside the successful transcript result", async () => {
  const { run, levels } = loadHarness({ includeState: true });
  assert.deepEqual(await run(), { loaded: true, running: true, state: { thinkingLevel: "high" } });
  assert.deepEqual(levels, ["off", "high"]);
});

test("late mount-time session load cannot reopen events after unmount", async () => {
  let finishLoad;
  let cleanup;
  let connected = 0;
  const load = new Promise((resolve) => { finishLoad = resolve; });
  evaluate("  // Load session on mount", "  useEffect(() => {\n    onSystemPromptChange", {
    useEffect: (effect) => { cleanup = effect(); },
    session: { id: "session-a" }, sessionIdRef: { current: null },
    loadSession: () => load,
    loadTools() {}, sdkAgentActiveRef: {}, rpcPromptPendingRef: {}, agentRunningRef: {},
    setAgentRunning() {}, setAgentPhase() {}, dispatch() {},
    connectEvents: () => { connected += 1; }, waitForPromptSettlement() {},
    bashRunningRef: {}, setBashRunning() {}, waitForBashSettlement() {},
    setIsCompacting() {}, setContextUsage() {}, setSystemPrompt() {}, setThinkingLevel() {},
    setExtensionStatuses() {}, setExtensionWidgets() {}, setQueuedMessages() {},
    setSubagents() {}, setGoalStatus() {}, bashRecoveryIdRef: { current: 0 },
    cancelEventStreamGrace() {}, closeEvents() {},
  });
  cleanup();
  finishLoad({ running: true, state: { isStreaming: true } });
  await Promise.resolve();
  assert.equal(connected, 0);
});

test("deferred role selection sends its identity rather than overwriting the default model", async () => {
  const roleRef = { current: null };
  const modelRef = { current: null };
  const thinkingRef = { current: null };
  const sessionRef = { current: null };
  const ensuringRef = { current: null };
  let request;
  const bindings = {
    useCallback: (callback) => callback,
    isNew: true,
    newSessionCwd: "/project",
    newSessionRoleOverrideRef: roleRef,
    newSessionModelOverrideRef: modelRef,
    thinkingLevelOverrideRef: thinkingRef,
    sessionIdRef: sessionRef,
    ensuringNewSessionRef: ensuringRef,
    modelRoles: [{ role: "smol", resolved: { provider: "google-antigravity", modelId: "gemini-3-pro", thinkingLevel: "low" } }],
    setThinkingLevel() {}, setNewSessionModel() {}, setPendingModel() {},
    setCurrentModelOverride() {}, setNewSessionDefaultModel() {},
    loadSession() {}, addNotice() {},
    toolPreset: "full", getToolNamesForPreset: () => [],
    fetch: async (_url, options) => {
      request = JSON.parse(options.body);
      return { ok: true, json: async () => ({ sessionId: "created", model: modelRef.current, thinkingLevel: "low" }) };
    },
    sendAgentCommand: () => assert.fail("Uncreated session cannot receive commands"),
  };
  const selectRole = evaluate("  const handleRoleModelChange = useCallback", "  const handleCompact", bindings, "handleRoleModelChange");
  await selectRole("smol");
  const ensure = evaluate("  const ensureNewSession = useCallback", "  const loadSlashCommands", bindings, "ensureNewSession");
  assert.equal(await ensure(), "created");
  assert.equal(request.role, "smol");
  assert.equal(request.provider, undefined);
  assert.equal(request.modelId, undefined);
  assert.equal(request.thinkingLevel, "low");
});
