import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { WEB_AUTH_USERNAME } from "./bin/web-auth-store.js";
import { proxy } from "./proxy.ts";

test("the login page names the username accepted by the authentication policy", async () => {
  const previous = process.env.OMP_WEB_PASSWORD;
  process.env.OMP_WEB_PASSWORD = "synthetic-test-password";
  try {
    const request = new NextRequest("http://127.0.0.1:30141/", { headers: { host: "127.0.0.1:30141" } });
    const response = proxy(request);
    assert.equal(response.status, 401);
    assert.ok((await response.text()).includes(`<code>${WEB_AUTH_USERNAME}</code>`));
  } finally {
    if (previous === undefined) delete process.env.OMP_WEB_PASSWORD;
    else process.env.OMP_WEB_PASSWORD = previous;
  }
});
