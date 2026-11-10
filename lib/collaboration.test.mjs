import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { CollaborationFailure, CollaborationRunner, collaborationFallback, collaborationSteps, parseCollaborationInput } from "./collaboration.ts";
import { buildTestArchive, readGitRoot, validateSourcePaths } from "./collaboration-git.ts";
import { parseAntigravityModels, parseAntigravityUsage, readAntigravityResult, supportsAntigravityMetadata } from "./collaboration-providers.ts";

const gpt = { provider: "openai-codex", id: "gpt-test" };
const gemini = { provider: "google", id: "gemini-test" };
const proposal = JSON.stringify({ summary: "Update the greeting", changes: [{ path: "src/hello.txt", content: "new greeting\n" }] });

async function fixture(t, transport, checks) {
  const directory = mkdtempSync(join(tmpdir(), "momp-collaboration-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const repository = join(directory, "repo");
  mkdirSync(join(repository, "src"), { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: repository, encoding: "utf8", windowsHide: true });
  git("init", "-q", "--template=");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(repository, "src/hello.txt"), "old greeting\n");
  writeFileSync(join(repository, ".env"), "SYNTHETIC_SECRET=do-not-send");
  git("add", ".");
  git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "fixture");
  const { root, base } = await readGitRoot(repository);
  const directoryForTasks = join(directory, "tasks");
  const runner = new CollaborationRunner(directoryForTasks, transport, checks);
  const create = (strategy, options = {}) => runner.create(root, base, parseCollaborationInput({
    strategy, taskKind: "implementation", gpt, gemini, prompt: "Change the greeting", paths: ["src/hello.txt"],
    ...options,
  }));
  return { runner, create, root, base, directory, directoryForTasks, git };
}

async function waitFor(runner, root, id, predicate) {
  for (let index = 0; index < 250; index++) {
    const value = runner.get(root, id);
    if (predicate(value)) return value;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Task did not reach the expected state");
}

test("solo tasks require only the selected provider and routing selects a lead up front", () => {
  const task = { taskKind: "architecture", prompt: "Review", paths: [] };
  assert.deepEqual(collaborationSteps(parseCollaborationInput({ ...task, strategy: "gpt", gpt })).map((step) => step.model), [gpt]);
  assert.deepEqual(collaborationSteps(parseCollaborationInput({ ...task, strategy: "gemini", gemini })).map((step) => step.model), [gemini]);
  assert.equal(collaborationSteps(parseCollaborationInput({ ...task, strategy: "smart", taskKind: "interface", gpt, gemini }))[0].model.id, gemini.id);
  assert.equal(collaborationSteps(parseCollaborationInput({ ...task, strategy: "smart", taskKind: "interface", leadPreference: "gpt", gpt, gemini }))[0].model.id, gpt.id);
});

test("an unavailable lead only prepares an alternate task and does not contact the other model", async (t) => {
  const calls = [];
  const { runner, create, root, base } = await fixture(t, async (model) => {
    calls.push(model.id);
    if (model.id === gpt.id) throw new CollaborationFailure("unavailable");
    return proposal;
  });
  const task = await create("gpt-lead");
  runner.start(root, task.id);
  const paused = await waitFor(runner, root, task.id, (value) => value?.status === "paused");
  const alternate = await runner.create(root, base, collaborationFallback(paused));
  assert.deepEqual(calls, [gpt.id]);
  assert.equal(alternate.status, "ready");
  assert.deepEqual(alternate.steps.map(({ model }) => model.id), [gemini.id]);
  runner.start(root, alternate.id);
  await waitFor(runner, root, alternate.id, (value) => value?.status === "complete");
  assert.deepEqual(calls, [gpt.id, gemini.id]);
});

test("dual review uses the same real diff and Git check, runs reviewers concurrently and leaves checkout untouched", async (t) => {
  const reviews = [];
  let bothStarted;
  const rendezvous = new Promise((resolve) => { bothStarted = resolve; });
  const { runner, create, root, git } = await fixture(t, async (model, prompt) => {
    if (prompt.startsWith("Perform")) {
      assert.ok(prompt.includes("old greeting"));
      assert.ok(!prompt.includes("do-not-send"));
      return proposal;
    }
    reviews.push({ model, evidence: JSON.parse(prompt.split("\n").at(-1)) });
    if (reviews.length === 2) bothStarted();
    await rendezvous;
    return `Reviewed by ${model.id}`;
  });
  const task = await create("dual-review");
  assert.equal(runner.get(`${root}-other`, task.id), undefined);
  writeFileSync(join(root, "src/hello.txt"), "user's uncommitted draft\n");
  runner.start(root, task.id);
  assert.throws(() => runner.start(root, task.id), { code: "ELOCKED" });
  const result = await waitFor(runner, root, task.id, (value) => value?.status === "complete");
  assert.match(result.proposal.diff, /-old greeting\r?\n\+new greeting/);
  assert.equal(result.proposal.check, "passed");
  assert.deepEqual(reviews.map((review) => review.evidence.diff), [result.proposal.diff, result.proposal.diff]);
  assert.deepEqual(reviews.map((review) => review.evidence.gitDiffCheck), ["passed", "passed"]);
  assert.equal(readFileSync(join(root, "src/hello.txt"), "utf8"), "user's uncommitted draft\n");
  assert.match(git("status", "--porcelain"), / M src\/hello.txt/);
});

test("a quota error persists the lead checkpoint and retry only calls the unfinished reviewer", async (t) => {
  let leads = 0;
  let reviews = 0;
  const transport = async (model) => {
    if (model.provider === gpt.provider) { leads++; return proposal; }
    if (++reviews === 1) throw new CollaborationFailure("quota");
    return "Review completed after quota recovered";
  };
  const { runner, create, root, directoryForTasks } = await fixture(t, transport);
  const task = await create("gpt-lead");
  runner.start(root, task.id);
  const paused = await waitFor(runner, root, task.id, (value) => value?.status === "paused");
  assert.equal(paused.steps[1].error, "quota");
  const reopened = new CollaborationRunner(directoryForTasks, transport);
  assert.equal(reopened.get(root, task.id).proposal.diff, paused.proposal.diff);
  reopened.start(root, task.id);
  const resumed = await waitFor(reopened, root, task.id, (value) => value?.status === "complete");
  assert.equal(resumed.steps[1].attempts, 2);
  assert.deepEqual({ leads, reviews }, { leads: 1, reviews: 2 });
});

test("recovers an interrupted checkpoint without dispatching work until explicit resume", async (t) => {
  let requests = 0;
  const { runner, create, root, directoryForTasks } = await fixture(t, async () => { requests++; return proposal; });
  const task = await create("gpt");
  task.status = "running";
  task.steps[0].status = "running";
  task.steps[0].attempts = 1;
  writeFileSync(join(directoryForTasks, `${task.id}.json`), JSON.stringify(task));
  assert.equal(runner.get(root, task.id).steps[0].error, "interrupted");
  assert.equal(requests, 0);
  runner.start(root, task.id);
  const result = await waitFor(runner, root, task.id, (value) => value?.status === "complete");
  assert.equal(result.steps[0].attempts, 2);
  assert.equal(requests, 1);
});

test("rejects paths and model output outside the explicitly selected tracked text", async (t) => {
  for (const path of [".env", "../escape", "src/../escape", "/root", "C:/windows", "src/con.txt", ".git/config", "credentials.json"]) {
    assert.throws(() => validateSourcePaths([path]), /source paths/, path);
  }
  const { runner, create, root } = await fixture(t, async () => JSON.stringify({ summary: "unsafe", changes: [{ path: ".env", content: "new" }] }));
  const task = await create("gpt");
  runner.start(root, task.id);
  const paused = await waitFor(runner, root, task.id, (value) => value?.status === "paused");
  assert.equal(paused.steps[0].error, "invalid-output");
  assert.equal(readFileSync(join(root, ".env"), "utf8"), "SYNTHETIC_SECRET=do-not-send");
});

test("official Antigravity envelope separates results from authentication and quota errors", () => {
  assert.equal(readAntigravityResult('{"event":"init"}\n{"event":"result","result":{"status":"SUCCESS","response":"review"}}\n', "", false), "review");
  assert.throws(() => readAntigravityResult('{"event":"result","result":{"status":"ERROR","error":"HTTP 429 RESOURCE_EXHAUSTED"}}', "", true), { code: "quota" });
  assert.throws(() => readAntigravityResult("", "Not logged in", true), { code: "unavailable" });
  assert.throws(() => readAntigravityResult('{"event":"step_update"}', "", false), { code: "invalid-output" });
  assert.throws(() => readAntigravityResult('{"event":"result","result":{"status":"SUCCESS","response":"partial","finished_reason":"print_timeout"}}', "", false), { code: "invalid-output" });
});

test("CLI model discovery and usage preserve reported values and guard older slash command behavior", () => {
  assert.equal(supportsAntigravityMetadata("agy version 1.5.0"), true);
  assert.equal(supportsAntigravityMetadata("v1.4.9"), false);
  assert.equal(supportsAntigravityMetadata("unknown"), false);
  assert.deepEqual(parseAntigravityModels("gemini-test-high   Gemini Test High\nother-model   Non-Gemini\n"), [
    { id: "gemini-test-high", name: "Gemini Test High" },
  ]);
  assert.deepEqual(parseAntigravityUsage("Gemini Test\t65%\t2026-11-10T15:00:00Z\nnon-tabular diagnostic\n"), [
    ["Gemini Test", "65%", "2026-11-10T15:00:00Z"],
  ]);
});

test("smart routing excludes exhausted models before approval and keeps the planned executor visible", () => {
  const input = parseCollaborationInput({ taskKind: "architecture", strategy: "smart", prompt: "Review", paths: [], gpt, gemini, leadPreference: "gpt" });
  input.exclusions = [{ model: gpt, reason: "quota" }];
  assert.deepEqual(collaborationSteps(input).map(({ role, model }) => ({ role, model })), [{ role: "lead", model: gemini }]);
});

test("the isolated Git snapshot includes the patch and reviewers receive test evidence before any workspace changes", { timeout: 25_000 }, async (t) => {
  const timeline = [];
  let snapshot;
  const { runner, create, root, directory } = await fixture(t, async (_model, prompt) => {
    if (prompt.startsWith("Perform")) { timeline.push("lead"); return proposal; }
    timeline.push("review");
    const evidence = JSON.parse(prompt.split("\n").at(-1));
    assert.deepEqual(evidence.projectTests, { command: "bun test", status: "passed", passed: 4 });
    assert.match(evidence.diff, /\+new greeting/);
    return "Tested proposal reviewed";
  }, async (workspace, base, diff, signal) => {
    timeline.push("test");
    await buildTestArchive(workspace, base, diff, snapshot, signal);
    const content = execFileSync("tar", ["-xOf", snapshot, "src/hello.txt"], { encoding: "utf8", windowsHide: true });
    assert.equal(content, "new greeting\n");
    assert.equal(readFileSync(join(workspace, "src/hello.txt"), "utf8"), "old greeting\n");
    assert.match(execFileSync("tar", ["-tf", snapshot], { encoding: "utf8" }), /^\.env\r?$/m);
    return { command: "bun test", status: "passed", passed: 4 };
  });
  snapshot = join(directory, "test.tar");
  const task = await create("gpt-lead", { runTests: true });
  runner.start(root, task.id);
  const result = await waitFor(runner, root, task.id, (value) => value?.status === "complete");
  assert.deepEqual(timeline, ["lead", "test", "review"]);
  assert.equal(result.verification.passed, 4);
});

test("a reviewed patch creates and deletes only approved paths and rolls back without touching other work", { timeout: 30_000 }, async (t) => {
  const changes = [{ path: "src/hello.txt", content: null }, { path: "src/new/greeting.txt", content: "replacement\n" }];
  const { runner, create, root, git, directoryForTasks } = await fixture(t, async () => JSON.stringify({ summary: "Move the greeting", changes }));
  const paths = changes.map(({ path }) => path);
  await assert.rejects(create("gpt", { paths }), /tracked regular file/);
  const task = await create("gpt", { paths, allowFileOperations: true });
  runner.start(root, task.id);
  await waitFor(runner, root, task.id, (value) => value?.status === "complete");
  writeFileSync(join(root, "local-draft.txt"), "draft\n");
  const applied = await runner.mutate(root, task.id, false);
  assert.equal(applied.application, "applied");
  assert.throws(() => readFileSync(join(root, "src/hello.txt")), { code: "ENOENT" });
  const newFile = join(root, "src/new/greeting.txt");
  assert.equal(readFileSync(newFile, "utf8"), "replacement\n");
  assert.equal(git("diff", "--cached", "--name-only"), "");

  const reopened = new CollaborationRunner(directoryForTasks, async () => assert.fail("Patch mutation must not contact the model"));
  writeFileSync(newFile, "user's follow-up\n");
  await assert.rejects(reopened.mutate(root, task.id, true), /overlaps local changes/);
  assert.equal(readFileSync(newFile, "utf8"), "user's follow-up\n");
  writeFileSync(newFile, "replacement\n");
  const reverted = await reopened.mutate(root, task.id, true);
  assert.equal(reverted.application, "reverted");
  assert.equal(readFileSync(join(root, "src/hello.txt"), "utf8"), "old greeting\n");
  assert.throws(() => readFileSync(newFile), { code: "ENOENT" });
  assert.equal(readFileSync(join(root, "local-draft.txt"), "utf8"), "draft\n");
});

test("staged changes and failed verification block patch application", { timeout: 25_000 }, async (t) => {
  const { runner, create, root, git } = await fixture(t, async () => proposal, async () => ({ command: "bun test", status: "failed", failed: 1 }));
  const task = await create("gpt", { runTests: true });
  runner.start(root, task.id);
  await waitFor(runner, root, task.id, (value) => value?.status === "complete");
  await assert.rejects(runner.mutate(root, task.id, false), /tests must pass/);
  const untested = await create("gpt");
  runner.start(root, untested.id);
  await waitFor(runner, root, untested.id, (value) => value?.status === "complete");
  writeFileSync(join(root, "src/hello.txt"), "local edit\n");
  git("add", "src/hello.txt");
  await assert.rejects(runner.mutate(root, untested.id, false), /overlaps staged changes/);
  assert.equal(readFileSync(join(root, "src/hello.txt"), "utf8"), "local edit\n");
});
