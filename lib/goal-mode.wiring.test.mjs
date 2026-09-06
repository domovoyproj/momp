import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const rpc = readFileSync(new URL("./rpc-manager.ts", import.meta.url), "utf8");
const hook = readFileSync(new URL("../hooks/useAgentSession.ts", import.meta.url), "utf8");
const chatWindow = readFileSync(new URL("../components/ChatWindow.tsx", import.meta.url), "utf8");

test("advertises /goal in the browser command palette", () => {
  // omp registers /goal with a TUI-only handler, so SDK discovery never
  // returns it and the browser forwarded `/goal ...` to the model as text.
  assert.match(rpc, /const BROWSER_NATIVE_SLASH_COMMANDS = \["fork", "goal"\] as const/);
});

test("drives goal mode server-side for the whole session", () => {
  assert.match(rpc, /case "goal": \{\s*return await this\.goalMode\.handleCommand\(/);
  // Restored on attach and fed every session event, so a goal survives a
  // reload and the continuation loop runs with no tab open.
  assert.match(rpc, /void this\.goalMode\.restore\(\)/);
  assert.match(rpc, /void this\.goalMode\.handleSessionEvent\(event\)/);
  assert.match(rpc, /this\.goalModeController\?\.dispose\(\)/);
  assert.match(rpc, /goal: this\.goalMode\.getStatus\(\)/);
});

test("keeps operator turns and aborts in charge of the loop", () => {
  assert.match(rpc, /case "prompt": \{[\s\S]*?this\.goalMode\.onUserPrompt\(\)/);
  assert.match(rpc, /case "abort":\s*this\.goalMode\.onAbort\(\)/);
  assert.match(rpc, /this\.goalMode\.reconcileToolNames\(withExtensionTools\(this\.inner, toolNames\)\)/);
});

test("sends a continuation as a hidden turn that still reads as busy", () => {
  const runner = rpc.slice(
    rpc.indexOf("private async runGoalContinuation"),
    rpc.indexOf("private syncPlanModeFromSession"),
  );
  assert.match(runner, /customType: "goal-continuation"/);
  assert.match(runner, /display: false/);
  assert.match(runner, /this\.promptRunning = true/);
  assert.match(runner, /this\.emit\(\{ type: "prompt_done" \}\)/);
});

test("routes /goal from the composer and tracks its state", () => {
  assert.match(hook, /case "goal": \{[\s\S]*?sendAgentCommand<GoalCommandResponse>\(sid, \{ type: "goal", args \}\)/);
  assert.match(hook, /case "goal_status":\s*setGoalStatus\(/);
  assert.match(hook, /if \(state\.goal !== undefined\) setGoalStatus\(state\.goal \?\? null\)/);
  assert.match(hook, /goalStatus,/);
  assert.match(chatWindow, /<GoalBar goal=\{goalStatus\} t=\{t\} \/>/);
});
