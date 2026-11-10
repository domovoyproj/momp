import { stat } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { CollaborationRunner, collaborationFallback, parseCollaborationInput, type CollaborationInput, type CollaborationModel } from "@/lib/collaboration";
import { readBoundedJson } from "@/lib/bounded-json";
import { collaborationTestImage } from "@/lib/collaboration-checks";
import { readGitRoot } from "@/lib/collaboration-git";
import { antigravityExecutable, completeCollaboration, discoverAntigravityModels } from "@/lib/collaboration-providers";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { fetchUsageReportViews } from "@/lib/limits-checker";
import { getOmpRuntime } from "@/lib/omp-runtime";
import { getProjectTrustStatus } from "@/lib/project-trust";
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

async function assessSmartModels(input: CollaborationInput): Promise<CollaborationInput["exclusions"]> {
  const selected = [input.gpt, input.gemini].filter((model): model is CollaborationModel => Boolean(model));
  const [available, cli, usage] = await Promise.all([
    getOmpRuntime().then(({ modelRegistry }) => modelRegistry.getAvailable()).catch(() => []),
    selected.some(({ provider }) => provider === "antigravity-cli") ? antigravityExecutable() : undefined,
    selected.some(({ provider }) => provider === "openai-codex")
      ? Promise.race([fetchUsageReportViews().catch(() => []), Bun.sleep(3000).then(() => [])]) : [],
  ]);
  const now = Date.now();
  return selected.flatMap<NonNullable<CollaborationInput["exclusions"]>[number]>((model) => {
    const connected = model.provider === "antigravity-cli" ? Boolean(cli)
      : available.some(({ provider, id }) => model.provider === provider && model.id === id);
    if (!connected) return [{ model, reason: "unavailable" as const }];
    const reports = usage.filter((report) => report.provider === model.provider && report.fetchedAt > now - 120_000);
    const allAccountsLimited = reports.length > 0 && reports.every(({ limits }) => limits.some((limit) =>
      limit.source === "provider" && (!limit.modelId || limit.modelId === model.id) && (limit.resetsAt ?? 0) > now
      && (limit.status === "exhausted" || (limit.usedFraction ?? 0) >= 1)));
    return allAccountsLimited ? [{ model, reason: "quota" as const }] : [];
  });
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
    if (!id) return json({ tasks: runner.list(root), antigravityConfigured: Boolean(await antigravityExecutable()),
      testsConfigured: Boolean(collaborationTestImage()) && getProjectTrustStatus(root, getAgentDir()).trusted });
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
  try { body = await readBoundedJson(req, 64_000); } catch { return json({ error: "Invalid task request" }, 400); }
  const context = await projectContext(body.cwd);
  if (context.error) return context.error;
  const { root, base, runner } = context;
  try {
    if (body.action === "create") {
      const input = parseCollaborationInput(body);
      if (input.runTests && (!collaborationTestImage() || !getProjectTrustStatus(root, getAgentDir()).trusted)) {
        return json({ error: "Enable the isolated test runner and review project trust first" }, 409);
      }
      if (input.strategy === "smart") input.exclusions = await assessSmartModels(input);
      const task = await runner.create(root, base, input);
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
    if (body.action === "apply" || body.action === "rollback") {
      if (body.confirm !== true) return json({ error: "Changing the working files requires confirmation" }, 400);
      if (!getProjectTrustStatus(root, getAgentDir()).trusted) return json({ error: "Review project trust before changing the working files" }, 403);
      return json({ task: await runner.mutate(root, body.id, body.action === "rollback") });
    }
    if (body.action === "run" || body.action === "skip-review") {
      if (body.confirm !== true) return json({ error: "Task execution requires confirmation" }, 400);
      if (runner.get(root, body.id)?.runTests && !getProjectTrustStatus(root, getAgentDir()).trusted) {
        return json({ error: "Review project trust before running tests" }, 403);
      }
      return json({ task: runner.start(root, body.id, body.action === "skip-review") }, 202);
    }
    return json({ error: "Unsupported task action" }, 400);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ELOCKED") return json({ error: "A task or patch operation is already running" }, 409);
    return json({ error: error instanceof Error && !("code" in error) && !("stderr" in error)
      ? error.message : "Unable to process the task" }, 400);
  }
}
