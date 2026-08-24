import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { redactNpxOutput } from "@/lib/npx";
import type {
  OmpWebInstallPlan,
  OmpWebPackageInfo,
  OmpWebReleaseInfo,
  OmpWebUpdateResponse,
} from "@/lib/api-types";

/**
 * momp publishes to its own GitHub releases (a prebuilt `momp-web-dist.tar.gz`
 * attached to each tag), not to npm. GitHub is therefore the single source of
 * truth for "is a newer version out", and the installer scripts below are how a
 * user actually pulls it down.
 */
export const MOMP_GITHUB_RELEASE_API_URL = "https://api.github.com/repos/domovoyproj/momp/releases/latest";
const MOMP_REPO_URL = "https://github.com/domovoyproj/momp";

/** One-liners that download + reinstall momp; also what auto-update runs. */
const INSTALL_COMMAND_WINDOWS = "irm https://raw.githubusercontent.com/domovoyproj/momp/main/install.ps1 | iex";
const INSTALL_COMMAND_UNIX = "curl -fsSL https://raw.githubusercontent.com/domovoyproj/momp/main/install.sh | bash";

const RELEASE_CACHE_SECONDS = 60 * 60;
const REQUEST_TIMEOUT_MS = 12_000;
// The installer downloads a prebuilt archive and runs `bun install`, which is
// slower than a package-manager update, so give it a generous ceiling.
const UPDATE_TIMEOUT_MS = 600_000;
const MAX_CHANGELOG_LENGTH = 40_000;
const execFileAsync = promisify(execFile);

type Fetcher = (input: string, init?: RequestInit) => Promise<Response>;

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string[] | null;
}

interface GitHubReleasePayload {
  tag_name?: unknown;
  name?: unknown;
  body?: unknown;
  html_url?: unknown;
  published_at?: unknown;
}

interface UpdateStatusOptions {
  currentAppVersion?: string;
  fetcher?: Fetcher;
  env?: NodeJS.ProcessEnv;
}

export interface OmpWebUpdateInstallResult {
  output: string;
}

function parseVersion(value: unknown): ParsedVersion | null {
  const normalized = String(value ?? "").trim().replace(/^[^0-9]*/, "");
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?/.exec(normalized);
  if (!match) return null;

  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split(".") : null,
  };
}

function canonicalVersion(value: unknown): string | null {
  const parsed = parseVersion(value);
  if (!parsed) return null;
  const core = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  return parsed.prerelease ? `${core}-${parsed.prerelease.join(".")}` : core;
}

/** Compare SemVer-like values without throwing on malformed upstream data. */
export function compareVersions(left: unknown, right: unknown): number {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) return 0;

  for (const key of ["major", "minor", "patch"] as const) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }

  if (!a.prerelease && !b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;

  const length = Math.max(a.prerelease.length, b.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) {
      const leftNumber = Number(leftPart);
      const rightNumber = Number(rightPart);
      if (leftNumber !== rightNumber) return leftNumber > rightNumber ? 1 : -1;
      continue;
    }
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function isNewerVersion(latest: string | null, current: string | null): boolean {
  return Boolean(latest && current && compareVersions(latest, current) > 0);
}

function releaseFromPayload(payload: GitHubReleasePayload): OmpWebReleaseInfo {
  const version = canonicalVersion(payload.tag_name);
  if (!version) throw new Error("The momp release did not contain a valid version tag");

  const tagName = typeof payload.tag_name === "string" && payload.tag_name.trim()
    ? payload.tag_name.trim()
    : `v${version}`;
  const htmlUrl = typeof payload.html_url === "string" && payload.html_url.startsWith(`${MOMP_REPO_URL}/`)
    ? payload.html_url
    : `${MOMP_REPO_URL}/releases/tag/${encodeURIComponent(tagName)}`;
  const body = typeof payload.body === "string" ? payload.body.slice(0, MAX_CHANGELOG_LENGTH) : "";

  return {
    version,
    tagName,
    name: typeof payload.name === "string" && payload.name.trim() ? payload.name.trim() : tagName,
    body,
    htmlUrl,
    publishedAt: typeof payload.published_at === "string" ? payload.published_at : null,
  };
}

async function fetchJson(url: string, fetcher: Fetcher): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetcher(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "momp-update-check",
      },
      signal: controller.signal,
      // Next.js caches this server-side request so every browser tab does not
      // consume a GitHub API request. The injected fetcher in tests ignores it.
      next: { revalidate: RELEASE_CACHE_SECONDS },
    } as RequestInit & { next: { revalidate: number } });
    if (!response.ok) throw new Error(`Update source returned HTTP ${response.status}`);
    return await response.json() as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

/** The platform installer command that auto-update runs and the UI displays. */
function installerCommand(): { primary: string; alternate: string } {
  return process.platform === "win32"
    ? { primary: INSTALL_COMMAND_WINDOWS, alternate: INSTALL_COMMAND_UNIX }
    : { primary: INSTALL_COMMAND_UNIX, alternate: INSTALL_COMMAND_WINDOWS };
}

export function buildInstallPlan({
  currentAppVersion,
  latestVersion,
  env = process.env,
}: {
  currentAppVersion: string | null;
  latestVersion: string | null;
  env?: NodeJS.ProcessEnv;
}): OmpWebInstallPlan {
  const { primary, alternate } = installerCommand();
  const updateAvailable = isNewerVersion(latestVersion, currentAppVersion);
  const disabled = env.MOMP_WEB_DISABLE_SELF_UPDATE === "1" || env.OMP_WEB_DISABLE_SELF_UPDATE === "1" || env.OMP_DESKTOP === "1";
  const canInstall = updateAvailable && !disabled;

  let reason: OmpWebInstallPlan["reason"];
  if (disabled) reason = "disabled";
  else if (!latestVersion) reason = "latest-package-unavailable";
  else if (!currentAppVersion) reason = "current-version-unknown";

  return {
    canInstall,
    manager: process.platform === "win32" ? "npm" : "bun",
    command: primary,
    alternateCommand: alternate,
    packageVersion: latestVersion ?? undefined,
    reason,
    restartRequired: true,
  };
}

export async function getOmpWebUpdateStatus(options: UpdateStatusOptions = {}): Promise<OmpWebUpdateResponse> {
  const fetcher = options.fetcher ?? fetch;
  const currentAppVersion = canonicalVersion(options.currentAppVersion ?? process.env.NEXT_PUBLIC_APP_VERSION) ?? "unknown";

  const releasePayload = await fetchJson(MOMP_GITHUB_RELEASE_API_URL, fetcher) as GitHubReleasePayload;
  const latestRelease = releaseFromPayload(releasePayload);
  const latestPackage: OmpWebPackageInfo = { version: latestRelease.version };

  const install = buildInstallPlan({
    currentAppVersion: currentAppVersion === "unknown" ? null : currentAppVersion,
    latestVersion: latestRelease.version,
    env: options.env,
  });
  const updateAvailable = isNewerVersion(latestRelease.version, currentAppVersion);
  const availability: OmpWebUpdateResponse["availability"] = !updateAvailable
    ? "up-to-date"
    : install.canInstall
      ? "installable"
      : "manual";

  return {
    currentAppVersion,
    latestRelease,
    latestPackage,
    updateAvailable,
    availability,
    install,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Run the momp installer in place. On Windows this pipes `install.ps1` into
 * PowerShell; elsewhere it pipes `install.sh` into bash. Both download the
 * latest prebuilt archive, reinstall into the app directory, and refresh the
 * global launcher — after which the running server must be restarted.
 */
export async function installOmpWebUpdate(): Promise<OmpWebUpdateInstallResult> {
  const isWindows = process.platform === "win32";
  const executable = isWindows
    ? (process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : "powershell.exe")
    : "bash";
  const args = isWindows
    ? ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", INSTALL_COMMAND_WINDOWS]
    : ["-c", INSTALL_COMMAND_UNIX];

  const result = await execFileAsync(executable, args, {
    timeout: UPDATE_TIMEOUT_MS,
    maxBuffer: 8_000_000,
    windowsHide: true,
    env: {
      ...process.env,
      // Non-interactive: never let the installer block on a prompt.
      CI: "1",
      MOMP_WEB_FAST_BUILD: "1",
    },
  });
  return { output: redactNpxOutput(`${result.stdout ?? ""}${result.stderr ?? ""}`).slice(-4000) };
}
