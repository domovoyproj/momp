import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, {
  interopDefault: true,
  moduleCache: false,
});
const { AgentSessionWrapper } = await jiti.import("./rpc-manager.ts");

// The wrapper builds an RpcSubagentRegistry, which subscribes to the session's
// event bus; these shutdown tests only care about teardown ordering, so hand it
// a bus that records nothing.
function makeEventBus() {
  return { on: () => () => {} };
}

test("session shutdown notifies extensions before disposing the SDK session", async () => {
  const calls = [];
  const inner = {
    eventBus: { on: () => () => {} },
    isBashRunning: false,
    extensionRunner: {
      async emit(event) {
        calls.push(["emit", event]);
      },
    },
    dispose() {
      calls.push(["dispose"]);
    },
  };
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  wrapper.onDestroy(() => calls.push(["destroy"]));

  await Promise.all([wrapper.shutdown(), wrapper.shutdown()]);

  assert.deepEqual(calls, [
    ["emit", { type: "session_shutdown", reason: "quit" }],
    ["dispose"],
    ["destroy"],
  ]);
  assert.equal(wrapper.isAlive(), false);
});

test("session shutdown still disposes the SDK session when an extension fails", async () => {
  const calls = [];
  const inner = {
    eventBus: { on: () => () => {} },
    isBashRunning: false,
    extensionRunner: {
      async emit() {
        calls.push("emit");
        throw new Error("shutdown hook failed");
      },
    },
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  wrapper.onDestroy(() => calls.push("destroy"));

  await assert.rejects(wrapper.shutdown(), /shutdown hook failed/);

  assert.deepEqual(calls, ["emit", "dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});

test("direct destruction disposes the SDK session before unregistering the wrapper", () => {
  const calls = [];
  const inner = {
    eventBus: { on: () => () => {} },
    isBashRunning: false,
    extensionRunner: {},
    dispose() {
      calls.push("dispose");
    },
  };
  const wrapper = new AgentSessionWrapper(inner, makeEventBus());
  wrapper.onDestroy(() => calls.push("destroy"));

  wrapper.destroy();
  wrapper.destroy();

  assert.deepEqual(calls, ["dispose", "destroy"]);
  assert.equal(wrapper.isAlive(), false);
});

test("shutdown cancels startup dialogs before awaiting extension binding and rejects new dialogs", async () => {
  const wrapper = new AgentSessionWrapper({
    isBashRunning: false,
    dispose() {},
    extensionRunner: {
      async emit() {
        assert.equal(await wrapper.createExtensionUiContext().input("Shutdown", "Value"), undefined);
      },
    },
  }, makeEventBus());
  const startupDialog = wrapper.createExtensionUiContext().input("Startup", "Value");
  wrapper.extensionBindingPromise = startupDialog.then(() => {});
  let finished = false;
  const shutdown = wrapper.shutdown().then(() => { finished = true; });
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(finished, true);
    assert.equal(wrapper.isAlive(), false);
    assert.equal(wrapper.pendingUiResponses.size, 0);
  } finally {
    wrapper.destroy();
    await shutdown;
  }
});

test("destroy cancels pending custom factories and disposes their late components without mounting", async () => {
  const wrapper = new AgentSessionWrapper({ isBashRunning: false, dispose() {} }, makeEventBus());
  let resolveFactory;
  let factoryStarted;
  let disposed = false;
  let finished = false;
  const started = new Promise((resolve) => { factoryStarted = resolve; });
  const factoryResult = new Promise((resolve) => { resolveFactory = resolve; });
  const customResult = wrapper.createExtensionUiContext().custom(() => {
    factoryStarted();
    return factoryResult;
  }).then(() => { finished = true; });
  await started;
  wrapper.destroy();
  try {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(finished, true);
    resolveFactory({ render: () => ["late"], dispose: () => { disposed = true; } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(disposed, true);
    assert.equal(wrapper.activeCustomUis.size, 0);
    assert.equal(wrapper.pendingUiRequests.size, 0);
  } finally {
    resolveFactory({ render: () => ["late"], dispose: () => { disposed = true; } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    for (const id of wrapper.activeCustomUis.keys()) wrapper.closeCustomUi(id, undefined);
    await customResult;
  }
});
