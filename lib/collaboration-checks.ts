import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { buildTestArchive } from "./collaboration-git";

export interface CollaborationCheck {
  command: "bun test";
  status: "passed" | "failed" | "unavailable" | "skipped";
  durationMs?: number;
  passed?: number;
  failed?: number;
  skipped?: number;
}

export type CollaborationCheckRunner = (root: string, base: string, diff: string, signal: AbortSignal) => Promise<CollaborationCheck>;
const exec = promisify(execFile);
const CLI_ENV = /^(?:path|pathext|systemroot|windir|comspec|temp|tmp|tmpdir)$/i;
const IMAGE = /^[a-z0-9][a-z0-9._/:@-]{0,240}$/i;
let running = 0;

export function collaborationTestImage(): string | undefined {
  const image = process.env.MOMP_TEST_RUNNER_IMAGE?.trim();
  return image && IMAGE.test(image) ? image : undefined;
}

export const runCollaborationTests: CollaborationCheckRunner = async (root, base, diff, signal) => {
  const command = "bun test" as const;
  if (!diff) return { command, status: "skipped" };
  const image = collaborationTestImage();
  if (!image || running >= 2) return { command, status: "unavailable" };
  running++;
  const startedAt = Date.now();
  let directory: string | undefined;
  const name = `momp-check-${randomUUID()}`;
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => CLI_ENV.test(key)));
  let attempted = false;
  try {
    directory = await mkdtemp(join(tmpdir(), "momp-test-runner-"));
    const archive = join(directory, "project.tar");
    if (/[\r\n,"]/.test(archive)) return { command, status: "unavailable" };
    await buildTestArchive(root, base, diff, archive, signal);
    await chmod(archive, 0o644);
    const docker = (args: string[], options: { signal?: AbortSignal; timeout: number }) => exec("docker", ["--config", directory!, ...args], {
      ...options, cwd: directory, env: { ...env, NODE_ENV: "production" }, windowsHide: true,
      encoding: "utf8", maxBuffer: 256_000,
    });
    attempted = true;
    const result = await docker([
      "run", "--rm", "--name", name, "--pull=never", "--network=none", "--read-only", "--init",
      "--cap-drop=ALL", "--security-opt=no-new-privileges", "--pids-limit=96", "--cpus=1", "--memory=768m", "--memory-swap=768m",
      "--user=65534:65534", "--env=HOME=/tmp", "--tmpfs=/tmp:rw,nosuid,nodev,size=512m,mode=1777", "--log-driver=none",
      "--mount", `type=bind,source=${archive},target=/project.tar,readonly`, "--entrypoint=/bin/sh", image,
      "-eu", "-c", "mkdir /tmp/project && tar -xf /project.tar -C /tmp/project && cd /tmp/project && bun test",
    ], { signal, timeout: 120_000 }).then((output) => ({ ok: true, ...output }), (error: unknown) => {
      const output = error as { code?: unknown; stdout?: string; stderr?: string };
      if (typeof output.code !== "number" || output.code === 125 || output.code === 126 || output.code === 127) throw error;
      return { ok: false, stdout: output.stdout, stderr: output.stderr };
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    // Store counts only. Test code can print arbitrary project content.
    const count = (label: string) => {
      const match = new RegExp(`^\\s*(\\d{1,8}) ${label}\\s*$`, "m").exec(output);
      return match ? Number(match[1]) : undefined;
    };
    return { command, status: result.ok ? "passed" : "failed", durationMs: Date.now() - startedAt,
      passed: count("pass"), failed: count("fail"), skipped: count("skip") };
  } catch {
    signal.throwIfAborted();
    return { command, status: "unavailable", durationMs: Date.now() - startedAt };
  } finally {
    if (attempted && directory) await exec("docker", ["--config", directory, "rm", "-f", name], {
      cwd: directory, env: { ...env, NODE_ENV: "production" }, windowsHide: true, timeout: 8_000,
    }).catch(() => {});
    running--;
    if (directory) await rm(directory, { recursive: true, force: true });
  }
};
