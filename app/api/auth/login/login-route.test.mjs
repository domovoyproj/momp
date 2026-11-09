import assert from "node:assert/strict";
import test from "node:test";
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
