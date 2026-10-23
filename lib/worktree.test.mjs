import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { resolveProject } from "./worktree.ts";

test("recognizes Git checkout roots despite platform separator differences", async () => {
  const cwd = realpathSync(process.cwd());
  const output = execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir", "--git-dir"], { cwd, encoding: "utf8" });
  const [commonDir, gitDir] = output.trim().split(/\r?\n/);
  const isWorktree = path.resolve(commonDir) !== path.resolve(gitDir);
  const project = await resolveProject(cwd);
  assert.equal(project.isTopLevel, true);
  assert.equal(project.isWorktree, isWorktree);
  assert.equal(project.projectRoot, isWorktree ? realpathSync(path.dirname(commonDir)) : cwd);
});

test("repository subdirectories retain their separate project identity", async () => {
  const cwd = path.join(process.cwd(), "lib");
  const project = await resolveProject(cwd);
  assert.equal(project.isTopLevel, false);
  assert.equal(project.isWorktree, false);
  assert.equal(project.projectRoot, cwd);
});
