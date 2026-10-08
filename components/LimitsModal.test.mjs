import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(new URL("./LimitsModal.tsx", import.meta.url), "utf8");

test("keeps reset countdowns live and prioritizes Antigravity", () => {
  assert.match(source, /setInterval\(\(\) => setNow\(Date\.now\(\)\), 30_000\)/);
  assert.match(source, /left\.provider\.toLowerCase\(\) === "google-antigravity"/);
  assert.match(source, /Квота исчерпана/);
  assert.match(source, /orderedReports\?\.map/);
});
