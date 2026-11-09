import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { CollaborationRunner, collaborationFallback, parseCollaborationInput } from "@/lib/collaboration";
import { readGitRoot } from "@/lib/collaboration-git";
import { antigravityExecutable, completeCollaboration, discoverAntigravityModels } from "@/lib/collaboration-providers";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

function json(data: unknown, status = 200) {
  return Response.json(data, { status, headers: { "Cache-Control": "private, no-store" } });
}

async function projectContext(cwd: unknown) {
  if (typeof cwd !== "string" || !isAbsolute(cwd)) return { error: json({ error: "Choose a Git project" }, 400) };
  const roots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, roots)) return { error: json({ error: "Access denied" }, 403) };
  try {
    if (!(await stat(cwd)).isDirectory()) throw new Error();
    const project = await readGitRoot(cwd);
    if (!isExistingFilePathAllowed(project.root, roots)) return { error: json({ error: "Access denied" }, 403) };
    return { ...project, runner: new CollaborationRunner(join(getAgentDir(), "momp-collaboration-v1"), completeCollaboration) };
  } catch {
    return { error: json({ error: "Choose a Git project with at least one commit" }, 400) };
  }
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  const reader = req.body?.getReader();
  if (!reader) throw new Error("Missing request body");
  let size = 0;
  const parts: Uint8Array[] = [];
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 64_000) {
        await reader.cancel();
        throw new Error("Task request exceeds the size limit");
      }
      parts.push(value);
    }
    const parsed = JSON.parse(Buffer.concat(parts).toString("utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("Invalid task request");
    return parsed;
  } finally {
    reader.releaseLock();
  }
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) return json({ error: "Untrusted API request" }, 403);
  const query = new URL(req.url).searchParams;
  const context = await projectContext(query.get("cwd"));
  if (context.error) return context.error;
  const { root, runner } = context;
  try {
    if (query.get("antigravityModels") === "1") return json({ models: await discoverAntigravityModels() });
    const id = query.get("id");
    if (!id) return json({ tasks: runner.list(root), antigravityConfigured: Boolean(await antigravityExecutable()) });
    const task = runner.get(root, id);
    return task ? json({ task }) : json({ error: "Task not found" }, 404);
  } catch {
    return json({ error: query.has("antigravityModels") ? "Unable to read the CLI model list" : "Unable to read the task" }, 400);
  }
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) return json({ error: "Untrusted API request" }, 403);
  if (!hasJsonContentType(req)) return json({ error: "Content-Type must be application/json" }, 415);
  let body: Record<string, unknown>;
  try { body = await readBody(req); } catch { return json({ error: "Invalid task request" }, 400); }
  const context = await projectContext(body.cwd);
  if (context.error) return context.error;
  const { root, base, runner } = context;
  try {
    if (body.action === "create") {
      const task = await runner.create(root, base, parseCollaborationInput(body));
      return json({ task }, 201);
    }
    if (typeof body.id !== "string") return json({ error: "Task ID is required" }, 400);
    if (body.action === "prepare-fallback") {
      const source = runner.get(root, body.id);
      const fallback = source && collaborationFallback(source);
      if (!source || !fallback) return json({ error: "No alternate lead for this task" }, 409);
      return json({ task: await runner.create(root, source.base, fallback) }, 201);
    }
    if (body.action === "cancel") {
      return runner.cancel(root, body.id) ? json({ ok: true }, 202) : json({ error: "Task is not running in this process" }, 409);
    }
    if (body.action === "run" || body.action === "skip-review") {
      if (body.confirm !== true) return json({ error: "Task execution requires confirmation" }, 400);
      return json({ task: runner.start(root, body.id, body.action === "skip-review") }, 202);
    }
    return json({ error: "Unsupported task action" }, 400);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") return json({ error: "Task is already running" }, 409);
    return json({ error: error instanceof Error && !("code" in error) && !("stderr" in error)
      ? error.message : "Unable to process the task" }, 400);
  }
}
