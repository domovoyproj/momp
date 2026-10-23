import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const source = readFileSync(new URL("./build-desktop.mjs", import.meta.url), "utf8")
  .replace(/^#!.*\r?\n/, "")
  .replace(/^import .*;\r?$/gm, "")
  .replaceAll("import.meta.dir", '"/fixture/scripts"');

function runBuild({ executable = true, payload = true, emptyPayload = false, status = 0 } = {}) {
  const writes = [];
  const env = { join, Buffer, homedir: () => "/no-user-home", console: { log() {}, warn() {}, error() {} },
    process: { env: {}, platform: "win32", exit: (code) => { throw { exitCode: code }; } },
    spawnSync: () => ({ status }),
    existsSync: (path) => path.endsWith("momp.exe") ? executable : path.endsWith("server_payload.tar") ? payload : false,
    readFileSync: (path) => {
      if (path.includes("signing")) assert.fail("Test must not read credentials");
      return path.endsWith("momp.exe") ? Buffer.from("EXE") : emptyPayload ? Buffer.alloc(0) : Buffer.from("PAYLOAD");
    },
    writeFileSync: (path, data) => writes.push({ path, data }),
  };
  try {
    new Function(...Object.keys(env), source)(...Object.values(env));
    return { code: 0, writes };
  } catch (error) {
    if ("exitCode" in error) return { code: error.exitCode, writes };
    throw error;
  }
}

test("desktop build fails closed when a successful tool invocation produced no executable", () => {
  const result = runBuild({ executable: false });
  assert.notEqual(result.code, 0);
  assert.equal(result.writes.length, 0);
});

test("desktop build fails closed when no server payload exists", () => {
  const result = runBuild({ payload: false });
  assert.notEqual(result.code, 0);
  assert.equal(result.writes.length, 0);
});

test("desktop build rejects an empty payload rather than shipping an invalid footer", () => {
  const result = runBuild({ emptyPayload: true });
  assert.notEqual(result.code, 0);
  assert.equal(result.writes.length, 0);
});

test("desktop build embeds the payload with its exact size and footer", () => {
  const result = runBuild();
  assert.equal(result.code, 0);
  assert.equal(result.writes.length, 1);
  const { data } = result.writes[0];
  assert.equal(data.subarray(0, 10).toString(), "EXEPAYLOAD");
  assert.equal(data.subarray(-8).toString(), "MOMP_SFX");
  assert.equal(data.readBigUInt64LE(data.length - 16), 7n);
});

test("desktop build preserves a failed compiler exit and never embeds", () => {
  const result = runBuild({ status: 7 });
  assert.equal(result.code, 7);
  assert.equal(result.writes.length, 0);
});
