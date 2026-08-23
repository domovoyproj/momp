import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { writePrivateFileAtomicSync } from "@/lib/atomic-file";
import { invalidateModelsCache } from "@/lib/models-cache";
import { invalidateOmpRuntime } from "@/lib/omp-runtime";
import { isApiRequestAllowed } from "@/lib/request-security";

export const dynamic = "force-dynamic";

interface DiscoveredService {
  id: string;
  name: string;
  baseUrl: string;
  api: string;
  models: Array<{ id: string; name: string }>;
}

const DISCOVERY_PROBES = [
  {
    id: "ollama",
    name: "Ollama",
    baseUrl: "http://127.0.0.1:11434",
    endpoint: "http://127.0.0.1:11434/api/tags",
    api: "ollama",
    parse: (data: unknown) => {
      if (typeof data !== "object" || data === null) return [];
      const models = (data as { models?: Array<{ name?: string; model?: string }> }).models;
      if (!Array.isArray(models)) return [];
      return models
        .map((m) => {
          const id = m.name || m.model || "";
          return id ? { id, name: id } : null;
        })
        .filter((m): m is { id: string; name: string } => m !== null);
    },
  },
  {
    id: "lm-studio",
    name: "LM Studio",
    baseUrl: "http://127.0.0.1:1234/v1",
    endpoint: "http://127.0.0.1:1234/v1/models",
    api: "openai-completions",
    parse: (data: unknown) => {
      if (typeof data !== "object" || data === null) return [];
      const models = (data as { data?: Array<{ id?: string }> }).data;
      if (!Array.isArray(models)) return [];
      return models
        .map((m) => {
          const id = m.id || "";
          return id ? { id, name: id } : null;
        })
        .filter((m): m is { id: string; name: string } => m !== null);
    },
  },
  {
    id: "vllm-local",
    name: "vLLM / LocalAI",
    baseUrl: "http://127.0.0.1:8000/v1",
    endpoint: "http://127.0.0.1:8000/v1/models",
    api: "openai-completions",
    parse: (data: unknown) => {
      if (typeof data !== "object" || data === null) return [];
      const models = (data as { data?: Array<{ id?: string }> }).data;
      if (!Array.isArray(models)) return [];
      return models
        .map((m) => {
          const id = m.id || "";
          return id ? { id, name: id } : null;
        })
        .filter((m): m is { id: string; name: string } => m !== null);
    },
  },
];

export async function GET(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  const results: DiscoveredService[] = [];

  await Promise.all(
    DISCOVERY_PROBES.map(async (probe) => {
      try {
        const res = await fetch(probe.endpoint, {
          cache: "no-store",
          signal: AbortSignal.timeout(2500),
        });
        if (!res.ok) return;
        const data = await res.json();
        const models = probe.parse(data);
        if (models.length > 0) {
          results.push({
            id: probe.id,
            name: probe.name,
            baseUrl: probe.baseUrl,
            api: probe.api,
            models,
          });
        }
      } catch {
        // Service not running or unreachable
      }
    })
  );

  return NextResponse.json({ services: results });
}

export async function POST(req: Request) {
  if (!isApiRequestAllowed(req)) {
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  try {
    const body = (await req.json()) as {
      providerId?: string;
      baseUrl?: string;
      api?: string;
      models?: Array<{ id: string; name?: string }>;
    };

    const providerId = body.providerId?.trim();
    const baseUrl = body.baseUrl?.trim();
    const api = body.api?.trim() || "openai-completions";
    const models = Array.isArray(body.models) ? body.models : [];

    if (!providerId || !baseUrl || models.length === 0) {
      return NextResponse.json({ error: "Missing required provider information" }, { status: 400 });
    }

    const agentDir = getAgentDir();
    const modelsPath = join(agentDir, "models.yml");

    let currentConfig: Record<string, unknown> = { providers: {} };
    if (existsSync(modelsPath)) {
      try {
        const parsed = parseYaml(readFileSync(modelsPath, "utf8"));
        if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
          currentConfig = parsed as Record<string, unknown>;
        }
      } catch {
        // use default
      }
    }

    const currentProviders = (
      typeof currentConfig.providers === "object" && currentConfig.providers !== null
        ? currentConfig.providers
        : {}
    ) as Record<string, Record<string, unknown>>;

    const existingProvider = currentProviders[providerId] || {};
    const existingModels = (Array.isArray(existingProvider.models) ? existingProvider.models : []) as Array<{ id: string; name?: string }>;
    const existingIds = new Set(existingModels.map((m) => m.id));

    const mergedModels = [...existingModels];
    for (const m of models) {
      if (!existingIds.has(m.id)) {
        existingIds.add(m.id);
        mergedModels.push({ id: m.id, ...(m.name && m.name !== m.id ? { name: m.name } : {}) });
      }
    }

    currentProviders[providerId] = {
      ...existingProvider,
      baseUrl,
      api,
      models: mergedModels,
    };

    currentConfig.providers = currentProviders;

    writePrivateFileAtomicSync(modelsPath, stringifyYaml(currentConfig));
    invalidateModelsCache();
    invalidateOmpRuntime();

    return NextResponse.json({ success: true, providerId, addedCount: mergedModels.length });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to save local provider";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
