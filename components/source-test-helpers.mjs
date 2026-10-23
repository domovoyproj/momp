import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

export function sourceTree(filename) {
  const source = readFileSync(filename, "utf8");
  return ts.createSourceFile(String(filename), source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

export function findNode(tree, predicate) {
  let found;
  function visit(node) {
    if (found) return;
    if (predicate(node)) found = node;
    else ts.forEachChild(node, visit);
  }
  visit(tree);
  return found;
}

export function loadCallback(tree, name, context) {
  const declaration = findNode(tree, (node) => ts.isVariableDeclaration(node) && node.name.getText(tree) === name);
  assert.ok(declaration?.initializer, `${name} exists`);
  const callback = ts.isCallExpression(declaration.initializer)
    ? declaration.initializer.arguments[0]
    : declaration.initializer;
  const compiled = ts.transpileModule(`(${callback.getText(tree)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return vm.runInNewContext(compiled, context);
}

export function deferred() {
  let resolve;
  const promise = new Promise((complete) => { resolve = complete; });
  return { promise, resolve };
}
