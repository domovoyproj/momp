import assert from "node:assert/strict";
import test from "node:test";
import { deferred, loadCallback, sourceTree } from "./source-test-helpers.mjs";

const tree = sourceTree(new URL("./FileExplorer.tsx", import.meta.url));

function harness() {
  const request = deferred();
  const scope = { cwd: "/project-a" };
  const state = { pendingConflict: null, uploadPhase: "idle", uploadProgress: 0, uploadError: null };
  const uploads = [];
  const context = {
    cwd: scope.cwd,
    uploadScope: scope,
    uploadScopeRef: { current: scope },
    uploadBusy: false,
    setUploadSummary: () => {},
    setHighlightedPaths: () => {},
    applyUploadResult: () => { state.applied = true; },
    encodeFilePathForApi: (path) => path,
    fetch: () => request.promise,
    uploadFiles: (...args) => { uploads.push(args); return request.promise; },
  };
  for (const field of Object.keys(state)) context[`set${field[0].toUpperCase()}${field.slice(1)}`] = (value) => { state[field] = value; };
  context.performUpload = loadCallback(tree, "performUpload", context);
  const prepare = loadCallback(tree, "prepareUpload", context);
  return { state, context, request, uploads, prepare, scope };
}

test("late upload checks cannot present a conflict or start a transfer in another project", async () => {
  for (const data of [{ conflicts: ["file.txt"] }, {}]) {
    const upload = harness();
    const pending = upload.prepare([{ name: "file.txt" }]);
    upload.context.uploadScopeRef.current = { cwd: "/project-b" };
    upload.state.uploadPhase = "idle";
    upload.request.resolve({ ok: true, json: async () => data });
    await pending;
    assert.equal(upload.state.pendingConflict, null);
    assert.equal(upload.uploads.length, 0);
  }
});

test("a transfer keeps its original destination but cannot update a later project's UI", async () => {
  const upload = harness();
  const pending = upload.context.performUpload([{ name: "file.txt" }], "error");
  assert.equal(upload.uploads[0][0], "/project-a");
  upload.context.uploadScopeRef.current = { cwd: "/project-b" };
  upload.state.uploadPhase = "checking";
  upload.request.resolve({ status: 409, data: { conflicts: ["file.txt"] } });
  await pending;
  assert.equal(upload.state.pendingConflict, null);
  assert.equal(upload.state.uploadPhase, "checking");
});

test("an obsolete conflict action cannot overwrite files in the active project", async () => {
  const upload = harness();
  upload.context.uploadScopeRef.current = { cwd: "/project-b" };
  upload.request.resolve({ status: 200, data: { uploaded: ["file.txt"] } });
  await upload.context.performUpload([{ name: "file.txt" }], "overwrite", upload.scope);
  assert.equal(upload.uploads.length, 0);
});
