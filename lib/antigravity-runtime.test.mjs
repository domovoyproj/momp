import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { findManagedAntigravity, prepareManagedAntigravity } from "./antigravity-runtime.ts";

const digest = (bytes) => ({ size: bytes.length, sha512: createHash("sha512").update(bytes).digest("hex") });

async function makeRuntime(context, bytes, member) {
  const root = await mkdtemp(join(tmpdir(), "momp-runtime-test-"));
  const fetch = globalThis.fetch;
  context.after(async () => {
    globalThis.fetch = fetch;
    await rm(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  });
  return {
    url: "https://storage.googleapis.com/antigravity-public/fixture",
    executable: join(root, "runtime", process.platform === "win32" ? "agy.exe" : "agy"),
    file: digest(bytes),
    member: member && digest(member),
  };
}

test("first sign-in can install a verified binary and reuse it without a download", async (context) => {
  const bytes = Buffer.from("verified vendor binary");
  const runtime = await makeRuntime(context, bytes);
  let downloads = 0;
  globalThis.fetch = async (url, options) => {
    downloads++;
    assert.equal(url, runtime.url);
    assert.equal(options.redirect, "error");
    return new Response(bytes);
  };
  const signal = new AbortController().signal;
  assert.equal(await findManagedAntigravity(runtime), undefined);
  assert.equal(await prepareManagedAntigravity(runtime, signal), runtime.executable);
  assert.deepEqual(await readFile(runtime.executable), bytes);
  assert.equal(await prepareManagedAntigravity(runtime, signal), runtime.executable);
  assert.equal(downloads, 1);

  await writeFile(runtime.executable, Buffer.alloc(bytes.length));
  await utimes(runtime.executable, new Date(0), new Date(0));
  assert.equal(await findManagedAntigravity(runtime), undefined);
  assert.equal(await prepareManagedAntigravity(runtime, signal), runtime.executable);
  assert.equal(downloads, 2);
  assert.deepEqual(await readFile(runtime.executable), bytes);
});

test("only the pinned executable is installed from a tarball", async (context) => {
  const binary = Buffer.from("verified member");
  const archive = await new Bun.Archive({ antigravity: binary, "extra.txt": "do not install" }, { compress: "gzip" }).bytes();
  const runtime = await makeRuntime(context, archive, binary);
  globalThis.fetch = async () => new Response(archive);
  assert.equal(await prepareManagedAntigravity(runtime, new AbortController().signal), runtime.executable);
  assert.deepEqual(await readFile(runtime.executable), binary);
  assert.deepEqual(await readdir(dirname(runtime.executable)), [process.platform === "win32" ? "agy.exe" : "agy"]);
});

test("corrupt, oversized and cancelled downloads leave no binary or partial file", async (context) => {
  const bytes = Buffer.from("pinned content");
  const runtime = await makeRuntime(context, bytes);
  const signal = new AbortController().signal;
  for (const invalid of [Buffer.alloc(bytes.length), Buffer.alloc(bytes.length + 1)]) {
    globalThis.fetch = async () => new Response(invalid);
    await assert.rejects(prepareManagedAntigravity(runtime, signal), { kind: "setup-integrity" });
    assert.deepEqual(await readdir(dirname(runtime.executable)), []);
  }

  const abort = new AbortController();
  const downloading = Promise.withResolvers();
  globalThis.fetch = async () => new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(bytes.subarray(0, 1));
      downloading.resolve();
    },
  }));
  const install = prepareManagedAntigravity(runtime, abort.signal);
  await downloading.promise;
  abort.abort();
  await assert.rejects(install, { kind: "cancelled" });
  assert.deepEqual(await readdir(dirname(runtime.executable)), []);

  globalThis.fetch = async () => new Response(bytes);
  assert.equal(await prepareManagedAntigravity(runtime, signal), runtime.executable);
});
