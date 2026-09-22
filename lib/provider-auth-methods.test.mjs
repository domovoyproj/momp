import assert from "node:assert/strict";
import test from "node:test";
import { getOAuthLoginProviders, supportsApiKeyLogin } from "./provider-auth-methods.ts";
import { collectProviderListingInputs, resolveOAuthLoginId } from "./provider-listing-runtime.ts";
import { buildApiKeyProviderList, buildOAuthProviderList } from "./provider-listing.ts";
import { POST } from "../app/api/auth/api-key/[provider]/route.ts";

test("ChatGPT and Google subscription providers reject API-key login", () => {
  for (const id of ["openai-codex", "google-antigravity", "google-gemini-cli"]) {
    assert.equal(supportsApiKeyLogin(id), false, id);
  }
  for (const id of ["openai", "anthropic", "github-copilot", "my-gateway"]) {
    assert.equal(supportsApiKeyLogin(id), true, id);
  }
});

test("API-key prompts are not advertised as OAuth subscriptions", () => {
  const ids = getOAuthLoginProviders().map((provider) => provider.id);
  assert.ok(ids.includes("openai-codex"));
  assert.ok(ids.includes("anthropic"));
  assert.ok(!ids.includes("deepseek"));
  assert.ok(!ids.includes("cerebras"));
  assert.equal(resolveOAuthLoginId("openai-codex"), "openai-codex");
  assert.equal(resolveOAuthLoginId("deepseek"), undefined);
});

test("API endpoint rejects a ChatGPT key before opening credential storage", async () => {
  const previous = globalThis.__ompRuntimePromise;
  const sentinel = Promise.resolve({});
  globalThis.__ompRuntimePromise = sentinel;
  try {
    const response = await POST(new Request("http://localhost/api/auth/api-key/openai-codex", {
      method: "POST", body: JSON.stringify({ apiKey: "sk-test-not-a-real-key" }),
    }), { params: Promise.resolve({ provider: "openai-codex" }) });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /ChatGPT.*OAuth.*openai/);
    assert.equal(globalThis.__ompRuntimePromise, sentinel);
  } finally { globalThis.__ompRuntimePromise = previous; }
});

test("real catalog adapter keeps a legacy ChatGPT key out of the key list", async () => {
  const previous = globalThis.__ompRuntimePromise;
  globalThis.__ompRuntimePromise = Promise.resolve({
    modelRegistry: { getAll: () => [{ provider: "openai-codex", id: "gpt-5.5" }] },
    authStorage: {
      listStoredCredentials: (id) => id === "openai-codex" ? [{ credential: { type: "api_key" } }] : [],
      getCredentialOrigin: () => ({ kind: "api_key" }),
      hasAuth: (id) => id === "openai-codex",
    },
  });
  try {
    const inputs = await collectProviderListingInputs();
    assert.ok(!buildApiKeyProviderList(inputs).some((entry) => entry.id === "openai-codex"));
    const oauth = buildOAuthProviderList(inputs).filter((entry) => entry.id === "openai-codex");
    assert.equal(oauth.length, 1);
    assert.equal(oauth[0].loggedIn, false);
    assert.equal(oauth[0].supportsApiKey, false);
  } finally { globalThis.__ompRuntimePromise = previous; }
});

test("saving a supported key invalidates both runtime and model caches", async () => {
  const previous = globalThis.__ompRuntimePromise;
  const previousCache = globalThis.__ompModelsCacheState;
  const writes = [];
  globalThis.__ompModelsCacheState = { entries: new Map(), inFlight: new Map(), generation: 0 };
  globalThis.__ompRuntimePromise = Promise.resolve({
    modelRegistry: { hasProvider: (provider) => provider === "openai" },
    authStorage: { set: async (...args) => { writes.push(args); } },
  });
  try {
    const response = await POST(new Request("http://localhost/api/auth/api-key/openai", {
      method: "POST", body: JSON.stringify({ apiKey: "  test-key  " }),
    }), { params: Promise.resolve({ provider: "openai" }) });
    assert.equal(response.status, 200);
    assert.deepEqual(writes, [["openai", { type: "api_key", key: "test-key", source: "login" }]]);
    assert.equal(globalThis.__ompRuntimePromise, undefined);
    assert.equal(globalThis.__ompModelsCacheState.generation, 1);
  } finally {
    globalThis.__ompRuntimePromise = previous;
    globalThis.__ompModelsCacheState = previousCache;
  }
});
