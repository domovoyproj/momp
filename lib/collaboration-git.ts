import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_FILE_BYTES = 48_000;
const MAX_CONTEXT_BYTES = 100_000;
const RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
const PRIVATE = /^(?:\.(?:git|env|ssh|gnupg|aws|codex|omp)(?:$|[.-])|\.gitattributes$|(?:auth|credentials|secrets)\.(?:json|ya?ml|toml)$)|\.(?:pem|key|pfx|p12|db|sqlite3?)$/i;

export interface SourceFile { path: string; content: string }

export function validateSourcePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 8) throw new Error("Select up to eight source files");
  const seen = new Set<string>();
  return value.map((path: unknown) => {
    if (typeof path !== "string" || path.length > 240 || !path || /[\\:*?"<>|\u0000-\u001f\u007f]/.test(path)
      || path.split("/").some((part) => !part || /[ .]$/.test(part) || RESERVED.test(part) || PRIVATE.test(part))) {
      throw new Error("Only project-relative source paths are allowed");
    }
    const key = path.normalize("NFC").toLowerCase();
    if (seen.has(key)) throw new Error("Duplicate source path");
    seen.add(key);
    return path;
  });
}

async function git(cwd: string, args: string[], signal?: AbortSignal): Promise<string> {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (/^git_/i.test(key)) delete env[key];
  const result = await exec("git", ["--no-pager", "--literal-pathspecs", ...args], {
    cwd, signal, encoding: "utf8", windowsHide: true, timeout: 15_000, maxBuffer: 512_000,
    env: { ...env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null", GIT_ATTR_NOSYSTEM: "1", GIT_NO_LAZY_FETCH: "1", GIT_NO_REPLACE_OBJECTS: "1", GIT_TERMINAL_PROMPT: "0" },
  });
  return result.stdout;
}

export async function readGitRoot(cwd: string): Promise<{ root: string; base: string }> {
  const root = (await git(cwd, ["rev-parse", "--show-toplevel"])).trimEnd();
  const base = (await git(root, ["rev-parse", "--verify", "HEAD^{commit}"])).trim();
  return { root, base };
}

export async function readSourceFiles(root: string, base: string, paths: string[], signal?: AbortSignal): Promise<SourceFile[]> {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(base)) throw new Error("Invalid Git baseline");
  const files: SourceFile[] = [];
  let total = 0;
  for (const path of validateSourcePaths(paths)) {
    const entry = await git(root, ["ls-tree", "-z", base, "--", path], signal);
    const match = /^100(?:644|755) blob ([0-9a-f]+)\t([^\0]+)\0$/.exec(entry);
    if (!match || match[2] !== path) throw new Error(`Select a tracked regular file: ${path}`);
    const size = Number(await git(root, ["cat-file", "-s", match[1]], signal));
    if (size > MAX_FILE_BYTES || (total += size) > MAX_CONTEXT_BYTES) throw new Error("Selected source exceeds the context limit");
    const content = await git(root, ["cat-file", "blob", match[1]], signal);
    if (content.includes("\0") || Buffer.byteLength(content) !== size || content.includes("\uFFFD")) {
      throw new Error(`Select a UTF-8 text file: ${path}`);
    }
    files.push({ path, content });
  }
  return files;
}

/** Render a Git diff in a disposable repository with no project hooks, config or index. */
export async function buildProposal(files: SourceFile[], replacements: SourceFile[], signal: AbortSignal) {
  const paths = validateSourcePaths(replacements.map(({ path }) => path));
  const original = new Map(files.map((file) => [file.path, file.content]));
  let total = 0;
  for (const { path, content } of replacements) {
    const size = Buffer.byteLength(content);
    if (!original.has(path) || content.includes("\0") || size > MAX_FILE_BYTES || (total += size) > MAX_CONTEXT_BYTES) {
      throw new Error("The proposal exceeds the selected files or size limit");
    }
  }
  if (paths.length === 0) return { diff: "", check: "skipped" as const };

  const cwd = await mkdtemp(join(tmpdir(), "momp-proposal-"));
  try {
    await git(cwd, ["init", "--quiet", "--template="], signal);
    for (const path of paths) {
      const target = join(cwd, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, original.get(path)!, { signal });
    }
    await git(cwd, ["-c", "core.autocrlf=false", "add", "--force", "--", ...paths], signal);
    for (const { path, content } of replacements) await writeFile(join(cwd, path), content, { signal });
    const diff = await git(cwd, ["-c", "core.autocrlf=false", "diff", "--no-ext-diff", "--no-textconv", "--"], signal);
    if (!diff) return { diff, check: "skipped" as const };
    try {
      await git(cwd, ["-c", "core.autocrlf=false", "diff", "--check", "--"], signal);
      return { diff, check: "passed" as const };
    } catch (error) {
      if (signal.aborted || (error as { code?: unknown }).code !== 2) throw error;
      return { diff, check: "failed" as const };
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
