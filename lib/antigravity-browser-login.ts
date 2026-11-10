import { execFile, spawn, type ChildProcess } from "node:child_process";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { copyFile, mkdir, mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { StringDecoder } from "node:string_decoder";
import { promisify } from "node:util";
import { createGoogleAuthBrowser, validateGoogleAuthUrl } from "./google-auth-browser";
import { antigravityNetworkEnv } from "./google-network";

const CALLBACK = "https://antigravity.google/oauth-callback";
const ENVIRONMENT = /^(?:path|pathext|home|userprofile|homedrive|homepath|username|user|logname|comspec|systemroot|windir|appdata|localappdata|programdata|programfiles(?:\(x86\))?|commonprogramfiles(?:\(x86\))?|temp|tmp|tmpdir|lang|lc_[a-z_]+|https?_proxy|no_proxy|ssl_cert_file|ssl_cert_dir)$/i;
const execFileAsync = promisify(execFile);
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export class AntigravityBrowserLoginError extends Error {
  constructor(readonly kind: "cancelled" | "timeout" | "xbox-dns-browser" | "unavailable") {
    super(kind === "timeout" ? "Google sign-in timed out. Please try again."
      : kind === "cancelled" ? "Google sign-in was cancelled."
        : kind === "xbox-dns-browser" ? "The momp Google sign-in browser could not connect. Please retry."
          : "Antigravity could not complete Google sign-in. Please retry.");
  }
}

function sameSecret(actual: string, expected: string): boolean {
  const a = Buffer.from(actual), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (request.headers["content-type"] !== "application/json") throw new Error("Invalid request");
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > 32_768) throw new Error("Invalid request");
    chunks.push(bytes);
  }
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Invalid request");
  return value as Record<string, unknown>;
}

/** The bridge only forwards the official one-time code to the CLI that requested it. */
export async function createAntigravityLoginRelay(options: {
  onOpen: (url: string) => Promise<void>;
  onCode: (code: string) => Promise<void>;
  onReady: () => void;
  onError: (error: AntigravityBrowserLoginError) => void;
  ttlMs?: number;
}) {
  const token = randomBytes(32).toString("base64url");
  const ttl = Math.min(300_000, Math.max(1, options.ttlMs ?? 75_000));
  const expiresAt = Date.now() + ttl;
  let state: string | undefined;
  let authorizationUrl: string | undefined;
  let used = false;
  let ready = false;
  let closed = false;
  let origin = "";
  const sockets = new Set<Socket>();
  const server = createServer({ maxHeaderSize: 4096, headersTimeout: 5000, requestTimeout: 5000 }, (request, response) => {
    const end = (status: number) => { response.writeHead(status, { "Cache-Control": "no-store", Connection: "close" }).end(); };
    void (async () => {
      if (closed || Date.now() >= expiresAt) return end(410);
      if (request.socket.remoteAddress !== "127.0.0.1" || request.headers.host !== new URL(origin).host
        || !sameSecret(String(request.headers.authorization ?? ""), "Bearer " + token)) return end(403);
      if (request.method !== "POST" || !["/open", "/ready", "/callback"].includes(request.url ?? "")) return end(404);
      const requestOrigin = request.headers.origin;
      if (requestOrigin !== undefined && (request.url === "/open" || !/^chrome-extension:\/\/[a-p]{32}$/.test(requestOrigin))) return end(403);
      let body: Record<string, unknown>;
      try { body = await readJson(request); } catch { return end(400); }
      if (request.url === "/open") {
        if (state !== undefined) return end(409);
        let url: URL;
        try {
          if (typeof body.url !== "string") return end(400);
          url = new URL(validateGoogleAuthUrl(body.url));
        } catch { return end(400); }
        const nextState = url.searchParams.get("state");
        if (url.searchParams.getAll("state").length !== 1 || !nextState || nextState.length > 1024
          || /[\r\n\u0000]/.test(nextState)
          || url.searchParams.getAll("redirect_uri").length !== 1 || url.searchParams.get("redirect_uri") !== CALLBACK
          || url.searchParams.get("response_type") !== "code" || !url.searchParams.get("code_challenge")
          || url.searchParams.get("code_challenge_method") !== "S256") return end(400);
        state = nextState;
        authorizationUrl = url.href;
        // The native launcher only needs delivery acknowledged. Browser startup
        // and extension readiness can outlast the bridge's short request timeout.
        end(204);
        void Promise.resolve().then(() => options.onOpen(url.href)).catch(() => {
          options.onError(new AntigravityBrowserLoginError("xbox-dns-browser"));
        });
        return;
      }
      if (state === undefined) return end(409);
      if (request.url === "/ready") {
        if (ready || !authorizationUrl) return end(409);
        const navigation = authorizationUrl;
        authorizationUrl = undefined;
        ready = true;
        response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store", Connection: "close" }).end(JSON.stringify({ url: navigation }));
        options.onReady();
        return;
      }
      if (!ready || used) return end(409);
      let callback: URL;
      try {
        if (typeof body.url !== "string" || body.url.length > 16_384) return end(400);
        callback = new URL(body.url);
      } catch { return end(400); }
      if (callback.origin + callback.pathname !== CALLBACK || callback.username || callback.password || callback.hash
        || callback.searchParams.getAll("state").length !== 1 || !sameSecret(callback.searchParams.get("state") ?? "", state)) return end(403);
      if (callback.searchParams.has("error")) {
        used = true;
        options.onError(new AntigravityBrowserLoginError("cancelled"));
        return end(204);
      }
      const code = callback.searchParams.get("code");
      if (callback.searchParams.getAll("code").length !== 1 || !code || code.length > 8192 || /[\u0000-\u0020\u007f]/.test(code)) return end(400);
      used = true;
      try { await options.onCode(code); } catch {
        options.onError(new AntigravityBrowserLoginError("unavailable"));
        return end(503);
      }
      return end(204);
    })().catch(() => {
      options.onError(new AntigravityBrowserLoginError("unavailable"));
      if (!response.headersSent) end(500);
    });
  });
  server.maxConnections = 8;
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.setTimeout(5000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
    socket.unref();
  });
  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") throw new AntigravityBrowserLoginError("unavailable");
  origin = "http://127.0.0.1:" + address.port;
  server.unref();
  const expiry = setTimeout(() => options.onError(new AntigravityBrowserLoginError("timeout")), ttl);
  expiry.unref();
  return {
    origin, token,
    async close(): Promise<void> {
      if (closed) return;
      closed = true;
      clearTimeout(expiry);
      state = undefined;
      authorizationUrl = undefined;
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}

export function antigravityCallbackExtension(origin: string, token: string) {
  const endpoint = new URL(origin);
  if (endpoint.protocol !== "http:" || endpoint.hostname !== "127.0.0.1" || !endpoint.port
    || endpoint.username || endpoint.password || endpoint.pathname !== "/" || endpoint.search || endpoint.hash
    || !/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error("Invalid callback bridge");
  return {
    manifest: {
      manifest_version: 3, name: "momp Google sign-in", version: "1.0.0",
      description: "Returns the official Antigravity sign-in code to this momp sign-in attempt.",
      permissions: ["webRequest"],
      host_permissions: ["https://antigravity.google/*", "http://127.0.0.1/*"],
      background: { service_worker: "background.js" },
    },
    worker: `const origin = ${JSON.stringify(endpoint.origin)};
const token = ${JSON.stringify(token)};
const send = (path, body) => fetch(origin + path, {method:"POST", headers:{"Content-Type":"application/json",Authorization:"Bearer " + token}, body:JSON.stringify(body), cache:"no-store", redirect:"error"}).then(r => { if (!r.ok) throw new Error("Sign-in bridge unavailable"); return r; });
let ready;
chrome.webRequest.onBeforeRequest.addListener(details => {
  if (details.type !== "main_frame" || details.frameId !== 0) return;
  const url = new URL(details.url);
  if (url.origin !== "https://antigravity.google" || url.pathname !== "/oauth-callback") return;
  void ready.then(() => send("/callback", {url:url.href})).catch(() => {});
}, {urls:["https://antigravity.google/oauth-callback*"],types:["main_frame"]});
ready = send("/ready", {}).then(response => response.json()).then(body => {
  if (!body || typeof body.url !== "string" || body.url.length > 16384) throw new Error("Invalid Google sign-in URL");
  const url = new URL(body.url);
  if (url.protocol !== "https:" || url.hostname !== "accounts.google.com" || url.username || url.password || url.port) throw new Error("Invalid Google sign-in URL");
  return chrome.tabs.create({url:url.href});
});
void ready.catch(() => {});
`,
  };
}

type Browser = { open: (url: string) => Promise<void>; close: () => Promise<void> };
type Dependencies = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  bunExecutable: string;
  temporaryRoot: string;
  networkEnv: typeof antigravityNetworkEnv;
  spawn: typeof spawn;
  createBrowser: (options: { signal: AbortSignal; extensionDirectory: string; extensionNavigates: true; beforeNavigate: () => Promise<void>; onClose: () => void }) => Promise<Browser>;
  compileLauncher: typeof compileAntigravityBrowserLauncher;
  terminate: (child: ChildProcess) => Promise<void>;
  handshakeTimeoutMs: number;
  timeoutMs: number;
};

export async function compileAntigravityBrowserLauncher(options: { cwd: string; bunExecutable: string; signal: AbortSignal }): Promise<void> {
  const runtime = join(options.cwd, "compile-runtime.exe");
  await copyFile(options.bunExecutable, runtime);
  const args = ["build", "--compile", "--windows-hide-console", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig",
    "--compile-executable-path=compile-runtime.exe", "browser-launcher.mjs", "--outfile", "browser-launcher/rundll32.exe"];
  // The explicit relative runtime avoids Bun 1.4.4's Unicode self-copy bug.
  // There are no imports, package installs, downloads or user configuration files.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => ENVIRONMENT.test(key))) as NodeJS.ProcessEnv;
  for (let attempt = 0; ; attempt++) {
    options.signal.throwIfAborted();
    try {
      await execFileAsync(options.bunExecutable, args, { cwd: options.cwd, env, signal: options.signal, windowsHide: true, timeout: 30_000, maxBuffer: 65_536 });
      break;
    } catch (error) {
      if (options.signal.aborted || attempt >= 2 || !String((error as { stderr?: unknown }).stderr).includes("Error truncating PE file")) throw error;
      await delay(250 * (attempt + 1));
    }
  }
  const file = await open(join(options.cwd, "browser-launcher", "rundll32.exe"), "r");
  try {
    const dos = Buffer.alloc(64);
    const { bytesRead } = await file.read(dos, 0, 64, 0);
    const offset = dos.readUInt32LE(60);
    if (bytesRead !== 64 || dos.readUInt16LE(0) !== 0x5a4d || offset < 64 || offset > 1_048_576) throw new Error("Invalid launcher executable");
    const pe = Buffer.alloc(96);
    const result = await file.read(pe, 0, 96, offset);
    if (result.bytesRead !== 96 || pe.readUInt32LE(0) !== 0x00004550 || pe.readUInt16LE(92) !== 2) throw new Error("The launcher must be a Windows GUI executable");
  } finally { await file.close(); }
}
async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid || child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform === "win32") {
    await execFileAsync(join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe"),
      ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 4000 }).catch(() => child.kill());
  } else child.kill("SIGTERM");
  await Promise.race([once(child, "exit").catch(() => {}), delay(1500)]);
}

/** Runs the official OAuth flow without sending any coding prompt or exchanging tokens itself. */
export async function signInToAntigravityBrowser(executable: string, signal?: AbortSignal, dependencies: Partial<Dependencies> = {}): Promise<void> {
  const deps: Dependencies = {
    platform: process.platform, env: process.env, bunExecutable: process.execPath, temporaryRoot: tmpdir(),
    networkEnv: antigravityNetworkEnv, spawn, createBrowser: createGoogleAuthBrowser, terminate, compileLauncher: compileAntigravityBrowserLauncher,
    handshakeTimeoutMs: 15_000, timeoutMs: 75_000, ...dependencies,
  };
  if (deps.platform !== "win32") throw new AntigravityBrowserLoginError("xbox-dns-browser");
  if (signal?.aborted) throw new AntigravityBrowserLoginError("cancelled");
  const cwd = await mkdtemp(join(deps.temporaryRoot, "momp-agy-browser-auth-"));
  const controller = new AbortController();
  let child: ChildProcess | undefined;
  let browser: Browser | undefined;
  let relay: Awaited<ReturnType<typeof createAntigravityLoginRelay>> | undefined;
  let handshake: ReturnType<typeof setTimeout> | undefined;
  let resolveReady!: () => void;
  let rejectReady!: (error: Error) => void;
  let initialized = false;
  const ready = new Promise<void>((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  // A browser callback can fail while filesystem preparation is still awaited.
  void ready.catch(() => {});
  let resolveExtensionReady!: () => void;
  let rejectExtensionReady!: (error: Error) => void;
  const extensionReady = new Promise<void>((resolve, reject) => { resolveExtensionReady = resolve; rejectExtensionReady = reject; });
  void extensionReady.catch(() => {});
  let terminalFailure: AntigravityBrowserLoginError | undefined;
  const fail = (error: AntigravityBrowserLoginError) => { terminalFailure ??= error; rejectReady(error); rejectExtensionReady(error); };
  const abort = () => { controller.abort(); fail(new AntigravityBrowserLoginError("cancelled")); };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    if (signal?.aborted) throw new AntigravityBrowserLoginError("cancelled");
    relay = await createAntigravityLoginRelay({
      ttlMs: deps.timeoutMs,
      onOpen: async url => {
        handshake = setTimeout(() => fail(new AntigravityBrowserLoginError("xbox-dns-browser")), deps.handshakeTimeoutMs);
        handshake.unref();
        if (!browser) throw new Error("Browser unavailable");
        await browser.open(url);
      },
      onReady: () => { clearTimeout(handshake); resolveExtensionReady(); },
      onCode: async code => {
        if (!child?.stdin || child.exitCode !== null || child.signalCode !== null || initialized) throw new Error("CLI unavailable");
        await new Promise<void>((resolve, reject) => child!.stdin!.write(code + "\n", error => error ? reject(error) : resolve()));
      },
      onError: fail,
    });
    const extensionDirectory = join(cwd, "callback-extension");
    await mkdir(extensionDirectory, { mode: 0o700 });
    const extension = antigravityCallbackExtension(relay.origin, relay.token);
    await writeFile(join(extensionDirectory, "manifest.json"), JSON.stringify(extension.manifest), { mode: 0o600, flag: "wx" });
    await writeFile(join(extensionDirectory, "background.js"), extension.worker, { mode: 0o600, flag: "wx" });
    const launcherDirectory = join(cwd, "browser-launcher");
    await mkdir(launcherDirectory, { mode: 0o700 });
    await writeFile(join(cwd, "browser-launcher.mjs"), `
try {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "url.dll,FileProtocolHandler" || args[1].length > 16384) process.exit(1);
  const response = await fetch(${JSON.stringify(relay.origin + "/open")}, {method:"POST",headers:{"Content-Type":"application/json",Authorization:${JSON.stringify("Bearer " + relay.token)}},body:JSON.stringify({url:args[1]}),redirect:"error",signal:AbortSignal.timeout(20000)});
  if (!response.ok) process.exit(1);
} catch { process.exit(1); }
`, { mode: 0o600, flag: "wx" });
    await deps.compileLauncher({ cwd, bunExecutable: deps.bunExecutable, signal: controller.signal });
    browser = await deps.createBrowser({ signal: controller.signal, extensionDirectory, extensionNavigates: true, onClose: () => fail(new AntigravityBrowserLoginError("cancelled")), beforeNavigate: async () => {
      await extensionReady;
      controller.signal.throwIfAborted();
    } });
    if (signal?.aborted) throw new AntigravityBrowserLoginError("cancelled");
    const env = Object.fromEntries(Object.entries(deps.networkEnv(deps.env)).filter(([key]) => ENVIRONMENT.test(key))) as NodeJS.ProcessEnv;
    const oldPath = Object.entries(env).find(([key]) => key.toLowerCase() === "path")?.[1] ?? "";
    for (const key of Object.keys(env)) if (key.toLowerCase() === "path") delete env[key];
    env.PATH = launcherDirectory + delimiter + oldPath;
    // Account sign-in must not inherit the CLI's optional Gemini API-key mode.
    // --settings overrides this invocation only and preserves the user's saved preferences.
    const native = deps.spawn(executable, ["--input-format", "stream-json", "--output-format", "stream-json", "--sandbox", "--settings", '{"modelProvider":""}'],
      { cwd, env, shell: false, windowsHide: true, stdio: "pipe" });
    child = native;
    native.once("error", () => fail(new AntigravityBrowserLoginError("unavailable")));
    native.stdin.on("error", () => fail(new AntigravityBrowserLoginError("unavailable")));
    let bytes = 0, line = "";
    const decoder = new StringDecoder("utf8");
    native.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > 1_048_576) { fail(new AntigravityBrowserLoginError("unavailable")); return; }
      line += decoder.write(chunk);
      for (let newline; (newline = line.indexOf("\n")) >= 0;) {
        const complete = line.slice(0, newline); line = line.slice(newline + 1);
        let event: { event?: string; conversation_id?: string; init?: { cwd?: string }; result?: { status?: string; error?: string } };
        try { event = JSON.parse(complete); } catch { continue; }
        if (event?.event === "init" && typeof event.conversation_id === "string" && event.conversation_id.length > 0
          && typeof event.init?.cwd === "string") {
          initialized = true;
          resolveReady();
        } else if (event?.event === "result" && event.result?.status === "ERROR") {
          const timeout = typeof event.result?.error === "string" && /auth.*timed out/i.test(event.result.error);
          fail(new AntigravityBrowserLoginError(timeout ? "timeout" : "unavailable"));
        }
      }
    });
    // Provider diagnostics can contain OAuth URLs. Drain them without storing or exposing them.
    native.stderr.resume();
    const exited = new Promise<number | null>(resolve => native.once("exit", code => {
      if (!initialized) fail(new AntigravityBrowserLoginError("unavailable"));
      resolve(code);
    }));
    await ready;
    native.stdin.end();
    const exitCode = await Promise.race([exited, delay(4000).then(() => -1)]);
    if (signal?.aborted) throw new AntigravityBrowserLoginError("cancelled");
    if (terminalFailure) throw terminalFailure;
    if (exitCode !== 0) throw new AntigravityBrowserLoginError("unavailable");
  } catch (error) {
    if (signal?.aborted) throw new AntigravityBrowserLoginError("cancelled");
    if (error instanceof AntigravityBrowserLoginError) throw error;
    throw new AntigravityBrowserLoginError("unavailable");
  } finally {
    signal?.removeEventListener("abort", abort);
    clearTimeout(handshake);
    controller.abort();
    await relay?.close().catch(() => {});
    if (child) await deps.terminate(child).catch(() => {});
    await browser?.close().catch(() => {});
    await rm(cwd, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}