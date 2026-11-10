import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createGoogleAuthBrowser, validateGoogleAuthUrl } from "./google-auth-browser.ts";

const auth = "https://accounts.google.com/o/oauth2/v2/auth?client_id=synthetic&state=fixture";
async function fixture(context, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "momp-google-browser-test-"));
  const application = join(root, "programs", "Microsoft", "Edge", "Application");
  await mkdir(application, { recursive: true });
  await writeFile(join(application, "msedge.exe"), "fixture, never executed");
  const calls = [];
  const children = [];
  const stopped = [];
  let proxyClosed = 0;
  const dependencies = {
    platform: "win32", agentDir: () => join(root, "agent"),
    env: { ProgramFiles: join(root, "programs"), SystemRoot: "C:\\Windows", OPENAI_API_KEY: "must-not-reach-browser", HTTPS_PROXY: "must-not-reach-browser" },
    startProxy: async () => ({ url: "http://127.0.0.1:12345", close: () => { proxyClosed++; } }),
    isRunning: () => false,
    spawn: (executable, args, options) => {
      const child = Object.assign(new EventEmitter(), { pid: 123456, exitCode: null, signalCode: null });
      calls.push({ executable, args, options });
      children.push(child);
      setImmediate(() => child.emit("spawn"));
      return child;
    },
    terminate: async child => {
      stopped.push(child);
      child.exitCode = 0;
      child.emit("exit", 0, null);
    },
    ...overrides,
  };
  context.after(async () => { await rm(root, { recursive: true, force: true, maxRetries: 5 }); });
  return { root, calls, children, stopped, dependencies, proxyClosed: () => proxyClosed };
}

test("Google browser validates official auth URLs without opening other sites", () => {
  assert.equal(validateGoogleAuthUrl(auth), auth);
  for (const value of [
    "http://accounts.google.com/", "https://accounts.google.com.example/", "https://accounts.google.com:444/",
    "https://google.com/", "https://user:secret@accounts.google.com/", "file:///secret", "--proxy-server=evil",
    "https://accounts.google.com/\n", "https://accounts.google.com/?x=" + "a".repeat(16_384),
  ]) assert.throws(() => validateGoogleAuthUrl(value), /Invalid Google sign-in URL/);
});

test("browser uses isolated persistent profile, Google proxy, no direct DNS or provider secrets", async context => {
  const f = await fixture(context);
  const browser = await createGoogleAuthBrowser({ dependencies: f.dependencies });
  context.after(() => browser.close());
  const profile = join(f.root, "agent", "momp-google-browser", "edge");
  await mkdir(join(profile, "Default"));
  await writeFile(join(profile, "Default", "Cookies"), "keep browser-owned cookies");
  await browser.open(auth);
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].executable, join(f.root, "programs", "Microsoft", "Edge", "Application", "msedge.exe"));
  assert.deepEqual(f.calls[0].args, [
    "--user-data-dir=" + profile, "--proxy-server=http://127.0.0.1:12345",
    "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]", "--disable-quic", "--new-window",
    "--no-first-run", "--no-default-browser-check", auth,
  ]);
  assert.equal(f.calls[0].options.shell, false);
  assert.equal(f.calls[0].options.windowsHide, false);
  assert.equal(f.calls[0].options.env.OPENAI_API_KEY, undefined);
  assert.equal(f.calls[0].options.env.HTTPS_PROXY, undefined);
  await assert.rejects(browser.open(auth), /already been opened/);
  await browser.close();
  await browser.close();
  assert.deepEqual(f.stopped, [f.children[0]]);
  assert.equal(f.proxyClosed(), 1);
  assert.equal(await readFile(join(profile, "Default", "Cookies"), "utf8"), "keep browser-owned cookies");
  await assert.rejects(readFile(join(profile, "momp-browser.pid")), { code: "ENOENT" });
  await assert.rejects(browser.open(auth), /cancelled/);
});

test("only one browser lease uses the account profile and lease is reusable after close", async context => {
  const f = await fixture(context);
  const first = await createGoogleAuthBrowser({ dependencies: f.dependencies });
  context.after(() => first.close());
  await assert.rejects(createGoogleAuthBrowser({ dependencies: f.dependencies }), /already active/);
  await first.close();
  const second = await createGoogleAuthBrowser({ dependencies: f.dependencies });
  await second.close();
  assert.equal(f.proxyClosed(), 2);
});

test("stale live browser marker is preserved and blocks forwarding to an unmanaged window", async context => {
  const f = await fixture(context, { isRunning: pid => pid === 42 });
  const profile = join(f.root, "agent", "momp-google-browser", "edge");
  await mkdir(profile, { recursive: true });
  const marker = join(profile, "momp-browser.pid");
  await writeFile(marker, "42");
  await assert.rejects(createGoogleAuthBrowser({ dependencies: f.dependencies }), /Close the previous/);
  assert.equal(await readFile(marker, "utf8"), "42");
  assert.equal(f.proxyClosed(), 0);
  assert.equal(f.calls.length, 0);
  const browser = await createGoogleAuthBrowser({ dependencies: { ...f.dependencies, isRunning: () => false } });
  await browser.close();
});

test("cancellation closes proxy and only the spawned browser", async context => {
  const f = await fixture(context);
  const abort = new AbortController();
  const browser = await createGoogleAuthBrowser({ dependencies: f.dependencies, signal: abort.signal });
  await browser.open(auth);
  abort.abort();
  await browser.close();
  assert.equal(f.proxyClosed(), 1);
  assert.deepEqual(f.stopped, [f.children[0]]);
  await assert.rejects(createGoogleAuthBrowser({ dependencies: f.dependencies, signal: abort.signal }));
});

test("invalid URL never spawns a browser and native spawn failure releases the route", async context => {
  const f = await fixture(context);
  const browser = await createGoogleAuthBrowser({ dependencies: f.dependencies });
  await assert.rejects(browser.open("https://untrusted.example/"), /Invalid/);
  assert.equal(f.calls.length, 0);
  await browser.close();
  const failed = await createGoogleAuthBrowser({ dependencies: { ...f.dependencies, spawn: () => {
    const child = Object.assign(new EventEmitter(), { pid: undefined, exitCode: null, signalCode: null });
    setImmediate(() => child.emit("error", new Error("synthetic spawn failure")));
    return child;
  } } });
  await assert.rejects(failed.open(auth), /Could not open/);
  await failed.close();
  assert.equal(f.proxyClosed(), 2);
});

test("profile forwarding or immediate browser exit is a failure, never a successful open", async context => {
  const f = await fixture(context);
  const browser = await createGoogleAuthBrowser({ dependencies: { ...f.dependencies, spawn: () => {
    const child = Object.assign(new EventEmitter(), { pid: 123456, exitCode: null, signalCode: null });
    setImmediate(() => { child.emit("spawn"); setTimeout(() => { child.exitCode = 0; child.emit("exit", 0, null); }, 30); });
    return child;
  } } });
  await assert.rejects(browser.open(auth), /Could not open/);
  assert.equal(f.proxyClosed(), 1);
});

test("missing browser and bad route fail before launch, with no profile data removal", async context => {
  const f = await fixture(context);
  await assert.rejects(createGoogleAuthBrowser({ dependencies: { ...f.dependencies, env: {} } }), /installed Microsoft Edge/);
  let closed = false;
  await assert.rejects(createGoogleAuthBrowser({ dependencies: { ...f.dependencies, startProxy: async () => ({
    url: "http://not-loopback.example:1234", close: () => { closed = true; },
  }) } }), /network route/);
  assert.equal(closed, true);
  assert.equal(f.calls.length, 0);
});

test("internal callback helper loads only its validated extension in the app-owned Edge profile", async context => {
  const f = await fixture(context);
  const extension = join(f.root, "callback-helper");
  await mkdir(extension);
  await writeFile(join(extension, "manifest.json"), JSON.stringify({ manifest_version: 3, name: "fixture", version: "1" }));
  const browser = await createGoogleAuthBrowser({ dependencies: f.dependencies, extensionDirectory: extension });
  context.after(() => browser.close());
  await browser.open(auth);
  assert.ok(f.calls[0].args.includes("--load-extension=" + extension));
  assert.ok(f.calls[0].args.includes("--disable-extensions-except=" + extension));
  assert.equal(f.calls[0].args.some(arg => /disable.*warning|disable.*security|enable-automation|remote-debug/.test(arg)), false);
  // The temporary helper is owned by the login orchestration, and may only be
  // removed there after the browser has stopped.
  await browser.close();
  assert.equal(JSON.parse(await readFile(join(extension, "manifest.json"), "utf8")).manifest_version, 3);
  assert.equal(f.children[0].listenerCount("exit"), 0);
});

test("callback relay mode never falls back to Chrome which ignores load-extension", async context => {
  const f = await fixture(context);
  await rm(join(f.root, "programs", "Microsoft", "Edge", "Application", "msedge.exe"));
  const chrome = join(f.root, "programs", "Google", "Chrome", "Application");
  await mkdir(chrome, { recursive: true });
  await writeFile(join(chrome, "chrome.exe"), "fixture, never executed");
  const extension = join(f.root, "helper");
  await mkdir(extension);
  await writeFile(join(extension, "manifest.json"), '{"manifest_version":3}');
  await assert.rejects(createGoogleAuthBrowser({ dependencies: f.dependencies, extensionDirectory: extension }), /requires an installed Microsoft Edge browser/);
  assert.equal(f.calls.length, 0);
  const normal = await createGoogleAuthBrowser({ dependencies: f.dependencies });
  await normal.open(auth);
  assert.equal(f.calls[0].executable, join(chrome, "chrome.exe"));
  await normal.close();
});

test("callback helper rejects relative paths, shares, directory lists and invalid manifests", async context => {
  const f = await fixture(context);
  for (const extensionDirectory of ["relative", "\\\\server\\share\\helper", join(f.root, "helper,another"), join(f.root, "helper\n")]) {
    await assert.rejects(createGoogleAuthBrowser({ dependencies: f.dependencies, extensionDirectory }), /directory is invalid/);
  }
  const extension = join(f.root, "helper");
  await mkdir(extension);
  await writeFile(join(extension, "manifest.json"), '{"manifest_version":2}');
  await assert.rejects(createGoogleAuthBrowser({ dependencies: f.dependencies, extensionDirectory: extension }), /requires Manifest V3/);
  assert.equal(f.calls.length, 0);
  assert.equal(f.proxyClosed(), 0);
});

test("browser exit during PID-file creation cannot be mistaken for successful startup", async context => {
  const f = await fixture(context);
  const browser = await createGoogleAuthBrowser({ dependencies: { ...f.dependencies, spawn: () => {
    const child = Object.assign(new EventEmitter(), { pid: 123456, exitCode: null, signalCode: null });
    setImmediate(() => { child.emit("spawn"); child.exitCode = 0; child.emit("exit", 0, null); });
    return child;
  } } });
  await assert.rejects(browser.open(auth), /Could not open/);
  assert.equal(f.proxyClosed(), 1);
});

test("proxy close failure still stops the owned browser and releases its lease", async context => {
  const f = await fixture(context, { startProxy: async () => ({ url: "http://127.0.0.1:12345", close: () => { throw new Error("fixture cleanup failure"); } }) });
  const browser = await createGoogleAuthBrowser({ dependencies: f.dependencies });
  await browser.open(auth);
  await browser.close();
  assert.deepEqual(f.stopped, [f.children[0]]);
  const replacement = await createGoogleAuthBrowser({ dependencies: f.dependencies });
  await replacement.close();
});

test("callback helper refuses linked directories before browser startup", async context => {
  const f = await fixture(context);
  const target = join(f.root, "extension-target");
  await mkdir(target);
  await writeFile(join(target, "manifest.json"), '{"manifest_version":3}');
  const linked = join(f.root, "linked-helper");
  await symlink(target, linked, "junction");
  await assert.rejects(createGoogleAuthBrowser({ dependencies: f.dependencies, extensionDirectory: linked }), /must use a local directory/);
  assert.equal(f.calls.length, 0);
});

test("extension navigation waits for readiness without starting a second browser process", async context => {
  const f = await fixture(context);
  const extension = join(f.root, "helper");
  await mkdir(extension);
  await writeFile(join(extension, "manifest.json"), '{"manifest_version":3}');
  let releaseReady, reached;
  const ready = new Promise(resolve => { releaseReady = resolve; });
  const handshake = new Promise(resolve => { reached = resolve; });
  const browser = await createGoogleAuthBrowser({ dependencies: f.dependencies, extensionDirectory: extension,
    extensionNavigates: true, beforeNavigate: () => { reached(); return ready; },
  });
  context.after(() => browser.close());
  let opened = false;
  const opening = browser.open(auth).then(() => { opened = true; });
  await handshake;
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args.at(-1), "about:blank");
  assert.equal(f.calls[0].args.includes(auth), false);
  assert.equal(opened, false);
  releaseReady();
  await opening;
  assert.equal(f.calls.length, 1);
  assert.equal(opened, true);
  await browser.close();
  assert.deepEqual(f.stopped, [f.children[0]]);
});

test("cancelling a pending extension handshake never opens the account URL", async context => {
  const f = await fixture(context);
  const extension = join(f.root, "helper");
  await mkdir(extension);
  await writeFile(join(extension, "manifest.json"), '{"manifest_version":3}');
  const controller = new AbortController();
  let reached;
  const handshake = new Promise(resolve => { reached = resolve; });
  const browser = await createGoogleAuthBrowser({ dependencies: f.dependencies, signal: controller.signal,
    extensionDirectory: extension, extensionNavigates: true, beforeNavigate: () => { reached(); return new Promise(() => {}); },
  });
  const opening = browser.open(auth);
  await handshake;
  controller.abort();
  await assert.rejects(opening, /Could not open/);
  await browser.close();
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].args.at(-1), "about:blank");
  assert.equal(f.proxyClosed(), 1);
  assert.deepEqual(f.stopped, [f.children[0]]);
});

test("extension navigation requires both its helper directory and readiness handshake", async context => {
  const f = await fixture(context);
  for (const options of [
    { extensionNavigates: true },
    { extensionNavigates: true, extensionDirectory: f.root },
    { extensionNavigates: true, beforeNavigate: async () => {} },
    { beforeNavigate: async () => {} },
  ]) await assert.rejects(createGoogleAuthBrowser({ dependencies: f.dependencies, ...options }), /handshake is incomplete/);
  assert.equal(f.calls.length, 0);
});
test("spontaneous owned browser exit notifies once before cleanup", async context => {
  const f = await fixture(context);
  let notified = 0;
  const browser = await createGoogleAuthBrowser({ dependencies: f.dependencies, onClose: () => {
    notified++;
    assert.equal(f.proxyClosed(), 0, "The caller is notified before cleanup.");
  } });
  await browser.open(auth);
  f.children[0].exitCode = 0;
  f.children[0].emit("exit", 0, null);
  await browser.close();
  f.children[0].emit("error", new Error("late synthetic error"));
  assert.equal(notified, 1);
  assert.equal(f.proxyClosed(), 1);
});

test("explicit close and caller abort do not report a spontaneous browser exit", async context => {
  const f = await fixture(context);
  let notified = 0;
  const first = await createGoogleAuthBrowser({ dependencies: f.dependencies, onClose: () => { notified++; } });
  await first.open(auth);
  await first.close();
  const controller = new AbortController();
  const second = await createGoogleAuthBrowser({ dependencies: f.dependencies, signal: controller.signal, onClose: () => { notified++; } });
  await second.open(auth);
  controller.abort();
  await second.close();
  assert.equal(notified, 0);
});
