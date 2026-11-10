import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rm, stat, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

const exec = promisify(execFile);
const MAX_FILE_BYTES = 48_000;
const MAX_CONTEXT_BYTES = 100_000;
const RESERVED = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;
const PRIVATE = /^(?:\.(?:git|ssh|gnupg|aws|codex|omp|gemini|antigravity)(?:$|[.-])|\.env|\.gitattributes$|\.npmrc$|\.netrc$|git~\d|(?:auth|credentials|secrets)\.(?:json|ya?ml|toml)$)|\.(?:pem|key|pfx|p12|db|sqlite3?)$/i;
export const MAX_COLLABORATION_FILES = 16;

export interface SourceFile { path: string; content: string | null; executable?: boolean }
export interface ProposalFile { path: string; before: string | null; after: string | null }

function fileDigest(content: string | Buffer | null): string | null {
  return content === null ? null : createHash("sha256").update(content).digest("hex");
}

export function validateSourcePaths(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > MAX_COLLABORATION_FILES) throw new Error("Select up to sixteen source files");
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

export async function readSourceFiles(root: string, base: string, paths: string[], signal?: AbortSignal, allowNewFiles = false): Promise<SourceFile[]> {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/.test(base)) throw new Error("Invalid Git baseline");
  const files: SourceFile[] = [];
  let total = 0;
  for (const path of validateSourcePaths(paths)) {
    const entry = await git(root, ["ls-tree", "-z", base, "--", path], signal);
    if (!entry && allowNewFiles) {
      files.push({ path, content: null });
      continue;
    }
    const match = /^100(644|755) blob ([0-9a-f]+)\t([^\0]+)\0$/.exec(entry);
    if (!match || match[3] !== path) throw new Error(`Select a tracked regular file: ${path}`);
    const size = Number(await git(root, ["cat-file", "-s", match[2]], signal));
    if (size > MAX_FILE_BYTES || (total += size) > MAX_CONTEXT_BYTES) throw new Error("Selected source exceeds the context limit");
    const content = await git(root, ["cat-file", "blob", match[2]], signal);
    if (content.includes("\0") || Buffer.byteLength(content) !== size || content.includes("\uFFFD")) {
      throw new Error(`Select a UTF-8 text file: ${path}`);
    }
    files.push({ path, content, ...(match[1] === "755" && { executable: true }) });
  }
  return files;
}

/** Render a Git diff in a disposable repository with no project hooks, config or index. */
export async function buildProposal(files: SourceFile[], replacements: SourceFile[], signal: AbortSignal) {
  validateSourcePaths(replacements.map(({ path }) => path));
  const original = new Map(files.map((file) => [file.path, file]));
  let total = 0;
  for (const { path, content } of replacements) {
    const size = content === null ? 0 : Buffer.byteLength(content);
    if (!original.has(path) || content?.includes("\0") || size > MAX_FILE_BYTES || (total += size) > MAX_CONTEXT_BYTES) {
      throw new Error("The proposal exceeds the selected files or size limit");
    }
  }
  const changes = replacements.filter(({ path, content }) => original.get(path)!.content !== content);
  const manifest = changes.map(({ path, content }) => ({ path, before: fileDigest(original.get(path)!.content), after: fileDigest(content) }));
  if (!changes.length) return { diff: "", check: "skipped" as const, files: manifest };

  const cwd = await mkdtemp(join(tmpdir(), "momp-proposal-"));
  try {
    await git(cwd, ["init", "--quiet", "--template="], signal);
    for (const { path } of changes) {
      const source = original.get(path)!;
      const target = join(cwd, path);
      await mkdir(dirname(target), { recursive: true });
      if (source.content === null) continue;
      await writeFile(target, source.content, { signal, mode: source.executable ? 0o755 : 0o644 });
      await git(cwd, ["-c", "core.autocrlf=false", "add", "--force", "--", path], signal);
      if (source.executable) await git(cwd, ["update-index", "--chmod=+x", "--", path], signal);
    }
    for (const { path, content } of changes) {
      const target = join(cwd, path);
      if (content === null) await unlink(target);
      else {
        await writeFile(target, content, { signal });
        if (original.get(path)!.content === null) await git(cwd, ["add", "--force", "--intent-to-add", "--", path], signal);
      }
    }
    const diff = await git(cwd, ["-c", "core.autocrlf=false", "diff", "--no-ext-diff", "--no-textconv", "--no-renames", "--text", "--"], signal);
    if (!diff) throw new Error("Git did not produce a patch for the selected changes");
    try {
      await git(cwd, ["-c", "core.autocrlf=false", "diff", "--check", "--"], signal);
      return { diff, check: "passed" as const, files: manifest };
    } catch (error) {
      if (signal.aborted || (error as { code?: unknown }).code !== 2) throw error;
      return { diff, check: "failed" as const, files: manifest };
    }
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

async function worktreeDigest(root: string, path: string): Promise<string | null> {
  let target = root;
  const parts = path.split("/");
  for (const [index, part] of parts.entries()) {
    target = join(target, part);
    try {
      const entry = await lstat(target);
      if (entry.isSymbolicLink()) throw new Error("A proposal path is a symbolic link");
      if (index < parts.length - 1 && !entry.isDirectory()) throw new Error("A proposal path has a non-directory parent");
      if (index === parts.length - 1 && (!entry.isFile() || entry.size > MAX_FILE_BYTES)) throw new Error("A proposal path is not an eligible regular file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
  return fileDigest(await readFile(target));
}

export async function applyProposal(root: string, base: string, diff: string, files: ProposalFile[], reverse: boolean,
  resume: boolean, checkpoint: () => void, signal: AbortSignal): Promise<void> {
  const paths = validateSourcePaths(files.map(({ path }) => path));
  if (!paths.length || !diff) throw new Error("The proposal has no changes");
  if ((await readGitRoot(root)).base !== base) throw new Error("The project HEAD changed. Download and review the patch manually");
  const baseline = await git(root, ["ls-tree", "-z", base, "--", ...paths], signal);
  const staged = await git(root, ["ls-files", "--stage", "-z", "--", ...paths], signal);
  const expected = baseline.replace(/(^|\0)(100\d{3}) blob ([0-9a-f]+)\t/g, "$1$2 $3 0\t");
  if (staged !== expected) throw new Error("The proposal overlaps staged changes");
  const previous = reverse ? "after" : "before";
  const target = reverse ? "before" : "after";
  const matches = async (side: "before" | "after") => {
    for (const entry of files) if (await worktreeDigest(root, entry.path) !== entry[side]) return false;
    return true;
  };
  if (resume && await matches(target)) return;
  if (!await matches(previous)) throw new Error("The proposal overlaps local changes. The working files were preserved");

  const temporary = await mkdtemp(join(tmpdir(), "momp-apply-"));
  try {
    const patch = join(temporary, "proposal.patch");
    await writeFile(patch, diff, { mode: 0o600 });
    const args = ["-c", "core.autocrlf=false", "-c", "core.protectNTFS=true", "-c", "core.protectHFS=true",
      "apply", "--no-index", "--whitespace=nowarn", ...(reverse ? ["--reverse"] : [])];
    await git(root, [...args, "--check", "--", patch], signal);
    if (!await matches(previous)) throw new Error("Working files changed during patch validation");
    signal.throwIfAborted();
    checkpoint();
    await git(root, [...args, "--", patch], signal);
    if (!await matches(target)) throw new Error("Review the working files before resuming this change");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}

export async function buildTestArchive(root: string, base: string, diff: string, target: string, signal: AbortSignal) {
  const temporary = await mkdtemp(join(tmpdir(), "momp-test-tree-"));
  try {
    const format = base.length === 64 ? "sha256" : "sha1";
    await git(temporary, ["init", "--quiet", "--template=", `--object-format=${format}`], signal);
    const objects = (await git(root, ["rev-parse", "--path-format=absolute", "--git-path", "objects"], signal)).trimEnd();
    if (!objects || /[\r\n]/.test(objects)) throw new Error("Invalid Git object location");
    await writeFile(join(temporary, ".git", "objects", "info", "alternates"), `${objects}\n`, { signal });
    await git(temporary, ["read-tree", base], signal);
    const patch = join(temporary, "proposal.patch");
    await writeFile(patch, diff, { signal });
    await git(temporary, ["apply", "--cached", "--whitespace=nowarn", "--", patch], signal);
    const tree = (await git(temporary, ["write-tree"], signal)).trim();
    const entries = await git(temporary, ["ls-tree", "--long", "-r", "-z", tree], signal);
    let size = 0;
    for (const entry of entries.split("\0")) {
      const match = /^(\d+) (?:blob|commit) [a-f0-9]+\s+(\d+|-)\t/.exec(entry);
      if (!match || !entry) continue;
      if (match[1] === "160000") throw new Error("The isolated test runner requires a tree without Git submodules");
      size += Number(match[2]);
      if (size > 64_000_000) throw new Error("The isolated test snapshot exceeds 64 MB");
    }
    const attributes = join(temporary, ".git", "info", "attributes");
    await mkdir(dirname(attributes), { recursive: true });
    await writeFile(attributes, "* -export-ignore -export-subst\n", { signal });
    await git(temporary, ["archive", "--format=tar", `--output=${target}`, tree], signal);
    if ((await stat(target)).size > 72_000_000) throw new Error("The isolated test archive exceeds the size limit");
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
}
