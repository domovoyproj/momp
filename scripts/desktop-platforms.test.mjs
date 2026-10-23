import assert from "node:assert/strict";
import test from "node:test";
import { desktopPlatformPlan } from "./desktop-platforms.mjs";

test("Intel Mac payloads select Intel native dependencies and Bun", () => {
  const plan = desktopPlatformPlan("darwin", "x64");
  assert.deepEqual(plan.triples, ["darwin-x64"]);
  assert.ok(plan.nativeVariants.some(([name]) => name === "@oh-my-pi/pi-natives-darwin-x64"));
  assert.ok(!plan.nativeVariants.some(([name]) => name.includes("arm64")));
});

test("Apple Silicon, universal, and Windows payloads match their runtimes", () => {
  assert.deepEqual(desktopPlatformPlan("darwin", "arm64").triples, ["darwin-aarch64"]);
  const universal = desktopPlatformPlan("darwin", "x64", true);
  assert.deepEqual(universal.triples, ["darwin-aarch64", "darwin-x64"]);
  assert.equal(universal.nativeVariants.length, 5);
  assert.deepEqual(desktopPlatformPlan("win32", "x64").triples, ["windows-x64"]);
  assert.throws(() => desktopPlatformPlan("linux", "x64"), /Unsupported/);
  assert.throws(() => desktopPlatformPlan("win32", "arm64"), /Unsupported/);
});
