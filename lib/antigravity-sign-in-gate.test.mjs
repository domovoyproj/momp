import assert from "node:assert/strict";
import test from "node:test";
import { AntigravitySignInGate } from "./antigravity-sign-in-gate.ts";

const deferred = () => Promise.withResolvers();

test("sign-in rejects another active window without starting or cancelling either request", async () => {
  const gate = new AntigravitySignInGate();
  const running = deferred();
  const first = new AbortController();
  const original = gate.run(first.signal, () => running.promise);
  let called = false;
  assert.equal(await gate.run(new AbortController().signal, async () => { called = true; }), false);
  assert.equal(called, false);
  assert.equal(first.signal.aborted, false);
  running.resolve();
  assert.equal(await original, true);
  assert.equal(await gate.run(new AbortController().signal, async () => {}), true);
});

test("cancel and immediate retry waits for process cleanup and admits only one competing retry", async () => {
  const gate = new AntigravitySignInGate();
  const cleanup = deferred();
  const retryDone = deferred();
  const first = new AbortController();
  const events = [];
  const original = gate.run(first.signal, async signal => {
    events.push("original");
    await cleanup.promise;
    signal.throwIfAborted();
  });
  const cancelled = assert.rejects(original, { name: "AbortError" });
  await Promise.resolve();
  first.abort();
  const start = async () => { events.push("retry"); await retryDone.promise; };
  const retries = [gate.run(new AbortController().signal, start), gate.run(new AbortController().signal, start)];
  await Promise.resolve();
  assert.deepEqual(events, ["original"]);
  cleanup.resolve();
  await cancelled;
  await Promise.resolve();
  assert.deepEqual(events, ["original", "retry"]);
  retryDone.resolve();
  assert.deepEqual((await Promise.all(retries)).sort(), [false, true]);
});

test("a retry cancelled while waiting never launches and does not disturb old cleanup", async () => {
  const gate = new AntigravitySignInGate();
  const cleanup = deferred();
  const first = new AbortController();
  const original = gate.run(first.signal, () => cleanup.promise);
  first.abort();
  const retry = new AbortController();
  let calls = 0;
  const pending = gate.run(retry.signal, async () => { calls++; });
  retry.abort();
  await assert.rejects(pending, { name: "AbortError" });
  assert.equal(calls, 0);
  cleanup.resolve();
  await original;
  assert.equal(await gate.run(new AbortController().signal, async () => { calls++; }), true);
  assert.equal(calls, 1);
});

test("stalled cancellation cleanup is bounded and never releases an occupied lease early", async () => {
  const gate = new AntigravitySignInGate(20);
  const cleanup = deferred();
  const first = new AbortController();
  const original = gate.run(first.signal, () => cleanup.promise);
  first.abort();
  let called = false;
  assert.equal(await gate.run(new AbortController().signal, async () => { called = true; }), false);
  assert.equal(called, false);
  cleanup.resolve();
  await original;
  assert.equal(await gate.run(new AbortController().signal, async () => {}), true);
});

test("provider errors release the lease and pre-cancelled requests never start", async () => {
  const gate = new AntigravitySignInGate();
  await assert.rejects(gate.run(new AbortController().signal, async () => { throw new Error("provider failed"); }), /provider failed/);
  let called = false;
  await assert.rejects(gate.run(AbortSignal.abort(), async () => { called = true; }), { name: "AbortError" });
  assert.equal(called, false);
  assert.equal(await gate.run(new AbortController().signal, async () => {}), true);
});
