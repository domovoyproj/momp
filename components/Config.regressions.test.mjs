import assert from "node:assert/strict";
import test from "node:test";
import ts from "typescript";
import { findNode, loadCallback, sourceTree } from "./source-test-helpers.mjs";

test("provider rename rejects collisions without deleting configuration or switching selection", () => {
  const tree = sourceTree(new URL("./ModelsConfig.tsx", import.meta.url));
  let config = { providers: { first: { apiKey: "first-secret" }, second: { apiKey: "second-secret" } } };
  let selection = { type: "provider", name: "second" };
  let error;
  const rename = loadCallback(tree, "renameProvider", {
    config,
    setConfig: (update) => { config = update(config); },
    setSelection: (update) => { selection = update(selection); },
    setSaveError: (message) => { error = message; },
  });
  rename("second", "first");
  assert.deepEqual(Object.keys(config.providers), ["first", "second"]);
  assert.equal(selection.name, "second");
  assert.ok(error);
});

test("MCP save remains reachable without a selected server and serializes an empty list", () => {
  const tree = sourceTree(new URL("./SettingsConfig.tsx", import.meta.url));
  const saveLabel = findNode(tree, (node) => ts.isStringLiteral(node) && node.text === "Save MCP");
  assert.ok(saveLabel);
  for (let node = saveLabel.parent; node; node = node.parent) {
    if (ts.isConditionalExpression(node)) assert.notEqual(node.condition.getText(tree), "server");
  }
  const commit = loadCallback(tree, "commitDraft", {
    currentScope: { servers: [] }, server: null, selected: 0, name: "", json: "",
  });
  assert.equal(JSON.stringify(commit()), "[]");
});
