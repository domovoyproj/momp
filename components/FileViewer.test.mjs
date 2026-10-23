import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { deferred, findNode, loadCallback, sourceTree } from "./source-test-helpers.mjs";

const tree = sourceTree(new URL("./FileViewer.tsx", import.meta.url));

function harness(initial = "original") {
  const state = { data: { content: initial, size: initial.length, language: "text" }, draft: initial, error: null };
  const requests = [];
  const context = {
    sourceSessionId: null,
    filePath: "/project/file.txt",
    editContent: initial,
    saving: false,
    activeRef: { current: true },
    savingRef: { current: false },
    contentRequestRef: { current: 0 },
    loadedContentRef: { current: initial },
    setData: (update) => { state.data = typeof update === "function" ? update(state.data) : update; },
    setEditContent: (update) => { state.draft = typeof update === "function" ? update(state.draft) : update; },
    setError: (error) => { state.error = error; },
    setSaveStatus: () => {},
    setSaving: () => {},
    setTimeout: () => {},
    getFileApiUrl: (path) => path,
    encodeFilePathForApi: (path) => path,
    fetch: () => {
      const request = deferred();
      requests.push(request);
      return request.promise;
    },
  };
  const read = loadCallback(tree, "fetchContent", context);
  const save = loadCallback(tree, "handleSave", context);
  const oldSyncEffect = findNode(tree, (node) => ts.isCallExpression(node)
    && node.expression.getText(tree) === "useEffect"
    && node.arguments[0]?.getText(tree).includes("setEditContent(data.content)"));
  async function complete(index, content) {
    requests[index].resolve({ ok: true, json: async () => ({ content, size: content.length, language: "text" }) });
    await new Promise((resolve) => setImmediate(resolve));
    if (oldSyncEffect) state.draft = state.data.content;
  }
  return { state, requests, context, read, save, complete };
}

test("a watcher refresh preserves an unsaved editor draft", async () => {
  const editor = harness();
  editor.state.draft = "user draft";
  const pending = editor.read("/project/file.txt");
  await editor.complete(0, "agent update");
  await pending;
  assert.equal(editor.state.draft, "user draft");
  assert.equal(editor.state.data.content, "agent update");
});

test("a clean editor follows a watcher refresh", async () => {
  const editor = harness();
  const pending = editor.read("/project/file.txt");
  await editor.complete(0, "agent update");
  await pending;
  assert.equal(editor.state.draft, "agent update");
});

test("an older read cannot replace a newer response", async () => {
  const editor = harness();
  const older = editor.read("/project/file.txt");
  const newer = editor.read("/project/file.txt");
  await editor.complete(1, "newest");
  await editor.complete(0, "outdated");
  await Promise.all([older, newer]);
  assert.equal(editor.state.data.content, "newest");
});

test("saving does not discard edits typed while the write is pending", async () => {
  const editor = harness();
  editor.state.draft = "saved snapshot";
  editor.context.editContent = "saved snapshot";
  const pending = editor.save();
  editor.state.draft = "typed during save";
  await editor.complete(0, "saved snapshot");
  await pending;
  assert.equal(editor.state.draft, "typed during save");
});

test("unmounted editors ignore pending reads and writes", async () => {
  for (const operation of ["read", "save"]) {
    const editor = harness();
    const pending = operation === "read" ? editor.read("/project/file.txt") : editor.save();
    const original = editor.state.data;
    editor.context.activeRef.current = false;
    editor.context.contentRequestRef.current += 1;
    await editor.complete(0, "late response");
    await pending;
    assert.equal(editor.state.data, original);
  }
});

test("text editor instances are isolated by file and session identity", () => {
  const element = findNode(tree, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "TextFileViewer");
  const key = element.attributes.properties.find((attribute) => attribute.name?.getText(tree) === "key");
  assert.ok(key);
  assert.match(key.getText(tree), /filePath/);
  assert.match(key.getText(tree), /sourceSessionId/);
});
