import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextResponse } from "next/server";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { readModelsConfig } from "../../../../lib/models-config.ts";
import { writePrivateFileAtomicSync } from "../../../../lib/atomic-file.ts";
import { isApiRequestAllowed } from "../../../../lib/request-security.ts";

const source = fs.readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const javascript = new Bun.Transpiler({ loader: "ts" }).transformSync(source.replace(/^import .*;\r?\n/gm, "").replace(/^export /gm, ""));

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momp-model-import-"));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bindings = {
    NextResponse, existsSync: fs.existsSync, readFileSync: fs.readFileSync, join: path.join,
    getAgentDir: () => root, parseYaml, stringifyYaml, readModelsConfig,
    writePrivateFileAtomicSync, isApiRequestAllowed,
    invalidateModelsCache: () => {}, invalidateOmpRuntime: () => {},
  };
  const handler = new Function(...Object.keys(bindings), `${javascript}\nreturn POST;`)(...Object.values(bindings));
  const save = () => handler(new Request("http://localhost/api/models-config/local-discovery", {
    method: "POST", headers: { host: "localhost", "content-type": "application/json" },
    body: JSON.stringify({ providerId: "local", baseUrl: "http://127.0.0.1:11434", models: [{ id: "local-model" }] }),
  }));
  return { root, save };
}

test("local import preserves providers and extra configuration from supported legacy formats", async (context) => {
  for (const name of ["models.yaml", "models.json"]) {
    const { root, save } = fixture(context);
    const original = { providers: { existing: { baseUrl: "https://example.invalid", apiKey: "fixture-only" } }, fixtureOption: true };
    const content = name.endsWith("json") ? JSON.stringify(original) : stringifyYaml(original);
    fs.writeFileSync(path.join(root, name), content);
    assert.equal((await save()).status, 200);
    const updated = readModelsConfig(root);
    assert.deepEqual(updated.providers.existing, original.providers.existing);
    assert.equal(updated.fixtureOption, true);
    assert.equal(updated.providers.local.models[0].id, "local-model");
    assert.equal(fs.readFileSync(path.join(root, name), "utf8"), content);
  }
});

test("invalid configuration is not overwritten or bypassed during local import", async (context) => {
  for (const name of ["models.yml", "models.yaml", "models.json"]) {
    const { root, save } = fixture(context);
    const content = "providers: [unterminated";
    fs.writeFileSync(path.join(root, name), content);
    assert.equal((await save()).status, 500);
    assert.equal(fs.readFileSync(path.join(root, name), "utf8"), content);
    assert.deepEqual(fs.readdirSync(root), [name]);
  }
});

test("shared reader follows canonical precedence and rejects non-object providers", (context) => {
  const { root } = fixture(context);
  assert.deepEqual(readModelsConfig(root), { providers: {} });
  fs.writeFileSync(path.join(root, "models.json"), '{"providers":{"legacy":{}}}');
  fs.writeFileSync(path.join(root, "models.yaml"), "providers:\n  alternate: {}\n");
  fs.writeFileSync(path.join(root, "models.yml"), "providers:\n  canonical: {}\n");
  assert.deepEqual(Object.keys(readModelsConfig(root).providers), ["canonical"]);
  fs.writeFileSync(path.join(root, "models.yml"), "providers: []\n");
  assert.throws(() => readModelsConfig(root), /providers must be an object/);
});
