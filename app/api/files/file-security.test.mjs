import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET } from "./[...path]/route.ts";

function fixture(context, name, content) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "momp-file-security-"));
  const previousCache = globalThis.__ompAllowedRootsCache;
  const filePath = path.join(root, name);
  fs.writeFileSync(filePath, content);
  globalThis.__ompAllowedRootsCache = { roots: new Set([root]), expiresAt: Date.now() + 60000 };
  context.after(() => {
    globalThis.__ompAllowedRootsCache = previousCache;
    fs.rmSync(root, { recursive: true, force: true });
  });
  return filePath.replaceAll("\\", "/").split("/").filter(Boolean);
}

test("SVG responses isolate active content on full and range requests", async (context) => {
  const content = '<svg xmlns="http://www.w3.org/2000/svg"><script>window.audit=true</script></svg>';
  const segments = fixture(context, "active.svg", content);
  for (const range of [undefined, "bytes=0-9"]) {
    const response = await GET(new NextRequest("http://localhost/api/files/fixture?type=read", {
      headers: { host: "localhost", ...(range ? { range } : {}) },
    }), { params: Promise.resolve({ path: segments }) });
    assert.equal(response.status, range ? 206 : 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const policy = response.headers.get("content-security-policy");
    assert.match(policy, /(?:^|;)\s*sandbox\s*(?:;|$)/);
    assert.match(policy, /script-src 'none'/);
    assert.match(policy, /default-src 'none'/);
    assert.doesNotMatch(policy, /allow-scripts|allow-same-origin/);
    assert.equal(await response.text(), range ? content.slice(0, 10) : content);
  }
});

test("raster image previews keep their MIME and are not sniffed as documents", async (context) => {
  const segments = fixture(context, "raster.png", Buffer.from([137, 80, 78, 71]));
  const response = await GET(new NextRequest("http://localhost/api/files/fixture?type=read"), {
    params: Promise.resolve({ path: segments }),
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal((await response.arrayBuffer()).byteLength, 4);
});
