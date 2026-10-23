import { existsSync, mkdirSync, readFileSync, realpathSync } from "fs";
import { isAbsolute, join, relative, resolve, sep } from "path";
import { writePrivateFileAtomicSync } from "./atomic-file";
import type { ProjectTrustStatus } from "./api-types";

/**
 * Project trust for omp-web.
 *
 * The `omp` CLI executes a repository's `.omp/extensions`, `.omp/hooks`,
 * `.omp/tools` and `.mcp.json` because the user deliberately ran it inside that
 * repository. omp-web reaches the same code from a browser tab: merely opening
 * a project in the sidebar would otherwise run repository-controlled code on
 * the machine hosting the server.
 *
 * omp has no trust store of its own, so omp-web keeps one and gates the
 * *code-bearing* project resources behind it. Trust decisions live next to the
 * agent config so they survive restarts and are shared by every omp-web
 * instance pointed at the same agent directory.
 */

const TRUST_FILE = "omp-web-trusted-projects.json";

/**
 * Project-relative directories whose contents omp imports and executes.
 *
 * Skills, rules and prompts are intentionally absent: they are data folded into
 * the system prompt, not modules the loader imports.
 */
const CODE_BEARING_PROJECT_DIRS = [
  ".omp/extensions", ".omp/hooks", ".omp/tools",
  ".pi/extensions", ".pi/hooks", ".pi/tools",
  ".claude/extensions", ".claude/hooks", ".claude/tools",
  ".agents/extensions", ".agents/hooks", ".agents/tools",
  ".codex/extensions", ".codex/hooks", ".codex/tools",
  ".gemini/extensions", ".opencode/plugins",
] as const;

/** Project-relative files that declare MCP servers, i.e. processes omp spawns. */
const MCP_MANIFEST_FILES = [
  ".mcp.json", "mcp.json",
  ".omp/.mcp.json", ".omp/mcp.json",
  ".pi/.mcp.json", ".pi/mcp.json",
  ".claude/.mcp.json", ".claude/mcp.json",
  ".cursor/mcp.json", ".vscode/mcp.json", ".windsurf/mcp_config.json",
] as const;

const EXECUTABLE_CONFIG_FILES = [
  ".omp/config.yml", ".omp/config.yaml", ".omp/settings.json",
  ".pi/config.yml", ".pi/config.yaml", ".pi/settings.json",
  ".claude/settings.json", ".cursor/settings.json",
  ".codex/config.toml", ".gemini/settings.json",
  "opencode.json", "opencode.jsonc", ".opencode/opencode.json", ".opencode/opencode.jsonc",
] as const;

function trustFilePath(agentDir: string): string {
  return join(agentDir, TRUST_FILE);
}

function canonicalProjectKey(cwd: string): string {
  const resolved = resolve(cwd);
  try {
    return realpathSync(resolved);
  } catch {
    return resolved;
  }
}

function readTrustedProjects(agentDir: string): Record<string, boolean> {
  try {
    const parsed: unknown = JSON.parse(readFileSync(trustFilePath(agentDir), "utf8"));
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>)
        .filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"),
    );
  } catch {
    return {};
  }
}

function writeTrustedProjects(agentDir: string, trusted: Record<string, boolean>): void {
  mkdirSync(agentDir, { recursive: true });
  writePrivateFileAtomicSync(trustFilePath(agentDir), `${JSON.stringify(trusted, null, 2)}\n`);
}

/**
 * Whether `cwd` ships resources omp would import and execute on session start.
 */
export function hasTrustRequiringProjectResources(cwd: string): boolean {
  if (!cwd) return false;
  for (const dir of CODE_BEARING_PROJECT_DIRS) {
    if (existsSync(join(cwd, dir))) return true;
  }
  for (const file of [...MCP_MANIFEST_FILES, ...EXECUTABLE_CONFIG_FILES]) {
    if (existsSync(join(cwd, file))) return true;
  }
  return false;
}

export function getProjectTrustStatus(cwd: string, agentDir: string): ProjectTrustStatus {
  const requiresTrust = Boolean(cwd) && hasTrustRequiringProjectResources(cwd);
  if (!requiresTrust) return { requiresTrust: false, trusted: true };

  return {
    requiresTrust: true,
    trusted: readTrustedProjects(agentDir)[canonicalProjectKey(cwd)] === true,
  };
}

export function trustProject(cwd: string, agentDir: string): ProjectTrustStatus {
  const status = getProjectTrustStatus(cwd, agentDir);
  if (!status.requiresTrust) return status;

  const trusted = readTrustedProjects(agentDir);
  trusted[canonicalProjectKey(cwd)] = true;
  writeTrustedProjects(agentDir, trusted);
  return { requiresTrust: true, trusted: true };
}

/** True when `candidate` lives inside `root` (or is `root` itself). */
export function isInsideProject(candidate: string, root: string): boolean {
  const rel = relative(resolve(root), resolve(candidate));
  if (rel === "") return true;
  return !isAbsolute(rel) && rel !== ".." && !rel.startsWith(`..${sep}`) && !rel.startsWith("../");
}

/** Shape shared by omp's discovered custom-tool entries. */
export interface DiscoveredToolPath {
  path: string;
  source?: { level: "user" | "project" };
}

export interface UntrustedProjectSessionOptions<TTool extends DiscoveredToolPath> {
  /** Extension modules to load, with project-local ones removed. */
  preloadedExtensionPaths: string[];
  /** Custom tool modules to load, with project-local ones removed. */
  preloadedCustomToolPaths: TTool[];
  extensionRoots: () => {
    mode: "explicit-only";
    explicit: string[];
    configured: string[];
    configuredLevel: "user";
  };
  /** MCP servers are processes omp spawns from project manifests — off entirely. */
  enableMCP: false;
}

export interface DiscoveredProjectCode<TTool extends DiscoveredToolPath> {
  extensionPaths: readonly string[];
  projectExtensionPaths?: readonly string[];
  customToolPaths: readonly TTool[];
}

/**
 * Session options that keep an untrusted project's code dormant.
 *
 * Returns `undefined` when the project has nothing that requires trust, or when
 * the user already trusted it — both leave omp on its normal load path so
 * omp-web sessions behave exactly like `omp` in a terminal.
 *
 * The caller supplies the discovered paths (omp's own `discoverSessionExtensionPaths`
 * / `discoverCustomToolPaths` results) so user-level extensions keep working:
 * only entries under the project root are dropped.
 */
export function untrustedProjectSessionOptions<TTool extends DiscoveredToolPath>(
  cwd: string,
  agentDir: string,
  discovered: DiscoveredProjectCode<TTool>,
): UntrustedProjectSessionOptions<TTool> | undefined {
  const status = getProjectTrustStatus(cwd, agentDir);
  const projectExtensionPaths = discovered.projectExtensionPaths ?? [];
  const isProjectExtension = (path: string) => isInsideProject(path, cwd)
    || projectExtensionPaths.some((projectPath) => isInsideProject(path, projectPath));
  const isProjectTool = (tool: TTool) => tool.source?.level === "project" || isInsideProject(tool.path, cwd);
  const discoveredProjectCode = discovered.extensionPaths.some(isProjectExtension)
    || discovered.customToolPaths.some(isProjectTool);
  if (!status.requiresTrust && !discoveredProjectCode) return undefined;
  if (readTrustedProjects(agentDir)[canonicalProjectKey(cwd)] === true) return undefined;

  const extensionPaths = discovered.extensionPaths.filter((path) => !isProjectExtension(path));

  return {
    preloadedExtensionPaths: extensionPaths,
    preloadedCustomToolPaths: discovered.customToolPaths.filter((tool) => !isProjectTool(tool)),
    extensionRoots: () => ({ mode: "explicit-only", explicit: [...extensionPaths], configured: [], configuredLevel: "user" }),
    enableMCP: false,
  };
}
