import assert from "node:assert/strict";
import test from "node:test";
import { createFileEditorDraftStore } from "./file-editor-drafts.ts";

const first = JSON.stringify(["/a.txt", null, "/"]);
const second = JSON.stringify(["/b.txt", null, "/"]);

test("file drafts are scoped to their owner and store only dirty snapshots", () => {
  const store = createFileEditorDraftStore();
  const snapshot = { content: "draft", baseline: "disk" };
  store.set(first, snapshot);
  snapshot.content = "mutated caller";
  assert.deepEqual(store.get(first), { content: "draft", baseline: "disk" });
  assert.equal(createFileEditorDraftStore().get(first), null);
  store.set(first, { content: "", baseline: "disk" });
  assert.equal(store.get(first).content, "");
  store.set(first, { content: "disk", baseline: "disk" });
  assert.equal(store.get(first), null);
});

test("closing file tabs discards their drafts but cannot unlock an in-flight save", async () => {
  const store = createFileEditorDraftStore();
  store.set(first, { content: "draft A", baseline: "disk A" });
  store.set(second, { content: "draft B", baseline: "disk B" });
  const release = store.beginSave(first);
  const pending = store.pendingSave(first);
  store.retainFiles(["/b.txt"]);
  assert.equal(store.get(first), null);
  assert.equal(store.get(second).content, "draft B");
  assert.equal(store.beginSave(first), null);
  release();
  await pending;
  const nextRelease = store.beginSave(first);
  assert.equal(typeof nextRelease, "function");
  release();
  assert.equal(store.beginSave(first), null);
  nextRelease();
  store.retainFiles([]);
  assert.equal(store.get(second), null);
});

test("uncertain writes preserve newer edit intent until a fresh disk read reconciles it", () => {
  const store = createFileEditorDraftStore();
  store.set(first, { content: "save snapshot", baseline: "old disk" });
  const release = store.beginSave(first);
  store.set(first, { content: "old disk", baseline: "old disk" }, true);
  release(null);
  assert.equal(store.hasProtectedEdit(first), true);
  assert.equal(store.get(first).content, "old disk");
  store.set(first, { content: "old disk", baseline: "old disk" }, false, true);
  assert.equal(store.hasProtectedEdit(first), false);
  assert.equal(store.get(first), null);
});
