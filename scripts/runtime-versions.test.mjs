import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import React from "react";
import ReactDOM from "react-dom";

const root = join(import.meta.dir, "..");
const manifest = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const installed = (name) => JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8"));

test("installed production dependency metadata satisfies the release manifest", () => {
  for (const [name, range] of Object.entries(manifest.dependencies)) {
    assert.ok(Bun.semver.satisfies(installed(name).version, range), `${name} does not satisfy ${range}`);
  }
});

test("React runtime and package metadata describe the same matching pair", () => {
  assert.equal(React.version, installed("react").version);
  assert.equal(ReactDOM.version, installed("react-dom").version);
  assert.equal(React.version, ReactDOM.version);
});
