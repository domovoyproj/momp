import assert from "node:assert/strict";
import test from "node:test";
import { configureLoopbackProxyBypass } from "./loopback-proxy.ts";

test("loopback bypass preserves both existing NO_PROXY lists and is idempotent", () => {
  const env = { NO_PROXY: "private.example, localhost", no_proxy: "internal.example" };
  configureLoopbackProxyBypass(env);
  const once = { ...env };
  configureLoopbackProxyBypass(env);
  assert.deepEqual(env, once);
  assert.equal(env.NO_PROXY, env.no_proxy);
  for (const host of ["private.example", "internal.example", "localhost", "127.0.0.1", "::1"]) {
    assert.ok(env.NO_PROXY.split(",").includes(host));
  }
});
