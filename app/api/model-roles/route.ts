import { cfgEnabledModels } from "@oh-my-pi/pi-coding-agent/config/model-settings";
import { NextResponse } from "next/server";
import { resolve } from "path";
import { invalidateModelsCache } from "@/lib/models-cache";
import { getAllowedFileRoots, isExistingFilePathAllowed } from "@/lib/file-access";
import { getOmpRuntime, getSettingsForCwd } from "@/lib/omp-runtime";
import { listModelRoles, writeModelRole, type ModelRoleScope } from "@/lib/model-roles";
import { resolveVisibleModels } from "@/lib/model-scope";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { createModelRolePreset } from "@/lib/model-role-presets";

export const dynamic = "force-dynamic";

async function requireAllowedCwd(rawCwd: string | null): Promise<{ cwd: string } | { error: NextResponse }> {
  if (!rawCwd) return { error: NextResponse.json({ error: "cwd required" }, { status: 400 }) };
  const cwd = resolve(rawCwd);
  const allowedRoots = await getAllowedFileRoots();
  if (!isExistingFilePathAllowed(cwd, allowedRoots)) {
    return { error: NextResponse.json({ error: "Access denied" }, { status: 403 }) };
  }
  return { cwd };
}

// GET /api/model-roles?cwd=<path> — every role omp knows, with its assignment.
export async function GET(req: Request) {
  const result = await requireAllowedCwd(new URL(req.url).searchParams.get("cwd"));
  if ("error" in result) return result.error;

  try {
    const { modelRegistry } = await getOmpRuntime();
    const settings = await getSettingsForCwd(result.cwd);
    const { visible } = await resolveVisibleModels(modelRegistry, cfgEnabledModels.get(settings), settings);
    return NextResponse.json({ roles: listModelRoles(settings, [...visible]) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}

/**
 * PUT /api/model-roles  body: { cwd, role, selector, scope }
 *
 * `selector` is omp's own model-role syntax — `provider/modelId` with an
 * optional `:thinkingLevel` suffix — so a value written here reads back
 * identically in `omp`'s `/model` selector. `selector: null` clears the role at
 * that layer and lets the next layer down take over.
 */
export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as {
      cwd?: string;
      role?: string;
      selector?: string | null;
      scope?: ModelRoleScope;
      preset?: string;
      gpt?: string;
      gemini?: string;
    };
    const result = await requireAllowedCwd(body.cwd ?? null);
    if ("error" in result) return result.error;

    const role = body.role?.trim();
    if (!role && !body.preset) return NextResponse.json({ error: "role or preset required" }, { status: 400 });
    const scope: ModelRoleScope = body.scope === "project" ? "project" : "global";
    const selector = typeof body.selector === "string" ? body.selector.trim() : undefined;

    const runtime = await getOmpRuntime();
    const settingsToWrite = scope === "global"
      ? runtime.settings
      : await getSettingsForCwd(result.cwd);
    if (body.preset) {
      let assignments: Record<string, string>;
      try {
        assignments = createModelRolePreset(body.preset, body.gpt ?? "", body.gemini ?? "");
      } catch (error) {
        return NextResponse.json({ error: String(error) }, { status: 400 });
      }
      const projectSettings = await getSettingsForCwd(result.cwd);
      const { visible } = await resolveVisibleModels(runtime.modelRegistry, cfgEnabledModels.get(projectSettings), projectSettings);
      const available = new Set(visible.map(model => `${model.provider}/${model.id}`));
      if (Object.values(assignments).some(value => !available.has(value))) {
        return NextResponse.json({ error: "Selected models are not available. Connect both providers and refresh." }, { status: 400 });
      }
      for (const [roleId, model] of Object.entries(assignments)) writeModelRole(settingsToWrite, roleId, model, scope);
    } else {
      writeModelRole(settingsToWrite, role!, selector || undefined, scope);
    }
    await settingsToWrite.flush();
    invalidateModelsCache();

    // Global roles are written through the canonical process-wide Settings
    // instance; re-scope after the flush so project overrides are reflected in
    // the response and in the next modal load.
    const settings = await getSettingsForCwd(result.cwd);
    const { modelRegistry } = runtime;
    const { visible } = await resolveVisibleModels(modelRegistry, cfgEnabledModels.get(settings), settings);
    return NextResponse.json({ roles: listModelRoles(settings, [...visible]) });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : String(error) }, { status: 500 });
  }
}
