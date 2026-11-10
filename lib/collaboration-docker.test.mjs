import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCollaborationTests } from "./collaboration-checks.ts";
import { buildProposal, readGitRoot, readSourceFiles } from "./collaboration-git.ts";

test("the actual Docker runner tests the proposed tree as an unprivileged process without host secrets or networking", {
  skip: process.env.MOMP_VERIFY_ISOLATED_TESTS !== "1", timeout: 120_000,
}, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "momp-docker-contract-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, { cwd: root, encoding: "utf8", windowsHide: true });
  git("init", "-q", "--template=");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(root, "greeting.txt"), "Before\n");
  writeFileSync(join(root, "project.test.mjs"), `
import { readdirSync } from "node:fs";
import { expect, test } from "bun:test";
test("candidate file and isolation", async () => {
  expect(await Bun.file("greeting.txt").text()).toBe("After\\n");
  expect(readdirSync("/sys/class/net")).toEqual(["lo"]);
  expect(process.getuid()).toBe(65534);
  expect(process.env.OPENAI_API_KEY).toBeUndefined();
  expect(await Bun.file("uncommitted.txt").exists()).toBe(false);
  await expect(Bun.write("/project.tar", "forbidden")).rejects.toThrow();
});
`);
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Docker fixture");
  writeFileSync(join(root, "uncommitted.txt"), "host-only fixture\n");
  const before = process.env.OPENAI_API_KEY;
  process.env.OPENAI_API_KEY = "SYNTHETIC-HOST-VALUE";
  t.after(() => { if (before === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = before; });
  const { base } = await readGitRoot(root);
  const signal = AbortSignal.timeout(100_000);
  const files = await readSourceFiles(root, base, ["greeting.txt"], signal);
  const patch = await buildProposal(files, [{ path: "greeting.txt", content: "After\n" }], signal);
  const result = await runCollaborationTests(root, base, patch.diff, signal);
  assert.equal(result.status, "passed", JSON.stringify(result));
  assert.equal(result.passed, 1);
  assert.equal(readFileSync(join(root, "greeting.txt"), "utf8"), "Before\n");
  assert.equal(readFileSync(join(root, "uncommitted.txt"), "utf8"), "host-only fixture\n");
});
