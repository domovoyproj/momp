import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ClientSideConnection, ndJsonStream, PROTOCOL_VERSION, type Client } from "@oh-my-pi/pi-utils/acp";
import type { AntigravityError } from "./antigravity-types";
import { antigravityNetworkEnv, xboxDnsEnabled } from "./google-network";

export class AntigravityFailure extends Error {
  constructor(readonly kind: AntigravityError) { super(kind); }
}

export function antigravityError(error: unknown): AntigravityError {
  if (error instanceof AntigravityFailure) return error.kind;
  if (!(error instanceof Error)) return "unavailable";
  const code = "code" in error ? error.code : undefined;
  if (code === -32000 || /authentication required|not logged in|invalid_grant|unauthenticated/i.test(error.message)) return "auth-required";
  if (code === 429 || /resource.exhausted|rate.limit|quota|\b429\b/i.test(error.message)) return "quota";
  if (code === -32601) return "unsupported";
  if (code === -32800) return "cancelled";
  return "unavailable";
}

export function withAcpDeadline<T>(operation: Promise<T>, duration: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    operation,
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new AntigravityFailure("timeout")), duration);
      timer.unref();
    }),
  ]).finally(() => clearTimeout(timer));
}

function boundFrames(): TransformStream<Uint8Array, Uint8Array> {
  let size = 0;
  return new TransformStream({
    transform(chunk, controller) {
      for (const byte of chunk) {
        size = byte === 10 ? 0 : size + 1;
        if (size > 1_048_576) throw new AntigravityFailure("unavailable");
      }
      controller.enqueue(chunk);
    },
  });
}

// The CLI keeps its own Google credentials. Give its tools the OS environment
// needed to run, without inheriting the web server's provider keys or tokens.
const ENVIRONMENT = /^(?:path|pathext|home|userprofile|homedrive|homepath|username|user|logname|shell|comspec|systemroot|windir|appdata|localappdata|programdata|programfiles(?:\(x86\))?|commonprogramfiles(?:\(x86\))?|temp|tmp|tmpdir|lang|lc_[a-z_]+|xdg_(?:config|data|cache|runtime)_home|xdg_runtime_dir|display|wayland_display|dbus_session_bus_address|https?_proxy|no_proxy|ssl_cert_file|ssl_cert_dir)$/i;

export function launchAntigravity(executable: string, cwd: string, client: Client, args = ["acp", "--sandbox"]) {
  const env = Object.fromEntries(Object.entries(antigravityNetworkEnv(process.env)).filter(([key]) => ENVIRONMENT.test(key)));
  const child = Bun.spawn([executable, ...args], { cwd, env, stdin: "pipe", stdout: "pipe", stderr: "ignore", windowsHide: true });
  const output = new WritableStream<Uint8Array>({
    async write(chunk) {
      child.stdin.write(chunk);
      await child.stdin.flush();
    },
    async close() { await child.stdin.end(); },
  });
  const connection = new ClientSideConnection(() => client, ndJsonStream(output, child.stdout.pipeThrough(boundFrames())));
  return {
    connection,
    closed: connection.closed,
    exited: child.exited,
    initialize: async () => {
      const response = await withAcpDeadline(connection.initialize({
        protocolVersion: PROTOCOL_VERSION, clientCapabilities: {},
        clientInfo: { name: "momp", title: "momp", version: "1" },
      }), 12_000);
      if (response?.protocolVersion !== PROTOCOL_VERSION) throw new AntigravityFailure("unsupported");
      return response;
    },
    stop: () => { child.kill(); },
  };
}

export async function signInToAntigravity(executable: string, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new AntigravityFailure("cancelled");
  if (xboxDnsEnabled()) {
    const { signInToAntigravityBrowser, AntigravityBrowserLoginError } = await import("./antigravity-browser-login");
    try { return await signInToAntigravityBrowser(executable, signal); }
    catch (error) {
      throw new AntigravityFailure(error instanceof AntigravityBrowserLoginError ? error.kind : "unavailable");
    }
  }
  const cwd = await mkdtemp(join(tmpdir(), "momp-agy-auth-"));
  let agent: ReturnType<typeof launchAntigravity> | undefined;
  const abort = () => agent?.stop();
  try {
    signal?.throwIfAborted();
    agent = launchAntigravity(executable, cwd, {
      requestPermission: () => ({ outcome: { outcome: "cancelled" } }),
      sessionUpdate: () => {},
    });
    signal?.addEventListener("abort", abort, { once: true });
    const initialization = await agent.initialize();
    if (!initialization.authMethods?.some((method) => method.id === "oauth-personal")) throw new AntigravityFailure("unsupported");
    await withAcpDeadline(agent.connection.authenticate({ methodId: "oauth-personal" }), 180_000);
  } catch (error) {
    if (signal?.aborted) throw new AntigravityFailure("cancelled");
    throw error;
  } finally {
    signal?.removeEventListener("abort", abort);
    agent?.stop();
    if (agent) await withAcpDeadline(agent.exited, 4000).catch(() => {});
    await rm(cwd, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 });
  }
}
