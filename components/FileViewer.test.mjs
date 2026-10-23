import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { deferred, findNode, loadCallback, sourceTree } from "./source-test-helpers.mjs";
import { createFileEditorDraftStore } from "../lib/file-editor-drafts.ts";

const tree = sourceTree(new URL("./FileViewer.tsx", import.meta.url));

function mountEditor(draftStore, filePath = "/project/a.txt", sourceSessionId = null, cwd = "/project") {
  const component = findNode(tree, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "TextFileViewer");
  const initialization = [];
  const stateNames = [];
  const names = [];
  for (const statement of component.body.statements) {
    if (!ts.isVariableStatement(statement)) break;
    initialization.push(statement.getText(tree));
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isArrayBindingPattern(declaration.name)) {
        stateNames.push(declaration.name.elements[0].name.text);
        names.push(...declaration.name.elements.map((element) => element.name.text));
      } else if (ts.isIdentifier(declaration.name)) names.push(declaration.name.text);
    }
  }
  let stateIndex = 0;
  const requests = [];
  const context = {
    filePath, sourceSessionId, cwd, draftStore,
    useTheme: () => ({ isDark: false }),
    useI18n: () => ({ t: (value) => value }),
    useRef: (value) => ({ current: value }),
    useState: (initial) => {
      const name = stateNames[stateIndex++];
      const value = typeof initial === "function" ? initial() : initial;
      return [value, (update) => { context[name] = typeof update === "function" ? update(context[name]) : update; }];
    },
    initialDisplayMode: undefined,
    getFileApiUrl: (path) => path,
    encodeFilePathForApi: (path) => path,
    setTimeout: () => {},
    fetch: (url, options) => {
      const request = { ...deferred(), url, options };
      requests.push(request);
      return request.promise;
    },
  };
  const compiled = ts.transpileModule(`(() => { ${initialization.join("\n")} return {${names.join(",")}}; })()`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  Object.assign(context, vm.runInNewContext(compiled, context));
  const update = findNode(tree, (node) => ts.isVariableDeclaration(node) && node.name.getText(tree) === "updateEditContent");
  if (update) context.updateEditContent = loadCallback(tree, "updateEditContent", context);
  const textarea = findNode(tree, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(tree) === "textarea");
  const change = textarea.attributes.properties.find((attribute) => attribute.name?.getText(tree) === "onChange");
  const changeCode = ts.transpileModule(`(${change.initializer.expression.getText(tree)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const changeHandler = vm.runInNewContext(changeCode, context);
  const read = loadCallback(tree, "fetchContent", context);
  const save = () => loadCallback(tree, "handleSave", { ...context })();
  function watchPendingSave() {
    const effect = findNode(tree, (node) => ts.isCallExpression(node)
      && node.expression.getText(tree) === "useEffect"
      && node.arguments[0]?.getText(tree).includes("draftStore.pendingSave(draftKey)"));
    const compiledEffect = ts.transpileModule(`(${effect.arguments[0].getText(tree)})`, {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    }).outputText;
    vm.runInNewContext(compiledEffect, { ...context, fetchContent: read })();
  }
  async function complete(index, content) {
    requests[index].resolve({ ok: true, json: async () => ({ content, size: content.length, language: "text" }) });
    await new Promise((resolve) => setImmediate(resolve));
  }
  return {
    context, requests, read, save, complete, watchPendingSave,
    edit: (value) => changeHandler({ target: { value } }),
    unmount: () => { context.activeRef.current = false; context.contentRequestRef.current += 1; },
  };
}

test("switching open files and returning restores the unsaved draft, not the disk text", async () => {
  const draftStore = createFileEditorDraftStore();
  const first = mountEditor(draftStore);
  const readFirst = first.read(first.context.filePath);
  await first.complete(0, "disk A");
  await readFirst;
  first.edit("unsaved A");
  first.unmount();
  const second = mountEditor(draftStore, "/project/b.txt");
  const readSecond = second.read(second.context.filePath);
  await second.complete(0, "disk B");
  await readSecond;
  second.unmount();
  const restored = mountEditor(draftStore);
  const readRestored = restored.read(restored.context.filePath);
  await restored.complete(0, "external change to A");
  await readRestored;
  assert.equal(restored.context.editContent, "unsaved A");
  assert.equal(restored.context.data.content, "external change to A");
  assert.equal(restored.context.displayMode, "edit");
});

async function loadedEditor(store, filePath = "/project/a.txt", sourceSessionId = null, cwd = "/project") {
  const editor = mountEditor(store, filePath, sourceSessionId, cwd);
  const pending = editor.read(filePath);
  await editor.complete(0, "disk text");
  await pending;
  return editor;
}

test("drafts survive returning from chat and remain isolated by path, session and cwd", async () => {
  const store = createFileEditorDraftStore();
  const original = await loadedEditor(store);
  original.edit("draft before chat");
  original.unmount();
  const restored = await loadedEditor(store);
  assert.equal(restored.context.editContent, "draft before chat");
  for (const identity of [
    ["/project/b.txt", null, "/project"],
    ["/project/a.txt", "another-session", "/project"],
    ["/project/a.txt", null, "/another-project"],
  ]) {
    const other = await loadedEditor(store, ...identity);
    assert.equal(other.context.editContent, "disk text");
  }
});

test("clean and successfully saved files reload disk content on return", async () => {
  for (const saveFirst of [false, true]) {
    const store = createFileEditorDraftStore();
    const original = await loadedEditor(store);
    if (saveFirst) {
      original.edit("saved text");
      const pending = original.save();
      await original.complete(1, "saved text");
      await pending;
    }
    original.unmount();
    const restored = mountEditor(store);
    const pending = restored.read(restored.context.filePath);
    await restored.complete(0, "new disk text");
    await pending;
    assert.equal(restored.context.editContent, "new disk text");
    assert.equal(store.get(restored.context.draftKey), null);
  }
});

test("edits typed during a save remain dirty after switching away and back", async () => {
  const store = createFileEditorDraftStore();
  const original = await loadedEditor(store);
  original.edit("saved snapshot");
  const pending = original.save();
  original.edit("newer draft");
  await original.complete(1, "saved snapshot");
  await pending;
  original.unmount();
  const restored = mountEditor(store);
  const read = restored.read(restored.context.filePath);
  await restored.complete(0, "saved snapshot");
  await read;
  assert.equal(restored.context.editContent, "newer draft");
  assert.equal(restored.context.loadedContentRef.current, "saved snapshot");
});

test("a remounted editor cannot overlap an older save or lose its newer draft to that completion", async () => {
  const store = createFileEditorDraftStore();
  const original = await loadedEditor(store);
  original.edit("first save");
  const firstSave = original.save();
  original.unmount();
  const restored = await loadedEditor(store);
  restored.edit("new draft after return");
  await restored.save();
  assert.equal(restored.requests.length, 1);
  assert.equal(restored.context.saving, true);
  await original.complete(1, "first save");
  await firstSave;
  assert.equal(store.pendingSave(restored.context.draftKey), null);
  assert.equal(store.get(restored.context.draftKey).content, "new draft after return");
  const secondSave = restored.save();
  assert.equal(restored.requests[1].options.method, "PUT");
  assert.equal(JSON.parse(restored.requests[1].options.body).content, "new draft after return");
  await restored.complete(1, "new draft after return");
  await secondSave;
});

test("editing back to the old baseline during a previous instance's save is not discarded", async () => {
  const store = createFileEditorDraftStore();
  const original = await loadedEditor(store);
  original.edit("saved snapshot");
  const pending = original.save();
  original.unmount();
  const restored = await loadedEditor(store);
  restored.watchPendingSave();
  restored.edit("disk text");
  const watcherRead = restored.read(restored.context.filePath);
  await restored.complete(1, "saved snapshot");
  await watcherRead;
  assert.equal(restored.context.editContent, "disk text");
  await original.complete(1, "saved snapshot");
  await pending;
  await restored.complete(2, "saved snapshot");
  assert.equal(restored.context.editContent, "disk text");
  assert.equal(store.get(restored.context.draftKey).content, "disk text");
  assert.equal(store.get(restored.context.draftKey).baseline, "saved snapshot");
});

test("a save finishing between render and the pending effect cannot leave saving stuck", async () => {
  const store = createFileEditorDraftStore();
  const original = await loadedEditor(store);
  original.edit("saved snapshot");
  const pending = original.save();
  original.unmount();
  const restored = mountEditor(store);
  assert.equal(restored.context.saving, true);
  await original.complete(1, "saved snapshot");
  await pending;
  restored.watchPendingSave();
  assert.equal(restored.context.saving, false);
});

test("completion before effects preserves a newer edit matching the old disk baseline", async () => {
  const store = createFileEditorDraftStore();
  const original = await loadedEditor(store);
  original.edit("saved snapshot");
  const pending = original.save();
  original.unmount();
  const restored = mountEditor(store);
  restored.edit("disk text");
  await original.complete(1, "saved snapshot");
  await pending;
  restored.watchPendingSave();
  const read = restored.read(restored.context.filePath);
  await restored.complete(0, "saved snapshot");
  await read;
  assert.equal(restored.context.editContent, "disk text");
});

test("failed saves release the shared lock and retain dirty text for remount", async () => {
  const store = createFileEditorDraftStore();
  const original = await loadedEditor(store);
  original.edit("unsaved text");
  const pending = original.save();
  original.unmount();
  original.requests[1].resolve({ ok: false, json: async () => ({ error: "write failed" }) });
  await pending;
  assert.equal(store.pendingSave(original.context.draftKey), null);
  const restored = await loadedEditor(store);
  assert.equal(restored.context.editContent, "unsaved text");
});

test("a lost save acknowledgement cannot erase an edit equal to the previous disk baseline", async () => {
  for (const remountBeforeFailure of [false, true]) {
    const store = createFileEditorDraftStore();
    const original = await loadedEditor(store);
    original.edit("written snapshot");
    const pending = original.save();
    const editor = remountBeforeFailure ? await loadedEditor(store) : original;
    if (remountBeforeFailure) {
      original.unmount();
      editor.watchPendingSave();
    }
    editor.edit("disk text");
    if (!remountBeforeFailure) editor.unmount();
    original.requests[1].resolve({ ok: true, json: async () => { throw new Error("lost response after disk write"); } });
    await pending;
    await new Promise((resolve) => setImmediate(resolve));
    const restored = remountBeforeFailure ? editor : mountEditor(store);
    const read = remountBeforeFailure ? null : restored.read(restored.context.filePath);
    await restored.complete(remountBeforeFailure ? 1 : 0, "written snapshot");
    await read;
    assert.equal(restored.context.editContent, "disk text");
    assert.equal(store.get(restored.context.draftKey).baseline, "written snapshot");
  }
});

test("editing after an uncertain save also retains intent until the disk baseline is refreshed", async () => {
  const store = createFileEditorDraftStore();
  const original = await loadedEditor(store);
  original.edit("written snapshot");
  const pending = original.save();
  original.requests[1].resolve({ ok: true, json: async () => { throw new Error("lost acknowledgement"); } });
  await pending;
  original.edit("disk text");
  original.unmount();
  const restored = mountEditor(store);
  const read = restored.read(restored.context.filePath);
  await restored.complete(0, "written snapshot");
  await read;
  assert.equal(restored.context.editContent, "disk text");
});

test("closing a file while its save is pending does not recreate the discarded draft", async () => {
  const store = createFileEditorDraftStore();
  const original = await loadedEditor(store);
  original.edit("saved snapshot");
  const pending = original.save();
  original.edit("discarded newer edit");
  original.unmount();
  store.retainFiles([]);
  await original.complete(1, "saved snapshot");
  await pending;
  assert.equal(store.get(original.context.draftKey), null);
  const reopened = mountEditor(store);
  const read = reopened.read(reopened.context.filePath);
  await reopened.complete(0, "saved snapshot");
  await read;
  assert.equal(reopened.context.editContent, "saved snapshot");
});

test("the remount pending-save effect refreshes only the current instance after release", async () => {
  const store = createFileEditorDraftStore();
  const key = JSON.stringify(["/project/a.txt", null, "/project"]);
  const release = store.beginSave(key);
  const editor = mountEditor(store);
  const effect = findNode(tree, (node) => ts.isCallExpression(node)
    && node.expression.getText(tree) === "useEffect"
    && node.arguments[0]?.getText(tree).includes("draftStore.pendingSave(draftKey)"));
  assert.ok(effect);
  const compiled = ts.transpileModule(`(${effect.arguments[0].getText(tree)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const callback = vm.runInNewContext(compiled, { ...editor.context, fetchContent: editor.read });
  callback();
  release();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(editor.context.saving, false);
  assert.equal(editor.requests.length, 1);
  await editor.complete(0, "updated disk");
});

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
    editContentRef: { current: initial },
    draftStore: createFileEditorDraftStore(),
    draftKey: JSON.stringify(["/project/file.txt", null, "/project"]),
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
  Object.defineProperty(state, "draft", {
    get: () => context.editContentRef.current,
    set: (value) => { context.editContentRef.current = value; },
  });
  context.updateEditContent = loadCallback(tree, "updateEditContent", context);
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

test("AppShell owns drafts across viewer remounts and prunes only closed file paths", () => {
  const shell = sourceTree(new URL("./AppShell.tsx", import.meta.url));
  const owner = findNode(shell, (node) => ts.isVariableDeclaration(node)
    && node.name.getText(shell) === "[fileDraftStore]");
  assert.equal(owner.initializer.getText(shell), "useState(createFileEditorDraftStore)");
  const viewer = findNode(shell, (node) => ts.isJsxSelfClosingElement(node) && node.tagName.getText(shell) === "FileViewer");
  const prop = viewer.attributes.properties.find((attribute) => attribute.name?.getText(shell) === "draftStore");
  assert.equal(prop.initializer.expression.getText(shell), "fileDraftStore");
  const pruning = findNode(shell, (node) => ts.isCallExpression(node)
    && node.expression.getText(shell) === "useEffect"
    && node.arguments[0]?.getText(shell).includes("fileDraftStore.retainFiles"));
  assert.ok(pruning);
  assert.equal(pruning.arguments[1].getText(shell), "[fileDraftStore, fileTabs]");
  const store = createFileEditorDraftStore();
  const retained = JSON.stringify(["/project/a.txt", null, "/project"]);
  const discarded = JSON.stringify(["/project/b.txt", null, "/project"]);
  store.set(retained, { content: "draft A", baseline: "disk A" });
  store.set(discarded, { content: "draft B", baseline: "disk B" });
  const compiled = ts.transpileModule(`(${pruning.arguments[0].getText(shell)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  vm.runInNewContext(compiled, { fileDraftStore: store, fileTabs: [{ filePath: "/project/a.txt" }] })();
  assert.equal(store.get(retained).content, "draft A");
  assert.equal(store.get(discarded), null);
});
