import { execFile } from "node:child_process";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { completeSimple } from "@oh-my-pi/pi-ai";
import { CollaborationFailure, type CollaborationTransport } from "./collaboration";
import { getOmpRuntime } from "./omp-runtime";

const QUOTA = /(?:resource_exhausted|insufficient_quota|rate.limit|\b429\b|usage limit)/i;
const AUTH = /(?:not authenticated|authentication required|not logged in|login required|unauthorized|invalid_grant|no api key|\b401\b|\b403\b)/i;
const exec = promisify(execFile);

export type AntigravityUsage = { status: "ready"; fetchedAt: number; rows: string[][] } | { status: "unavailable" };

function providerFailure(message: string) {
  if (QUOTA.test(message)) return new CollaborationFailure("quota");
  if (AUTH.test(message)) return new CollaborationFailure("unavailable");
  return new CollaborationFailure("failed");
}

export function readAntigravityResult(stdout: string, stderr: string, failed: boolean): string {
  let result: { status?: unknown; response?: unknown; error?: unknown; finished_reason?: unknown } | undefined;
  for (const line of stdout.split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event?.event === "result") result = event.result;
    } catch {
      throw new CollaborationFailure("invalid-output");
    }
  }
  if (failed || result?.status === "ERROR") {
    throw providerFailure(typeof result?.error === "string" ? result.error : stderr);
  }
  if (result?.status !== "SUCCESS" || result.finished_reason || typeof result.response !== "string" || !result.response.trim()) {
    throw new CollaborationFailure("invalid-output");
  }
  return result.response;
}

export async function antigravityExecutable(): Promise<string | undefined> {
  const executable = process.env.MOMP_ANTIGRAVITY_CLI;
  if (!executable || !isAbsolute(executable) || (process.platform === "win32" && !/\.exe$/i.test(executable))) return undefined;
  try {
    await access(executable);
    return executable;
  } catch {
    return undefined;
  }
}

async function readAntigravityCommand(executable: string, args: string[]): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "momp-agy-status-"));
  try {
    const { stdout } = await exec(executable, args, { cwd, windowsHide: true, timeout: 10_000, maxBuffer: 64_000, encoding: "utf8" });
    return stdout;
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export function parseAntigravityModels(stdout: string): Array<{ id: string; name: string }> {
  const models = new Map<string, string>();
  for (const line of stdout.split(/\r?\n/)) {
    const match = /^\s*(gemini-[a-z0-9._-]+)(?:\t| {2,})([^\r\n]+)\s*$/i.exec(line);
    if (match && models.size < 200) models.set(match[1], match[2].trim().slice(0, 160));
  }
  return [...models].map(([id, name]) => ({ id, name }));
}

export async function discoverAntigravityModels() {
  const executable = await antigravityExecutable();
  if (!executable) return [];
  return parseAntigravityModels(await readAntigravityCommand(executable, ["models"]));
}

export function supportsAntigravityMetadata(version: string): boolean {
  const match = /^(?:agy(?: version)?\s+)?v?(\d+\.\d+\.\d+)(?:\s|$)/i.exec(version.trim());
  return Boolean(match && Bun.semver.satisfies(match[1], ">=1.5.0"));
}

export function parseAntigravityUsage(stdout: string): string[][] {
  return stdout.split(/\r?\n/).filter((line) => line.includes("\t")).slice(0, 60)
    .map((line) => line.split("\t", 12).map((column) => column.trim().slice(0, 240)));
}

let antigravityUsageCache: { executable: string; expiresAt: number; value: Promise<AntigravityUsage> } | undefined;
export async function fetchAntigravityUsage(): Promise<AntigravityUsage | undefined> {
  const executable = await antigravityExecutable();
  if (!executable) return undefined;
  if (antigravityUsageCache?.executable === executable && antigravityUsageCache.expiresAt > Date.now()) return antigravityUsageCache.value;
  const value = (async (): Promise<AntigravityUsage> => {
    try {
      // Older CLIs could treat unsupported slash commands as an inference prompt.
      if (!supportsAntigravityMetadata(await readAntigravityCommand(executable, ["--version"]))) return { status: "unavailable" };
      const output = await readAntigravityCommand(executable, ["-p", "/usage", "--output-format", "text", "--print-timeout", "8s"]);
      const rows = parseAntigravityUsage(output);
      return rows.length ? { status: "ready", rows, fetchedAt: Date.now() } : { status: "unavailable" };
    } catch {
      return { status: "unavailable" };
    }
  })();
  antigravityUsageCache = { executable, expiresAt: Date.now() + 45_000, value };
  return value;
}

async function completeWithAntigravity(model: string, prompt: string, signal: AbortSignal) {
  const executable = await antigravityExecutable();
  if (!executable) throw new CollaborationFailure("unavailable");
  const cwd = await mkdtemp(join(tmpdir(), "momp-antigravity-"));
  try {
    return await new Promise<string>((resolve, reject) => {
      const child = execFile(executable, [
        "--input-format", "stream-json", "--output-format", "stream-json", "--model", model,
        "--mode", "plan", "--sandbox", "--disable-slash-commands", "--print-timeout", "165s",
      ], { cwd, signal, windowsHide: true, maxBuffer: 750_000 }, (error, stdout, stderr) => {
        if (signal.aborted || error && typeof error.code === "string") {
          reject(new CollaborationFailure("unavailable"));
          return;
        }
        try {
          resolve(readAntigravityResult(stdout, stderr, Boolean(error)));
        } catch (failure) {
          reject(failure);
        }
      });
      child.stdin?.on("error", () => {});
      child.stdin?.end(JSON.stringify({ event: "user", message: { content: prompt } }) + "\n");
    });
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

export const completeCollaboration: CollaborationTransport = async (selection, prompt, signal) => {
  if (selection.provider === "antigravity-cli") return completeWithAntigravity(selection.id, prompt, signal);
  const { modelRegistry } = await getOmpRuntime();
  const model = modelRegistry.find(selection.provider, selection.id);
  if (!model) throw new CollaborationFailure("unavailable");
  const auth = await modelRegistry.getApiKeyAndHeaders(model);
  if (!auth.ok) throw providerFailure(auth.error);
  if (!auth.apiKey) throw new CollaborationFailure("unavailable");
  signal.throwIfAborted();
  const rateLimit = new AbortController();
  const response = await completeSimple(model, {
    messages: [{ role: "user", content: prompt, timestamp: Date.now() }],
  }, {
    apiKey: auth.apiKey, headers: auth.headers, cacheRetention: "none",
    maxTokens: 10_000, maxRetryDelayMs: 1, signal: AbortSignal.any([signal, rateLimit.signal]),
    onResponse: ({ status }) => { if (status === 429) rateLimit.abort(); },
  });
  if (rateLimit.signal.aborted) throw new CollaborationFailure("quota");
  if (response.stopReason === "error" || response.stopReason === "aborted") throw providerFailure(response.errorMessage ?? "");
  const text = response.content.flatMap((block) => block.type === "text" ? [block.text] : []).join("");
  if (!text.trim() || response.stopReason === "length") throw new CollaborationFailure("invalid-output");
  return text;
};
