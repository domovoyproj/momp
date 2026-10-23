import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { sourceTree, findNode } from "../components/source-test-helpers.mjs";

const tree = sourceTree(new URL("./useKeyboardShortcuts.ts", import.meta.url));
const hook = findNode(tree, (node) => ts.isFunctionDeclaration(node) && node.name?.text === "useGlobalKeyboardShortcuts");
const code = ts.transpileModule(`${hook.getText(tree)}\nuseGlobalKeyboardShortcuts(options);`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function setup({ dialog = false } = {}) {
  let listener;
  let aborted = 0;
  let created = 0;
  let cleanup;
  vm.runInNewContext(code, {
    exports: {},
    options: { activeCwd: "/project", onNewSession: () => { created += 1; } },
    useEffect: (effect) => { cleanup = effect(); },
    globalAbortHandler: () => { aborted += 1; },
    document: { querySelector: () => dialog ? {} : null },
    window: {
      addEventListener: (_, callback) => { listener = callback; },
      removeEventListener: (_, callback) => { if (listener === callback) listener = null; },
    },
  });
  return {
    fire: (overrides = {}) => listener({ key: "Escape", target: { tagName: "BUTTON", closest: () => null }, preventDefault() {}, ...overrides }),
    aborted: () => aborted,
    created: () => created,
    cleanup: () => cleanup(),
    listener: () => listener,
  };
}

test("handled Escape and IME composition never abort the agent", () => {
  const harness = setup();
  harness.fire({ defaultPrevented: true });
  harness.fire({ isComposing: true });
  assert.equal(harness.aborted(), 0);
});

test("Escape remains local to modal, editable and native select contexts", () => {
  const modal = setup({ dialog: true });
  modal.fire();
  assert.equal(modal.aborted(), 0);
  const harness = setup();
  for (const target of [
    { tagName: "INPUT" }, { tagName: "TEXTAREA" }, { tagName: "SELECT" },
    { tagName: "DIV", isContentEditable: true },
    { tagName: "BUTTON", closest: () => ({}) },
  ]) harness.fire({ target });
  assert.equal(harness.aborted(), 0);
});

test("unhandled Escape and new-session shortcut still work, cleanup unregisters listener", () => {
  const harness = setup();
  harness.fire();
  harness.fire({ key: "n", ctrlKey: true, altKey: true });
  assert.equal(harness.aborted(), 1);
  assert.equal(harness.created(), 1);
  harness.cleanup();
  assert.equal(harness.listener(), null);
});

test("chat unmount clears the global abort handler", () => {
  const chat = sourceTree(new URL("../components/ChatWindow.tsx", import.meta.url));
  const effect = findNode(chat, (node) => ts.isCallExpression(node) && node.expression.getText(chat) === "useEffect" && node.arguments[0]?.getText(chat).includes("registerAbortHandler"));
  assert.ok(effect);
  const callback = ts.transpileModule(`(${effect.arguments[0].getText(chat)})`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const registered = [];
  const abort = () => {};
  const cleanup = vm.runInNewContext(callback, { registerAbortHandler: (value) => registered.push(value), sessionBusy: true, handleAbort: abort })();
  assert.equal(registered[0], abort);
  assert.equal(typeof cleanup, "function");
  cleanup();
  assert.equal(registered.at(-1), null);
});
