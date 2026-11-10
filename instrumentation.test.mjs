import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const instrumentation = new URL("./instrumentation.ts", import.meta.url).href;
const project = new URL(".", import.meta.url);

function registerInChild(t, value, runtime = "nodejs") {
  const root = mkdtempSync(join(tmpdir(), "momp-instrumentation-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }));
  const config = join(root, "bunfig.toml");
  writeFileSync(config, "");
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|systemroot|windir|comspec|pathext|tmp|temp|tmpdir)$/i.test(key)));
  Object.assign(env, { HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root, NEXT_RUNTIME: runtime });
  if (value !== undefined) env.MOMP_XBOX_DNS = value;
  const script = `
    const input = { present: Object.hasOwn(process.env, "MOMP_XBOX_DNS"), value: process.env.MOMP_XBOX_DNS };
    const before = globalThis.fetch;
    const { register } = await import(${JSON.stringify(instrumentation)});
    await register();
    const installedFetch = globalThis.fetch;
    await register();
    console.log(JSON.stringify({
      input,
      present: Object.hasOwn(process.env, "MOMP_XBOX_DNS"),
      value: process.env.MOMP_XBOX_DNS,
      wrapped: installedFetch !== before,
      installed: globalThis.__mompXboxDnsFetchInstalled === true,
      idempotent: installedFetch === globalThis.fetch,
    }));
    process.exit(0);
  `;
  const output = execFileSync(process.execPath, ["--no-env-file", `--config=${config}`, "--eval", script], {
    cwd: project, env, encoding: "utf8", windowsHide: true, timeout: 10_000, maxBuffer: 16_384,
  });
  const { input, ...state } = JSON.parse(output.trim());
  assert.equal(input.present, value !== undefined, "Child must preserve absence versus an explicitly empty setting");
  assert.equal(input.value, value, "Child must receive the exact setting before instrumentation runs");
  return state;
}

for (const [label, value] of [["absent", undefined], ["empty", ""], ["disabled", "0"], ["enabled", "1"]]) {
  test(`Bun instrumentation initializes an ${label} Google route setting without external requests`, t => {
    const expected = value || (process.platform === "win32" ? "1" : "0");
    const state = registerInChild(t, value);
    assert.deepEqual(state, { present: true, value: expected, wrapped: expected === "1", installed: expected === "1", idempotent: true });
  });
}

test("edge instrumentation leaves route settings and fetch unchanged", t => {
  for (const value of [undefined, "", "0", "1"]) {
    const state = registerInChild(t, value, "edge");
    assert.equal(state.present, value !== undefined);
    assert.equal(state.value, value);
    assert.equal(state.wrapped, false);
    assert.equal(state.installed, false);
    assert.equal(state.idempotent, true);
  }
});
