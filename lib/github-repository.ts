import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execute = promisify(execFile);

export function githubRepositoryUrl(remote: string): string | null {
  const normalized = remote.trim().replace(/^git@github\.com:/i, "https://github.com/");
  try {
    const url = new URL(normalized);
    if (url.hostname.toLowerCase() !== "github.com" || !["https:", "ssh:"].includes(url.protocol)) return null;
    const match = /^\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?\/?$/.exec(url.pathname);
    if (!match || match[1] === "." || match[1] === ".." || match[2] === "." || match[2] === "..") return null;
    return `https://github.com/${match[1]}/${match[2]}`;
  } catch {
    return null;
  }
}

export async function getGitHubRepository(cwd: string) {
  const options = { cwd, timeout: 5000, windowsHide: true, maxBuffer: 64 * 1024 };
  const [remote, branch] = await Promise.allSettled([
    execute("git", ["remote", "get-url", "origin"], options),
    execute("git", ["branch", "--show-current"], options),
  ]);
  const url = remote.status === "fulfilled" ? githubRepositoryUrl(remote.value.stdout) : null;
  return { url, branch: branch.status === "fulfilled" ? branch.value.stdout.trim() || "HEAD" : null };
}
