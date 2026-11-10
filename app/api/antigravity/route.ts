import { realpath, stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { antigravityError, signInToAntigravity } from "@/lib/antigravity-acp";
import { AntigravitySessions } from "@/lib/antigravity-sessions";
import { readBoundedJson } from "@/lib/bounded-json";
import { antigravityExecutable } from "@/lib/collaboration-providers";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getProjectTrustStatus } from "@/lib/project-trust";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

function sessions() { return new AntigravitySessions(join(getAgentDir(), "momp-antigravity-v1")); }

async function project(value: unknown) {
  if (typeof value !== "string" || !isAbsolute(value)) return;
  if (!isExistingFilePathAllowed(value, await getAllowedFileRoots())) return;
  try {
    const cwd = await realpath(value);
    if ((await stat(cwd)).isDirectory()) return cwd;
  } catch { /* Workspace was removed. */ }
}

function streamThread(req: Request, store: AntigravitySessions, cwd: string, id: string) {
  const encoder = new TextEncoder();
  let cleanup = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      let revision = -1;
      let status = "";
      let lastFrame = Date.now();
      const tick = () => {
        if ((controller.desiredSize ?? 0) <= 0) return;
        try {
          const thread = store.get(cwd, id);
          if (!thread) return cleanup();
          if (thread.revision !== revision || thread.status !== status) {
            revision = thread.revision;
            status = thread.status;
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(thread)}\n\n`));
            lastFrame = Date.now();
          } else if (Date.now() - lastFrame > 15_000) {
            controller.enqueue(encoder.encode(": keep-alive\n\n"));
            lastFrame = Date.now();
          }
        } catch { cleanup(); }
      };
      const timer = setInterval(tick, 350);
      cleanup = () => {
        clearInterval(timer);
        req.signal.removeEventListener("abort", cleanup);
        try { controller.close(); } catch { /* Stream already ended. */ }
      };
      req.signal.addEventListener("abort", cleanup, { once: true });
      if (req.signal.aborted) cleanup();
      else tick();
    },
    cancel() { cleanup(); },
  });
  return new Response(body, { headers: {
    "Content-Type": "text/event-stream", "Cache-Control": "private, no-cache, no-transform", "X-Accel-Buffering": "no",
  } });
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return json({ error: "access" }, 403);
  const query = new URL(req.url).searchParams;
  const cwd = await project(query.get("cwd"));
  if (!cwd) return json({ error: "access" }, 403);
  const store = sessions();
  const id = query.get("id");
  try {
    if (!id) return json({ history: store.history(cwd), configured: Boolean(await antigravityExecutable()),
      trusted: getProjectTrustStatus(cwd, getAgentDir()).trusted });
    const thread = store.get(cwd, id);
    if (!thread) return json({ error: "unavailable" }, 404);
    return query.get("events") === "1" ? streamThread(req, store, cwd, id) : json({ thread });
  } catch { return json({ error: "unavailable" }, 400); }
}

declare global {
  var __mompAntigravitySignIn: Promise<void> | undefined;
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return json({ error: "access" }, 403);
  if (!hasJsonContentType(req)) return json({ error: "invalid" }, 415);
  let body: Record<string, unknown>;
  try { body = await readBoundedJson(req, 120_000); } catch { return json({ error: "invalid" }, 400); }
  const cwd = await project(body.cwd);
  if (!cwd) return json({ error: "access" }, 403);
  const store = sessions();
  const id = typeof body.id === "string" ? body.id : undefined;
  const { action } = body;
  try {
    if (action === "sign-in") {
      // Google's authorization opens on the machine that runs momp.
      if (!/^(?:localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.get("host") ?? "")) return json({ error: "local-sign-in" }, 403);
      const executable = await antigravityExecutable();
      if (!executable) return json({ error: "not-installed" }, 503);
      const login = globalThis.__mompAntigravitySignIn ??= signInToAntigravity(executable);
      try { await login; } finally { if (globalThis.__mompAntigravitySignIn === login) globalThis.__mompAntigravitySignIn = undefined; }
      return json({ ok: true });
    }
    const safeToStop = action === "cancel" || action === "disconnect" || action === "permission" && body.allow === false;
    if (!safeToStop && !getProjectTrustStatus(cwd, getAgentDir()).trusted) return json({ error: "trust" }, 403);
    if (action === "open") {
      if (body.confirm !== true) return json({ error: "confirm" }, 400);
      const executable = await antigravityExecutable();
      if (!executable) return json({ error: "not-installed" }, 503);
      return json({ thread: store.open(cwd, executable, id) }, 202);
    }
    if (!id) return json({ error: "invalid" }, 400);
    const worker = store.active(cwd, id);
    if (action === "prompt" && typeof body.text === "string") worker.send(body.text.trim());
    else if (action === "config" && typeof body.key === "string" && typeof body.value === "string") await worker.setOption(body.key, body.value);
    else if (action === "permission" && typeof body.permission === "string" && typeof body.allow === "boolean") worker.decide(body.permission, body.allow);
    else if (action === "cancel") worker.cancel();
    else if (action === "disconnect") worker.disconnect();
    else return json({ error: "invalid" }, 400);
    return json({ thread: store.get(cwd, id) }, 202);
  } catch (error) {
    return json({ error: (error as NodeJS.ErrnoException)?.code === "ELOCKED" ? "busy" : antigravityError(error) }, 409);
  }
}
