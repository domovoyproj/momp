import { execFile, spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { access, lstat, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import lockfile from "proper-lockfile";
import { startGoogleBrowserProxy } from "./google-network";

const execFileAsync = promisify(execFile);
const state = globalThis as typeof globalThis & { __mompGoogleBrowserLeases?: Set<string> };


type BrowserProxy = { url: string; close: () => void | Promise<void> };
type Dependencies = {
  platform: NodeJS.Platform;
  env: NodeJS.ProcessEnv;
  agentDir: () => string;
  spawn: typeof spawn;
  startProxy: () => Promise<BrowserProxy>;
  terminate: (child: ChildProcess) => Promise<void>;
  isRunning: (pid: number) => boolean;
};

function isRunning(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code !== "ESRCH"; }
}

function hasExited(child: ChildProcess): boolean {
  return child.exitCode !== null || child.signalCode !== null;
}

function waitForExit(child: ChildProcess, duration: number): Promise<void> {
  if (hasExited(child)) return Promise.resolve();
  return new Promise(resolve => {
    const finish = () => {
      clearTimeout(timer);
      child.removeListener("exit", finish);
      child.removeListener("error", finish);
      resolve();
    };
    const timer = setTimeout(finish, duration);
    child.once("exit", finish);
    child.once("error", finish);
    if (hasExited(child)) finish();
  });
}

async function terminate(child: ChildProcess): Promise<void> {
  if (!child.pid || hasExited(child)) return;
  if (process.platform === "win32") {
    // Target only the process spawned for this lease, never an image name.
    const taskkill = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "taskkill.exe");
    await execFileAsync(taskkill, ["/PID", String(child.pid), "/T"], { windowsHide: true, timeout: 3_000 }).catch(() => {});
    await waitForExit(child, 500);
    if (!hasExited(child)) {
      await execFileAsync(taskkill, ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true, timeout: 3_000 }).catch(() => {});
      await waitForExit(child, 1_000);
    }
  } else {
    child.kill("SIGTERM");
    await waitForExit(child, 500);
    if (!hasExited(child)) child.kill("SIGKILL");
  }
}

async function findBrowser(deps: Dependencies, requireEdge = false): Promise<{ executable: string; brand: string }> {
  if (deps.platform !== "win32") throw new Error("Automatic Google browser routing currently requires Windows and Edge or Chrome.");
  const roots = [deps.env["ProgramFiles(x86)"], deps.env.ProgramFiles, deps.env.LOCALAPPDATA].filter((root): root is string => Boolean(root));
  for (const [brand, parts] of [
    ["edge", ["Microsoft", "Edge", "Application", "msedge.exe"]],
    ["chrome", ["Google", "Chrome", "Application", "chrome.exe"]],
  ] as const) {
    if (requireEdge && brand !== "edge") continue;
    for (const root of roots) {
      const executable = join(root, ...parts);
      try { if ((await lstat(executable)).isFile()) { await access(executable); return { executable, brand }; } }
      catch { /* Try the next standard installation location. */ }
    }
  }
  throw new Error(requireEdge
    ? "Automatic Antigravity sign-in requires an installed Microsoft Edge browser."
    : "Google sign-in requires an installed Microsoft Edge or Google Chrome browser.");
}

export function validateGoogleAuthUrl(value: string): string {
  if (value.length > 16_384 || /[\u0000-\u0020\u007f]/.test(value)) throw new Error("Invalid Google sign-in URL.");
  let url: URL;
  try { url = new URL(value); } catch { throw new Error("Invalid Google sign-in URL."); }
  if (url.protocol !== "https:" || url.hostname !== "accounts.google.com" || url.username || url.password || url.port) {
    throw new Error("Invalid Google sign-in URL.");
  }
  return url.href;
}

async function validateExtensionDirectory(directory: string): Promise<string> {
  // Chromium interprets commas as multiple extension directories. Never accept
  // shares, relative paths, links or command-line lists from the internal hook.
  if (!isAbsolute(directory) || /^[\\/]{2}/.test(directory) || /[,\u0000-\u001f\u007f]/.test(directory)) {
    throw new Error("The Google callback extension directory is invalid.");
  }
  const path = resolve(directory);
  for (let current = path; ; current = dirname(current)) {
    const info = await lstat(current);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("The Google callback extension must use a local directory.");
    if (dirname(current) === current) break;
  }
  const manifestPath = join(path, "manifest.json");
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 65_536) throw new Error("The Google callback extension manifest is invalid.");
  const manifest: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  if (!manifest || typeof manifest !== "object" || !("manifest_version" in manifest) || manifest.manifest_version !== 3) {
    throw new Error("The Google callback extension requires Manifest V3.");
  }
  return path;
}
/** A real browser with an app-owned profile; never reads another browser's cookies. */
export async function createGoogleAuthBrowser(options: {
  signal?: AbortSignal;
  /** Internal, per-login callback helper. Never taken from a browser API request. */
  extensionDirectory?: string;
  /** Internal extension-ready handshake, completed before the account URL opens. */
  beforeNavigate?: () => Promise<void>;
  /** The temporary helper navigates through the supported browser tabs API. */
  extensionNavigates?: boolean;
  /** Unexpected browser exit; explicit close and caller abort do not notify. */
  onClose?: () => void;
  dependencies?: Partial<Dependencies>;
} = {}) {
  const deps: Dependencies = {
    platform: process.platform, env: process.env, agentDir: getAgentDir,
    spawn, startProxy: startGoogleBrowserProxy, terminate, isRunning,
    ...options.dependencies,
  };
  options.signal?.throwIfAborted();
  if (options.extensionNavigates && (!options.extensionDirectory || !options.beforeNavigate)
    || options.beforeNavigate && !options.extensionNavigates) throw new Error("The Google browser navigation handshake is incomplete.");
  const root = resolve(deps.agentDir(), "momp-google-browser");
  const leases = state.__mompGoogleBrowserLeases ??= new Set();
  if (leases.has(root)) throw new Error("A momp Google sign-in window is already active.");
  leases.add(root);
  let release: (() => Promise<void>) | undefined;
  let proxy: BrowserProxy | undefined;
  let child: ChildProcess | undefined;
  const lifetime = new AbortController();
  let marker: string | undefined;
  let closing: Promise<void> | undefined;
  let opened = false;
  let closed = false;
  let compromised = false;
  let notifiedClose = false;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closed = true;
    lifetime.abort();
    options.signal?.removeEventListener("abort", abort);
    closing = (async () => {
      // Closing the route first prevents a lingering browser making more requests.
      await Promise.resolve().then(() => proxy?.close()).catch(() => {});
      if (child) await deps.terminate(child).catch(() => {});
      if (marker && child && hasExited(child)) await unlink(marker).catch(() => {});
      await release?.().catch(() => {});
      leases.delete(root);
    })();
    return closing;
  };
  const abort = () => { void close().catch(() => {}); };
  const unexpectedClose = () => {
    if (!closed && !notifiedClose) {
      notifiedClose = true;
      try { options.onClose?.(); } catch { /* Cleanup still owns this process. */ }
    }
    void close().catch(() => {});
  };
  try {
    const extension = options.extensionDirectory === undefined ? undefined : await validateExtensionDirectory(options.extensionDirectory);
    const browser = await findBrowser(deps, extension !== undefined);
    const profile = join(root, browser.brand);
    await mkdir(root, { recursive: true, mode: 0o700 });
    if ((await lstat(root)).isSymbolicLink()) {
      throw new Error("The momp Google browser profile must be a local directory.");
    }
    await mkdir(profile, { recursive: true, mode: 0o700 });
    if ((await lstat(profile)).isSymbolicLink()) {
      throw new Error("The momp Google browser profile must be a local directory.");
    }
    release = await lockfile.lock(profile, {
      realpath: true, retries: 0, stale: 30_000, update: 10_000,
      onCompromised: () => { compromised = true; if (proxy) unexpectedClose(); },
    }).catch(() => { throw new Error("Another momp instance is using the Google sign-in profile."); });
    const markerPath = join(profile, "momp-browser.pid");
    try {
      const info = await lstat(markerPath);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 32) throw new Error("The momp Google browser profile is locked.");
      const previous = Number((await readFile(markerPath, "utf8")).trim());
      if (!Number.isSafeInteger(previous) || previous < 1 || deps.isRunning(previous)) {
        throw new Error("Close the previous momp Google sign-in window, then try again.");
      }
      await unlink(markerPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    options.signal?.throwIfAborted();
    if (closed || compromised) throw new Error("Google sign-in was cancelled.");
    proxy = await deps.startProxy();
    if (closed || compromised) throw new Error("Google sign-in was cancelled.");
    const proxyUrl = new URL(proxy.url);
    if (proxyUrl.protocol !== "http:" || proxyUrl.hostname !== "127.0.0.1" || !proxyUrl.port || proxyUrl.username || proxyUrl.password) {
      throw new Error("The Google sign-in network route is unavailable.");
    }
    options.signal?.throwIfAborted();
    options.signal?.addEventListener("abort", abort, { once: true });
    return {
      async open(value: string): Promise<void> {
        const url = validateGoogleAuthUrl(value);
        if (closed || compromised || options.signal?.aborted) throw new Error("Google sign-in was cancelled.");
        if (opened) throw new Error("The Google sign-in browser has already been opened.");
        opened = true;
        try {
          const browserArgs = [
            "--user-data-dir=" + profile,
            "--proxy-server=" + proxyUrl.origin,
            "--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1, EXCLUDE [::1]",
            "--disable-quic", "--new-window", "--no-first-run", "--no-default-browser-check",
            ...(extension ? ["--load-extension=" + extension, "--disable-extensions-except=" + extension] : []),
          ];
          const spawnOptions = {
            shell: false, windowsHide: false, stdio: "ignore" as const,
            env: Object.fromEntries(Object.entries(deps.env).filter(([key]) => /^(?:path|pathext|systemroot|windir|appdata|localappdata|programdata|programfiles(?:\(x86\))?|commonprogramfiles(?:\(x86\))?|temp|tmp|userprofile|homedrive|homepath|username|comspec)$/i.test(key))) as NodeJS.ProcessEnv,
          };
          const launched = deps.spawn(browser.executable, [...browserArgs, options.extensionNavigates ? "about:blank" : url], spawnOptions);
          child = launched;
          // Always handle process errors, including errors after successful spawn.
          launched.on("error", unexpectedClose);
          await once(launched, "spawn");
          if (!launched.pid) throw new Error("Could not start the Google sign-in browser.");
          marker = markerPath;
          await writeFile(marker, String(launched.pid), { flag: "wx", mode: 0o600 });
          if (closed) {
            await deps.terminate(launched);
            if (hasExited(launched)) await unlink(marker).catch(() => {});
            throw new Error("Google sign-in was cancelled.");
          }
          // Chromium forwards to an already-running profile then exits. Do not
          // treat that as a successful launch or leave its stale route in use.
          await waitForExit(launched, 200);
          if (hasExited(launched) || closed) throw new Error("The Google sign-in browser closed before opening.");
          launched.once("exit", unexpectedClose);
          if (options.beforeNavigate) {
            let rejectClosed!: () => void;
            const stopped = new Promise<never>((_, reject) => {
              rejectClosed = () => reject(new Error("Google sign-in was cancelled."));
              lifetime.signal.addEventListener("abort", rejectClosed, { once: true });
            });
            try { await Promise.race([options.beforeNavigate(), stopped]); }
            finally { lifetime.signal.removeEventListener("abort", rejectClosed); }
            if (closed || hasExited(launched)) throw new Error("Google sign-in was cancelled.");
          }
        } catch {
          await close();
          throw new Error("Could not open the momp Google sign-in browser. Close its previous window and retry.");
        }
      },
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
