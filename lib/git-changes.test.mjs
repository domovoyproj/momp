import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

async function loadSubject() {
  return import("./git-status.ts");
}

test("parses null-delimited Git status entries including renames", async () => {
  const { parseGitPorcelainV1 } = await loadSubject();
  const entries = parseGitPorcelainV1([
    " M components/App.tsx",
    "?? notes.txt",
    "R  src/new-name.ts",
    "src/old-name.ts",
    "",
  ].join("\0"));

  assert.deepEqual(entries, [
    {
      path: "components/App.tsx",
      indexStatus: " ",
      worktreeStatus: "M",
    },
    {
      path: "notes.txt",
      indexStatus: "?",
      worktreeStatus: "?",
    },
    {
      path: "src/new-name.ts",
      originalPath: "src/old-name.ts",
      indexStatus: "R",
      worktreeStatus: " ",
    },
  ]);
});

test("classifies Git status for explorer badges", async () => {
  const { classifyGitStatus } = await loadSubject();
  const classify = (pair) => classifyGitStatus({
    path: "file.ts",
    indexStatus: pair[0],
    worktreeStatus: pair[1],
  });

  assert.deepEqual(classify(" M"), { status: "modified", code: "M" });
  assert.deepEqual(classify("??"), { status: "untracked", code: "U" });
  assert.deepEqual(classify("A "), { status: "added", code: "A" });
  assert.deepEqual(classify("R "), { status: "renamed", code: "R" });
  assert.deepEqual(classify("UU"), { status: "conflict", code: "C" });
  assert.deepEqual(classify(" D"), { status: "deleted", code: "D" });
});

test("Git status and diff use the selected directory alias and handle a removed parent", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "momp-git-path-"));
  t.after(() => rmSync(temp, { recursive: true, force: true }));
  const repository = join(temp, "repo");
  const alias = join(temp, "work");
  mkdirSync(join(repository, "nested"), { recursive: true });
  symlinkSync(repository, alias, process.platform === "win32" ? "junction" : "dir");
  const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", windowsHide: true });
  git("init", "-q", "--template=");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repository, "workspace.ts"), "export const title = 'Before';\n");
  writeFileSync(join(repository, "nested", "removed.txt"), "Removed line\n");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Git path fixture");
  writeFileSync(join(repository, "workspace.ts"), "export const title = 'After';\n");
  rmSync(join(repository, "nested"), { recursive: true });
  const { getGitStatus, getGitFileDiff } = await import("./git-changes.ts");
  const status = await getGitStatus(alias);
  assert.equal(status.files.length, 2);
  assert.ok(status.files.some((file) => file.filePath === join(alias, "workspace.ts") && file.status === "modified"));
  const modified = await getGitFileDiff(alias, join(alias, "workspace.ts"));
  assert.equal(modified.status, "modified");
  assert.match(modified.patch, /\+export const title = 'After';/);
  const removed = await getGitFileDiff(alias, join(alias, "nested", "removed.txt"));
  assert.equal(removed.status, "deleted");
  assert.match(removed.patch, /-Removed line/);
});
