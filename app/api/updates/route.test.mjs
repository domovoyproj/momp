import assert from "node:assert/strict";
import test from "node:test";
import { POST } from "./route.ts";

test("desktop HTTP endpoint cannot run the web installer", async (context) => {
  const previous = process.env.OMP_DESKTOP;
  context.after(() => {
    if (previous === undefined) delete process.env.OMP_DESKTOP;
    else process.env.OMP_DESKTOP = previous;
  });
  process.env.OMP_DESKTOP = "1";
  const response = await POST(new Request("http://127.0.0.1:30141/api/updates", {
    method: "POST",
    headers: { host: "127.0.0.1:30141", "content-type": "application/json" },
    body: "{}",
  }));
  assert.equal(response.status, 409);
  assert.match((await response.json()).error, /desktop application's update/);
});
