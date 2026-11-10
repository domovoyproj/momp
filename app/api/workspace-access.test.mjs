import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, parse } from "node:path";
import test from "node:test";
import { __resetDirsFromEnvForTests } from "@oh-my-pi/pi-utils/dirs";
import { NextRequest } from "next/server";
import { GET as getFiles } from "./files/[...path]/route.ts";
import { GET as getSkills } from "./skills/route.ts";
import { GET as getAntigravity, POST as postAntigravity } from "./antigravity/route.ts";
import { antigravityExecutable } from "../../lib/collaboration-providers.ts";
import { encodeFilePathForApi } from "../../lib/file-paths.ts";

function useAllowedRoots(context, ...paths) {
  const previous = globalThis.__ompAllowedRootsCache;
  globalThis.__ompAllowedRootsCache = { roots: new Set(paths), expiresAt: Date.now() + 10_000 };
  context.after(() => { globalThis.__ompAllowedRootsCache = previous; });
}

function useEnvironment(context, key, value) {
  const previous = process.env[key];
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
  if (key === "PI_CODING_AGENT_DIR") __resetDirsFromEnvForTests();
  context.after(() => {
    if (previous === undefined) delete process.env[key];
    else process.env[key] = previous;
    if (key === "PI_CODING_AGENT_DIR") __resetDirsFromEnvForTests();
  });
}

const localHeaders = { host: "localhost" };

test("the explorer can list an explicitly selected Windows drive root", { skip: process.platform !== "win32" }, async (context) => {
  const root = parse(process.cwd()).root;
  useAllowedRoots(context, root);
  const encoded = encodeFilePathForApi(root);
  const response = await getFiles(new NextRequest(`http://localhost/api/files/${encoded}?type=list`, { headers: localHeaders }), {
    params: Promise.resolve({ path: encoded.split("/").map(decodeURIComponent) }),
  });
  assert.equal(response.status, 200);
  assert.ok(Array.isArray((await response.json()).entries));
});

test("skills report a missing selected workspace and still reject an unapproved path", async (context) => {
  const missing = join(tmpdir(), `momp-missing-${crypto.randomUUID()}`);
  useAllowedRoots(context, missing);
  const list = (cwd) => getSkills(new Request(`http://localhost/api/skills?${new URLSearchParams({ cwd })}`, { headers: localHeaders }));
  assert.equal((await list(missing)).status, 404);
  assert.equal((await list(`${missing}-outside`)).status, 403);
});

test("Antigravity discovers Google's Windows installation without an override", { skip: process.platform !== "win32" }, async (context) => {
  const profile = mkdtempSync(join(tmpdir(), "momp-agy-install-"));
  context.after(() => rmSync(profile, { recursive: true, force: true }));
  const bin = join(profile, "agy", "bin");
  mkdirSync(bin, { recursive: true });
  const executable = join(bin, "agy.exe");
  writeFileSync(executable, "fixture");
  useEnvironment(context, "LOCALAPPDATA", profile);
  useEnvironment(context, "MOMP_ANTIGRAVITY_CLI", undefined);
  assert.equal(await antigravityExecutable(), executable);
});

test("Antigravity sign-in is available without a project but starting a conversation requires one", async (context) => {
  useEnvironment(context, "MOMP_ANTIGRAVITY_CLI", join(tmpdir(), `momp-missing-${crypto.randomUUID()}.exe`));
  const url = "http://localhost/api/antigravity";
  const status = await getAntigravity(new Request(url, { headers: localHeaders }));
  assert.equal(status.status, 200);
  assert.equal((await status.json()).workspaceAvailable, false);
  const act = (action, headers = localHeaders) => postAntigravity(new Request(url, {
    method: "POST", headers: { ...headers, "content-type": "application/json" }, body: JSON.stringify({ action }),
  }));
  assert.equal((await act("sign-in")).status, 503);
  assert.equal((await act("sign-in", { host: "192.0.2.1" })).status, 403);
  assert.equal((await act("open")).status, 403);
});

test("only local sign-in starts preparation and concurrent clicks share the guard", async (context) => {
  const profile = mkdtempSync(join(tmpdir(), "momp-agy-first-sign-in-"));
  useEnvironment(context, "PI_CODING_AGENT_DIR", join(profile, "agent"));
  useEnvironment(context, process.platform === "win32" ? "LOCALAPPDATA" : "HOME", profile);
  useEnvironment(context, "MOMP_ANTIGRAVITY_CLI", undefined);
  const originalFetch = globalThis.fetch;
  context.after(() => {
    globalThis.fetch = originalFetch;
    rmSync(profile, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  });

  const download = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let requests = 0;
  globalThis.fetch = async (url) => {
    requests++;
    download.resolve(String(url));
    await finish.promise;
    return new Response("not the pinned Google binary");
  };

  const url = "http://localhost/api/antigravity";
  const status = await (await getAntigravity(new Request(url, { headers: localHeaders }))).json();
  assert.equal(status.configured, false);
  assert.equal(status.canPrepare, true);
  assert.equal(status.localSignIn, true);
  const signIn = (host = "localhost") => postAntigravity(new Request(url, {
    method: "POST", headers: { host, "content-type": "application/json" }, body: JSON.stringify({ action: "sign-in" }),
  }));
  assert.equal((await signIn("192.0.2.1")).status, 403);
  assert.equal(requests, 0);

  const first = signIn();
  try {
    assert.match(await download.promise, /^https:\/\/storage\.googleapis\.com\/antigravity-public\/antigravity-cli\//);
    const second = await signIn();
    assert.equal(second.status, 409);
    assert.equal((await second.json()).error, "sign-in-in-progress");
    assert.equal(requests, 1);
  } finally { finish.resolve(); }
  const rejected = await first;
  assert.equal(rejected.status, 503);
  assert.equal((await rejected.json()).error, "setup-integrity");
  assert.equal(await antigravityExecutable(), undefined);
});

test("Xbox DNS sign-in prepares the pinned runtime even when a different executable was configured", async (context) => {
  const directory = mkdtempSync(join(tmpdir(), "momp-pinned-auth-runtime-"));
  useEnvironment(context, "PI_CODING_AGENT_DIR", directory);
  useEnvironment(context, "MOMP_XBOX_DNS", "1");
  useEnvironment(context, "MOMP_ANTIGRAVITY_CLI", join(tmpdir(), "momp-no-runtime-needed.exe"));
  const originalFetch = globalThis.fetch;
  let download = "";
  globalThis.fetch = async url => { download = String(url); return new Response("invalid fixture binary"); };
  context.after(() => { globalThis.fetch = originalFetch; rmSync(directory, { recursive: true, force: true }); });
  const response = await postAntigravity(new Request("http://localhost/api/antigravity", {
    method: "POST", headers: { ...localHeaders, "content-type": "application/json" },
    body: JSON.stringify({ action: "sign-in" }),
  }));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "setup-integrity");
  assert.match(download, /antigravity-cli\/1\.5\.5-/);
});
