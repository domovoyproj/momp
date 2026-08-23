import { mkdir, readdir, realpath, stat } from "fs/promises";
import { homedir } from "os";
import path from "path";

export interface BrowsableDirectory {
  name: string;
  path: string;
}

export function shouldShowWindowsDrivePicker(
  directory?: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32" && !directory;
}

export function getBrowseStartDirectory(directory?: string): string {
  return directory || homedir();
}

export function getWindowsDriveCandidates(): BrowsableDirectory[] {
  return "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((letter) => ({
    name: `${letter}:`,
    path: `${letter}:\\`,
  }));
}

export async function listWindowsDrives(): Promise<BrowsableDirectory[]> {
  const candidates = await Promise.all(getWindowsDriveCandidates().map(async (drive) => {
    try {
      const driveStat = await stat(drive.path);
      return driveStat.isDirectory() ? drive : null;
    } catch {
      return null;
    }
  }));

  return candidates.filter((drive): drive is BrowsableDirectory => drive !== null);
}

export function normalizeDirectory(directory: string): string {
  if (directory === "~") return homedir();
  if (/^~[\\/]/.test(directory)) {
    const suffix = directory.slice(2).replace(/[\\/]+/g, path.sep);
    return path.resolve(homedir(), suffix);
  }

  const isWindowsPath = /^[a-zA-Z]:[\\/]/.test(directory)
    || directory.startsWith("\\\\")
    || directory.startsWith("//");
  const pathApi = isWindowsPath ? path.win32 : path;
  const launchCwd = process.env.OMP_WEB_LAUNCH_CWD;
  const baseDirectory = launchCwd ? pathApi.resolve(launchCwd) : process.cwd();
  return pathApi.resolve(baseDirectory, directory);
}

export function getParentDirectory(directory: string): string | null {
  const pathApi = /^[a-zA-Z]:[\\/]/.test(directory) || directory.startsWith("\\\\")
    ? path.win32
    : path;
  const normalized = pathApi.normalize(directory);
  const parent = pathApi.dirname(normalized);
  return parent === normalized ? null : parent;
}

export async function resolveDirectory(directory: string): Promise<string> {
  const resolved = await realpath(normalizeDirectory(directory));
  if (/^[a-zA-Z]:$/.test(resolved)) {
    return resolved + "\\";
  }
  return resolved;
}

/**
 * Create `name` inside `parent` and return the new absolute path.
 *
 * The name is a single path segment — separators, drive-relative prefixes and
 * the characters Windows forbids in a filename are all rejected so a browse
 * location cannot be turned into an arbitrary traversal. `mkdir` without
 * `recursive` throws `EEXIST` when the folder already exists, which the caller
 * surfaces verbatim.
 */
export async function createDirectory(parent: string, name: string): Promise<string> {
  const trimmed = name.trim();
  if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/<>:"|?*\u0000-\u001f]/.test(trimmed)) {
    throw new Error("Invalid folder name");
  }
  const resolvedParent = await resolveDirectory(parent);
  const target = path.join(resolvedParent, trimmed);
  await mkdir(target);
  return target;
}

export async function listDirectories(directory: string): Promise<BrowsableDirectory[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  // 忽略损坏、不可访问或不指向目录的符号链接。
  const candidates = await Promise.all(entries.map(async (entry) => {
    if (entry.isDirectory()) {
      return { name: entry.name, path: path.join(directory, entry.name) };
    }
    if (!entry.isSymbolicLink()) return null;

    try {
      const entryPath = path.join(directory, entry.name);
      const realEntryPath = await realpath(entryPath);
      const entryStat = await stat(realEntryPath);
      if (!entryStat.isDirectory()) return null;
      return { name: entry.name, path: entryPath };
    } catch {
      return null;
    }
  }));

  return candidates
    .filter((entry): entry is BrowsableDirectory => entry !== null)
    .sort((left, right) => left.name.localeCompare(right.name));
}
