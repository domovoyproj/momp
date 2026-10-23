import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextResponse } from "next/server";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const routeBody = source.replace(/^import .*;\r?\n/gm, "").replace("export async function POST", "async function POST");
const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(routeBody);

function fixture(context, { directoryFailure = false, shutdownFailure = false } = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momp-delete-project-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const project = path.join(root, "project");
  const history = path.join(root, "session.jsonl");
  fs.mkdirSync(project);
  fs.writeFileSync(history, "synthetic history\n");
  const events = [];
  const remove = (target, options) => {
    events.push("remove-project");
    if (directoryFailure) throw new Error("EPERM: locked project");
    fs.rmSync(target, options);
  };
  const shutdown = async () => {
    events.push("shutdown");
    if (shutdownFailure) throw new Error("Unable to flush session");
  };
  const handler = new Function("NextResponse", "existsSync", "rmSync", "statSync", "unlinkSync", "homedir", "normalize", "resolve", "isApiRequestAllowed", "getRpcSession", "listAllSessions", "invalidateSessionListCache", "invalidateSessionPathCache", `${javascript}\nreturn POST;`)(
    NextResponse, fs.existsSync, remove, fs.statSync,
    (target) => { events.push("remove-history"); fs.unlinkSync(target); },
    os.homedir, path.normalize, path.resolve, () => true, () => ({ shutdown }),
    async () => [{ id: "fixture", cwd: project, path: history }],
    () => {}, () => {},
  );
  return { project, history, events, invoke: () => handler(new Request("http://localhost/api/cwd/delete", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ path: project }),
  })) };
}

test("failed project deletion retains chat history", async (context) => {
  const { project, history, invoke } = fixture(context, { directoryFailure: true });
  assert.equal((await invoke()).status, 500);
  assert.equal(fs.existsSync(project), true);
  assert.equal(fs.readFileSync(history, "utf8"), "synthetic history\n");
});

test("failed session shutdown aborts project and history deletion", async (context) => {
  const { project, history, invoke, events } = fixture(context, { shutdownFailure: true });
  assert.equal((await invoke()).status, 500);
  assert.equal(fs.existsSync(project), true);
  assert.equal(fs.existsSync(history), true);
  assert.deepEqual(events, ["shutdown"]);
});

test("successful deletion stops sessions before removing project and history", async (context) => {
  const { project, history, invoke, events } = fixture(context);
  assert.equal((await invoke()).status, 200);
  assert.equal(fs.existsSync(project), false);
  assert.equal(fs.existsSync(history), false);
  assert.deepEqual(events, ["shutdown", "remove-project", "remove-history"]);
});
