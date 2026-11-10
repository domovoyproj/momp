import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { __resetDirsFromEnvForTests } from "@oh-my-pi/pi-utils/dirs";
import { GET, POST } from "./[provider]/route.ts";

const url = "http://localhost/api/auth/login/openai-codex";
const params = (provider = "openai-codex") => ({ params: Promise.resolve({ provider }) });
const headers = { host: "localhost", "content-type": "application/json" };
const decode = (bytes) => JSON.parse(new TextDecoder().decode(bytes).slice(6).trim());

test("mock OAuth SSE accepts the code once for its exact provider and exposes no credential", async () => {
  const previous = globalThis.__ompRuntimePromise;
  const previousCache = globalThis.__ompModelsCacheState;
  globalThis.__ompRuntimePromise = Promise.resolve({ authStorage: { oauth: { async login(id, callbacks) {
    assert.equal(id, "openai-codex");
    callbacks.onAuth({ url: "https://example.invalid/authorize" });
    assert.equal(await callbacks.onManualCodeInput(), "synthetic-code");
    return { access: "do-not-serialize" };
  } } } });
  try {
    const stream = await GET(new Request(url, { headers }), params());
    assert.match(stream.headers.get("cache-control"), /no-store/);
    const reader = stream.body.getReader();
    const auth = decode((await reader.read()).value);
    assert.equal(auth.type, "auth");
    assert.match(auth.token, /^[a-f0-9-]{36}$/);
    const request = (override = {}) => new Request(url, { method: "POST", headers: { ...headers, ...override },
      body: JSON.stringify({ token: auth.token, code: "synthetic-code" }) });
    assert.equal((await POST(request({ origin: "https://untrusted.invalid" }), params())).status, 403);
    assert.equal((await POST(request(), params("openai"))).status, 400);
    assert.equal((await POST(request(), params())).status, 200);
    assert.equal((await POST(request(), params())).status, 404);
    assert.deepEqual(decode((await reader.read()).value), { type: "success" });
    assert.equal((await reader.read()).done, true);
  } finally {
    globalThis.__ompRuntimePromise = previous;
    globalThis.__ompModelsCacheState = previousCache;
  }
});

test("cancelling the stream revokes an outstanding manual code", async () => {
  const previous = globalThis.__ompRuntimePromise;
  globalThis.__ompRuntimePromise = Promise.resolve({ authStorage: { oauth: { async login(_id, callbacks) {
    await callbacks.onPrompt({ message: "Paste the synthetic code" });
  } } } });
  try {
    const stream = await GET(new Request(url, { headers }), params());
    const reader = stream.body.getReader();
    const prompt = decode((await reader.read()).value);
    assert.equal(prompt.type, "prompt_request");
    await reader.cancel();
    const response = await POST(new Request(url, { method: "POST", headers,
      body: JSON.stringify({ token: prompt.token, code: "synthetic-code" }) }), params());
    assert.equal(response.status, 404);
  } finally { globalThis.__ompRuntimePromise = previous; }
});

test("Google Xbox DNS OAuth cannot launch a host browser for a remote web client", async (t) => {
  const previous = process.env.MOMP_XBOX_DNS;
  process.env.MOMP_XBOX_DNS = "1";
  t.after(() => { if (previous === undefined) delete process.env.MOMP_XBOX_DNS; else process.env.MOMP_XBOX_DNS = previous; });
  const stream = await GET(new Request("http://192.0.2.1/api/auth/login/google-gemini-cli", { headers: { host: "192.0.2.1" } }), params("google-gemini-cli"));
  const text = await stream.text();
  assert.match(text, /Open momp on this computer/);
  assert.doesNotMatch(text, /auth_request|prompt_request|accounts\.google\.com/);
});

test("Google OAuth uses an automatic browser handoff and never exposes a manual fallback URL", { skip: process.platform !== "win32" }, async (t) => {
  const directory = await mkdtemp(join(tmpdir(), "momp-google-sdk-login-"));
  const executable = join(directory, "Microsoft", "Edge", "Application", "msedge.exe");
  await mkdir(join(directory, "Microsoft", "Edge", "Application"), { recursive: true });
  await writeFile(executable, "not executed: invalid OAuth URL must fail before spawn");
  const names = ["MOMP_XBOX_DNS", "PI_CODING_AGENT_DIR", "ProgramFiles(x86)", "ProgramFiles", "LOCALAPPDATA"];
  const previous = names.map(name => [name, process.env[name]]);
  const runtime = globalThis.__ompRuntimePromise;
  for (const name of names) process.env[name] = name === "MOMP_XBOX_DNS" ? "1" : directory;
  __resetDirsFromEnvForTests();
  t.after(async () => {
    globalThis.__ompRuntimePromise = runtime;
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else process.env[name] = value; }
    __resetDirsFromEnvForTests();
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  });
  let called = false;
  globalThis.__ompRuntimePromise = Promise.resolve({ authStorage: { oauth: { async login(id, callbacks) {
    called = true;
    assert.equal(id, "google-gemini-cli");
    assert.equal(callbacks.onManualCodeInput, undefined);
    const aborted = new Promise((_, reject) => callbacks.signal.addEventListener("abort", () => reject(new Error("cancelled")), { once: true }));
    callbacks.onAuth({ url: "https://untrusted.invalid/private-oauth-url" });
    await aborted;
  } } } });
  const stream = await GET(new Request("http://localhost/api/auth/login/google-gemini-cli", { headers }), params("google-gemini-cli"));
  const text = await stream.text();
  assert.equal(called, true);
  assert.match(text, /momp browser window/);
  assert.match(text, /Could not open/);
  assert.doesNotMatch(text, /private-oauth-url|prompt_request|"token"|"type":"auth"/);
});
