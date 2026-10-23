import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as runtime from "react/jsx-runtime";
import ts from "typescript";
import { sourceTree, findNode } from "./source-test-helpers.mjs";

function loadControls(filename, names) {
  const tree = sourceTree(new URL(filename, import.meta.url));
  const definitions = names.map((name) => findNode(tree, (node) =>
    (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name?.getText(tree) === name))
    .filter(Boolean).map((node) => ts.isVariableDeclaration(node) ? `const ${node.getText(tree)};` : node.getText(tree));
  const code = ts.transpileModule(`${definitions.join("\n")}\nexports.controls = {${names.filter((name) => !["inputStyle", "FieldLabelContext"].includes(name)).join(",")}};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  const context = {
    ...React, exports: {}, require: () => runtime,
    styles: {},
    useI18n: () => ({ t: (key) => key }),
    SearchableSelect: ({ ariaLabel }) => React.createElement("button", { "aria-label": ariaLabel }),
  };
  vm.runInNewContext(code, context);
  return context.exports.controls;
}

test("boolean, text and JSON settings have their visible field names", () => {
  const controls = loadControls("./SettingsConfig.tsx", ["SettingControl", "TextSetting", "ProviderLimitsSetting"]);
  for (const [name, type] of [["SettingControl", "boolean"], ["TextSetting", "text"], ["ProviderLimitsSetting", "providerLimits"]]) {
    const html = renderToStaticMarkup(React.createElement(controls[name], { field: { label: "Named setting", path: "test", type, value: type === "providerLimits" ? {} : "" }, busy: false, onSave() {} }));
    assert.match(html, /<(?:button|input|textarea)\b[^>]*aria-label="Named setting"/);
  }
});

test("model Field names reach text, secret, numeric and select controls through nested layout", () => {
  const controls = loadControls("./ModelsConfig.tsx", ["FieldLabelContext", "inputStyle", "Field", "TextInput", "SecretTextInput", "NumInput", "Select"]);
  for (const name of ["TextInput", "SecretTextInput", "NumInput", "Select"]) {
    const html = renderToStaticMarkup(React.createElement(controls.Field, { label: "Provider field" },
      React.createElement("div", null, React.createElement(controls[name], { value: "", options: [], onChange() {} }))));
    assert.match(html, /<(?:input|button)\b[^>]*aria-label="Provider field"/);
  }
});

test("password inputs are associated with visible labels", () => {
  const source = readFileSync(new URL("./AccessConfig.tsx", import.meta.url), "utf8");
  assert.match(source, /<label\s+htmlFor=\{passwordId\}[^>]*>Новый пароль<\/label>/);
  assert.match(source, /<input\s+id=\{passwordId\}/);
  assert.match(source, /<label\s+htmlFor=\{confirmationId\}[^>]*>Подтверждение пароля<\/label>/);
  assert.match(source, /<input\s+id=\{confirmationId\}/);
});

function luminance(hex) {
  const channels = hex.match(/[a-f\d]{2}/gi).map((value) => parseInt(value, 16) / 255)
    .map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

test("built-in light and dark accent foreground pairs meet normal text contrast", () => {
  const css = readFileSync(new URL("../app/workspace.css", import.meta.url), "utf8");
  const palettes = [...css.matchAll(/--bg:\s*(#[\da-f]{6});[\s\S]*?--accent:\s*(#[\da-f]{6});/gi)];
  assert.equal(palettes.length, 2);
  for (const [, background, accent] of palettes) {
    const values = [luminance(background), luminance(accent)].sort((first, second) => second - first);
    assert.ok((values[0] + 0.05) / (values[1] + 0.05) >= 4.5);
  }
  for (const file of ["ProjectTrustDialog.tsx", "FileViewer.tsx", "ModelsConfig.tsx", "ChatWindow.tsx"]) {
    const source = readFileSync(new URL(file, import.meta.url), "utf8");
    assert.doesNotMatch(source, /background:\s*"var\(--accent\)"[^}]*?color:\s*"(?:white|#fff)"/);
  }
  assert.match(readFileSync(new URL("FileViewer.tsx", import.meta.url), "utf8"), /color: isDirty \? "var\(--bg\)"/);
});
