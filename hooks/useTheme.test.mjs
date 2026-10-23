import assert from "node:assert/strict";
import test from "node:test";
import { refreshOmpTheme } from "./useTheme.ts";

test("theme changes clear previous palette variables and bootstrap metadata without clearing unrelated styles", async (context) => {
  const globals = ["window", "document", "localStorage", "fetch"];
  const saved = new Map(globals.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  context.after(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const variables = new Map([["--bootstrap-only", "red"], ["--app-viewport-height", "800px"]]);
  const classes = new Set();
  const root = {
    dataset: { ompThemeName: "cached", ompThemeVariables: '["--bootstrap-only"]' },
    style: {
      setProperty: (name, value) => variables.set(name, value),
      removeProperty: (name) => variables.delete(name),
      colorScheme: "dark",
    },
    classList: { toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
  };
  let palette = { name: "custom-first", colorScheme: "dark", variables: { "--text": "white", "--first-only": "blue" } };
  globalThis.window = { matchMedia: () => ({ matches: true }) };
  globalThis.document = { documentElement: root };
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  globalThis.fetch = async () => Response.json({ palettes: { dark: palette, light: palette } });

  await refreshOmpTheme();
  assert.equal(variables.has("--bootstrap-only"), false);
  assert.equal(variables.get("--first-only"), "blue");
  assert.equal(root.dataset.ompThemeName, "custom-first");
  assert.equal(classes.has("dark"), true);

  palette = { name: "custom-second", colorScheme: "light", variables: { "--text": "black", "--second-only": "green" } };
  await refreshOmpTheme();
  assert.equal(variables.has("--first-only"), false);
  assert.equal(variables.get("--text"), "black");
  assert.equal(classes.has("dark"), false);

  palette = { name: "titanium", colorScheme: "dark", variables: { "--text": "white" } };
  await refreshOmpTheme();
  assert.deepEqual([...variables], [["--app-viewport-height", "800px"]]);
  assert.equal(root.dataset.ompThemeName, undefined);
  assert.equal(root.dataset.ompThemeVariables, undefined);
  assert.equal(root.style.colorScheme, "dark");
  assert.equal(classes.has("dark"), true);
});
