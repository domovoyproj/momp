import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { buildAntigravityFixture } from "../scripts/fixtures/build-antigravity.mjs";
import { signInToAntigravity } from "./antigravity-acp.ts";
import { AntigravitySessions } from "./antigravity-sessions.ts";

test("Antigravity ACP reconnects and streams, scopes permissions, and reports provider limits", { timeout: 75_000 }, async (t) => {
  const directory = mkdtempSync(join(tmpdir(), "momp-acp-test-"));
  const cwd = join(directory, "project");
  const state = join(directory, "threads");
  mkdirSync(cwd);
  writeFileSync(join(cwd, "greeting.txt"), "Hello\n");
  const original = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "SYNTHETIC-DO-NOT-INHERIT";
  const store = new AntigravitySessions(state);
  let id;
  t.after(async () => {
    if (original === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = original;
    if (id && store.get(cwd, id)?.status !== "offline") store.active(cwd, id).disconnect();
    await Bun.sleep(250);
    rmSync(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });
  const executable = buildAntigravityFixture(directory);
  const until = async (predicate) => {
    for (let attempt = 0; attempt < 220; attempt++) {
      const thread = store.get(cwd, id);
      if (thread && predicate(thread)) return thread;
      await Bun.sleep(25);
    }
    assert.fail(`Unexpected Antigravity state ${JSON.stringify(store.get(cwd, id))}`);
  };

  id = store.open(cwd, executable).id;
  await until((thread) => thread.status === "offline" && thread.error === "auth-required");
  assert.equal(store.get(`${cwd}-other`, id), undefined);
  await signInToAntigravity(executable);
  store.open(cwd, executable, id);
  const ready = await until((thread) => thread.status === "ready");
  assert.deepEqual(ready.options.map(({ id }) => id), ["model", "effort"]);
  assert.equal(ready.options[0].choices.length, 2);
  const worker = store.active(cwd, id);
  await assert.rejects(worker.setOption("mode", "skip"), { kind: "unsupported" });
  await worker.setOption("model", "gemini-fixture-flash");
  await worker.setOption("effort", "high");
  assert.deepEqual(store.get(cwd, id).options.map(({ value }) => value), ["gemini-fixture-flash", "high"]);

  worker.send("Please review edit before changing the greeting");
  const streaming = await until((thread) => thread.status === "running" && thread.messages.some((message) => message.role === "assistant"));
  assert.equal(streaming.messages.at(-1).text, "I found the workspace greeting.");
  const needsApproval = await until((thread) => thread.permissions.length === 1);
  assert.equal(needsApproval.permissions[0].title, "Edit greeting.txt");
  assert.throws(() => worker.decide("always", true), { kind: "unavailable" });
  worker.decide(needsApproval.permissions[0].id, false);
  await until((thread) => thread.status === "ready");
  assert.equal(readFileSync(join(cwd, "greeting.txt"), "utf8"), "Hello\n");

  worker.send("Please review edit before changing the greeting, then proceed");
  const approved = await until((thread) => thread.permissions.length === 1);
  worker.decide(approved.permissions[0].id, true);
  const edited = await until((thread) => thread.status === "ready");
  assert.equal(edited.tools[0].changes[0].after, "Hello from Gemini\n");
  assert.equal(readFileSync(join(cwd, "greeting.txt"), "utf8"), "Hello from Gemini\n");
  assert.equal(edited.messages.filter(({ role }) => role === "assistant").length, 2);
  assert.deepEqual(edited.context, { used: 1420, size: 32000 });

  worker.send("wait for cancellation");
  await until((thread) => thread.permissions.length === 1);
  worker.cancel();
  const stopped = await until((thread) => thread.status === "ready" && thread.error === "cancelled");
  assert.deepEqual(stopped.permissions, []);

  worker.send("quota exhaustion");
  const limited = await until((thread) => thread.status === "ready" && thread.error === "quota");
  assert.ok(!JSON.stringify(limited).includes("PRIVATE-ERROR-DATA"));
  worker.send("simulate disconnect");
  const interrupted = await until((thread) => thread.status === "offline");
  assert.equal(interrupted.error, "interrupted");
  assert.ok(interrupted.messages.some((message) => message.text === "Saved before disconnect."));

  const reopened = new AntigravitySessions(state);
  reopened.open(cwd, executable, id);
  const resumed = await until((thread) => thread.status === "ready");
  assert.deepEqual(resumed.messages, interrupted.messages);
  assert.equal(reopened.history(cwd).length, 1);
  assert.equal(reopened.get(cwd, id).remoteId, undefined);
  reopened.active(cwd, id).disconnect();
});
