import { NextResponse } from "next/server";
import { existsSync, mkdirSync } from "fs";
import { dirname, join } from "path";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { stringify as stringifyYaml } from "yaml";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { invalidateModelsCache } from "@/lib/models-cache";
import { invalidateOmpRuntime } from "@/lib/omp-runtime";
import { hasJsonContentType, isApiRequestAllowed } from "@/lib/request-security";
import { readModelsConfig } from "@/lib/models-config";
export const dynamic = "force-dynamic";

/**
 * Custom provider config lives in `~/.omp/agent/models.yml`.
 *
 * omp reads `models.yml` first and falls back to `models.yaml`; a legacy
 * `models.json` is migrated to YAML on first load. Read whichever exists, but
 * always write back to `models.yml` so the CLI and omp-web agree on one file.
 */
const CANONICAL_FILE = "models.yml";
function getWritePath(): string {
  return join(getAgentDir(), CANONICAL_FILE);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Drop blank model rows (empty/whitespace string ids) before persisting, but
// keep non-string ids and non-object entries so schema errors elsewhere stay
// visible to the user instead of being silently rewritten.
function sanitizeModelsConfig(data: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(data.providers)) return data;

  const providers = Object.fromEntries(Object.entries(data.providers).map(([providerId, provider]) => {
    if (!isRecord(provider) || !Array.isArray(provider.models)) return [providerId, provider];
    const models = provider.models.filter((model) => (
      !isRecord(model) || typeof model.id !== "string" || model.id.trim().length > 0
    ));
    return [providerId, { ...provider, models }];
  }));

  return { ...data, providers };
}

function writeModelsConfig(data: Record<string, unknown>): void {
  const path = getWritePath();
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writePrivateFileAtomicSync(path, stringifyYaml(sanitizeModelsConfig(data), { lineWidth: 0 }));
}

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  try {
    return NextResponse.json(readModelsConfig(getAgentDir()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to read models config" }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }
  if (!hasJsonContentType(req)) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }

  try {
    const body = await req.json() as unknown;
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return NextResponse.json({ error: "models config must be an object" }, { status: 400 });
    }
    const config = body as Record<string, unknown>;
    if (
      "providers" in config
      && (typeof config.providers !== "object" || config.providers === null || Array.isArray(config.providers))
    ) {
      return NextResponse.json({ error: "providers must be an object" }, { status: 400 });
    }
    writeModelsConfig(config);
    invalidateModelsCache();
    // The registry caches models.yml at construction; drop it so the next
    // request rebuilds against the edited providers.
    invalidateOmpRuntime();
    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Unable to save models config" }, { status: 500 });
  }
}
