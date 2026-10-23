import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { isBunRuntimeCacheValid, writeBunRuntimeCacheMetadata } from "./bun-runtime-cache.mjs";

function fixture(context) {
  const root = mkdtempSync(join(tmpdir(), "momp-bun-cache-"));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, "bun-windows-x64.exe");
  writeFileSync(target, "fake-binary");
  return { root, target };
}

test("Bun cache matches the exact triple, version, size and content hash", async (context) => {
  const { target } = fixture(context);
  await writeBunRuntimeCacheMetadata(target, "windows-x64", "1.4.2");
  assert.equal(await isBunRuntimeCacheValid(target, "windows-x64", "1.4.2"), true);
  assert.equal(await isBunRuntimeCacheValid(target, "windows-x64", "1.4.3"), false);
  assert.equal(await isBunRuntimeCacheValid(target, "darwin-x64", "1.4.2"), false);
  writeFileSync(target, "FAKE-BINARY");
  assert.equal(await isBunRuntimeCacheValid(target, "windows-x64", "1.4.2"), false);
});

test("legacy, truncated and empty Bun caches are not reusable", async (context) => {
  const { target } = fixture(context);
  assert.equal(await isBunRuntimeCacheValid(target, "windows-x64", "1.4.2"), false);
  writeFileSync(`${target}.version.json`, "{");
  assert.equal(await isBunRuntimeCacheValid(target, "windows-x64", "1.4.2"), false);
  writeFileSync(target, "");
  await assert.rejects(writeBunRuntimeCacheMetadata(target, "windows-x64", "1.4.2"), /empty/);
});

test("fetch-bun downloads again when BUN_VERSION changes despite an existing binary", async (context) => {
  const { root, target } = fixture(context);
  await writeBunRuntimeCacheMetadata(target, "windows-x64", "1.4.2");
  const source = readFileSync(new URL("./fetch-bun.mjs", import.meta.url), "utf8").replaceAll("\r\n", "\n");
  const body = source.slice(source.indexOf("async function fetchTriple"), source.indexOf("\nlet version;"));
  const bindings = {
    join, RESOURCES_DIR: root, force: false, existsSync, isBunRuntimeCacheValid,
    console: { log() {} }, fetch: async () => { throw new Error("download reached"); },
  };
  const fetchTriple = new Function(...Object.keys(bindings), `${body}\nreturn fetchTriple;`)(...Object.values(bindings));
  assert.equal((await fetchTriple("windows-x64", "1.4.2")).skipped, true);
  await assert.rejects(fetchTriple("windows-x64", "1.4.3"), /download reached/);
});
