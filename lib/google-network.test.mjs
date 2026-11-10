import assert from "node:assert/strict";
import test from "node:test";
import { createConnection } from "node:net";
import { once } from "node:events";
import { createServer } from "node:http";
import { decode, encode, TRUNCATED_RESPONSE } from "dns-packet";
import { createGoogleDnsFetch, startGoogleDnsProxy, startGoogleBrowserProxy } from "./google-network.ts";
import { resolveXboxDns } from "./xbox-dns.ts";

function dnsFixture(request, answers, overrides = {}) {
  const url = new URL(request);
  assert.equal(url.origin + url.pathname, "https://xbox-dns.ru/dns-query");
  const query = decode(Buffer.from(url.searchParams.get("dns"), "base64url"));
  assert.equal(query.type, "query");
  return new Response(encode({
    type: "response",
    id: query.id,
    questions: query.questions,
    answers: answers(query.questions[0]),
    ...overrides,
  }), { headers: { "Content-Type": "application/dns-message" } });
}

test("Xbox DNS resolves both families and ignores unrelated or non-public addresses", async () => {
  const answers = await resolveXboxDns("accounts.google.com", (request, init) => {
    assert.equal(init.redirect, "error");
    assert.equal(init.headers.Accept, "application/dns-message");
    return dnsFixture(request, ({ name, type }) => type === "A" ? [
      { type: "CNAME", name, data: "gateway.example", ttl: 5 },
      { type, name: "gateway.example", data: "142.251.127.84", ttl: 5 },
      { type, name: "gateway.example", data: "192.168.1.1", ttl: 5 },
      { type, name: "other.example", data: "142.251.127.95", ttl: 5 },
    ] : [
      { type, name, data: "::", ttl: 5 },
      { type, name, data: "::ffff:127.0.0.1", ttl: 5 },
      { type, name, data: "fe80::1", ttl: 5 },
      { type, name, data: "2a00:1450:4001:c21::54", ttl: 5 },
    ]);
  });
  assert.deepEqual(answers, [
    { address: "142.251.127.84", family: 4 },
    { address: "2a00:1450:4001:c21::54", family: 6 },
  ]);
});

test("sinkhole, truncated and mismatched DNS answers yield no connection address", async () => {
  const sinkhole = ({ name, type }) => [{ type, name, data: type === "A" ? "0.0.0.0" : "::", ttl: 5 }];
  const publicAnswer = ({ name, type }) => [{
    type, name, data: type === "A" ? "142.251.127.84" : "2a00:1450:4001:c21::54", ttl: 5,
  }];
  for (const fetcher of [
    url => dnsFixture(url, sinkhole),
    url => dnsFixture(url, publicAnswer, { flags: TRUNCATED_RESPONSE }),
    url => dnsFixture(url, publicAnswer, { questions: [{ type: "A", name: "wrong.google.com" }] }),
    () => new Response("HTML maintenance page"),
  ]) {
    assert.deepEqual(await resolveXboxDns("generativelanguage.googleapis.com", fetcher), []);
  }
});

test("the CONNECT proxy requires authentication and an approved HTTPS hostname", async (context) => {
  let resolutions = 0;
  const proxy = await startGoogleDnsProxy(async () => { resolutions++; return []; });
  context.after(() => proxy.server.close());
  const request = (url, proxyUrl) => fetch(url, {
    proxy: { url: proxyUrl, respectNoProxy: false },
    signal: AbortSignal.timeout(3000),
  });
  const unauthenticated = new URL(proxy.url);
  unauthenticated.username = "";
  unauthenticated.password = "";
  await assert.rejects(request("https://accounts.google.com/", unauthenticated), { status: 407 });
  for (const url of ["https://accounts.google.com:444/", "https://accounts.google.com.example/", "https://127.0.0.1/"]) {
    await assert.rejects(request(url, proxy.url), { status: 403 });
  }
  assert.equal(resolutions, 0);
});

test("Google requests stay on Xbox DNS even if NO_PROXY would allow direct connections", async (context) => {
  const lookups = [];
  const proxy = await startGoogleDnsProxy(async host => {
    lookups.push(host);
    return [{ address: "127.0.0.1", family: 4 }];
  });
  context.after(() => proxy.server.close());
  const saved = { upper: process.env.NO_PROXY, lower: process.env.no_proxy };
  context.after(() => {
    if (saved.upper === undefined) delete process.env.NO_PROXY;
    else process.env.NO_PROXY = saved.upper;
    if (saved.lower === undefined) delete process.env.no_proxy;
    else process.env.no_proxy = saved.lower;
  });
  process.env.NO_PROXY = process.env.no_proxy = "*";
  const routedFetch = createGoogleDnsFetch(fetch, async () => proxy.url);
  const hosts = ["storage.googleapis.com", "generativelanguage.googleapis.com"];
  for (const host of hosts) {
    await assert.rejects(routedFetch("https://" + host + "/", { signal: AbortSignal.timeout(3000) }),
      { message: "The Google connection through Xbox DNS failed" });
  }
  assert.deepEqual(lookups, hosts);
});

test("ordinary provider requests preserve standard fetch and transport options", async () => {
  const openai = "https://api.openai.com/v1/models";
  const init = { cache: "no-store" };
  const routedFetch = createGoogleDnsFetch(async (url, options) => {
    assert.equal(url.url, openai);
    assert.equal(url.cache, "no-store");
    assert.equal(options.proxy, undefined);
    assert.equal(options.redirect, "manual");
    return Response.json({ data: [] });
  }, () => { throw new Error("Should not start a Google tunnel"); });
  assert.deepEqual(await (await routedFetch(openai, init)).json(), { data: [] });
});

async function rawProxyRequest(proxyUrl, request) {
  const url = new URL(proxyUrl);
  const client = createConnection({ host: url.hostname, port: Number(url.port) });
  client.setTimeout(2000, () => client.destroy(new Error("Proxy test timed out")));
  try {
    await once(client, "connect");
    client.write(request);
    return String((await once(client, "data"))[0]);
  } finally { client.destroy(); }
}

test("browser tunnel is credential-free, Google-only and refuses Origin and ordinary HTTP", async (t) => {
  const resolutions = [];
  const proxy = await startGoogleBrowserProxy(async host => { resolutions.push(host); return []; });
  t.after(() => proxy.close());
  assert.equal(new URL(proxy.url).password, "");
  for (const request of [
    "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n",
    "CONNECT accounts.google.com:444 HTTP/1.1\r\nHost: accounts.google.com:444\r\n\r\n",
    "CONNECT accounts.google.com:443 HTTP/1.1\r\nHost: accounts.google.com:443\r\nOrigin: https://evil.example\r\n\r\n",
  ]) assert.match(await rawProxyRequest(proxy.url, request), /^HTTP\/1\.1 403 /);
  assert.match(await rawProxyRequest(proxy.url, "GET http://accounts.google.com/ HTTP/1.1\r\nHost: accounts.google.com\r\n\r\n"), /^HTTP\/1\.1 405 /);
  assert.deepEqual(resolutions, []);
  assert.match(await rawProxyRequest(proxy.url, "CONNECT accounts.google.com:443 HTTP/1.1\r\nHost: accounts.google.com:443\r\n\r\n"), /^HTTP\/1\.1 502 /);
  assert.deepEqual(resolutions, ["accounts.google.com"]);
});

test("closing a browser tunnel destroys pending clients and stops accepting connections", async () => {
  let resolve;
  let resolving;
  const started = new Promise(done => { resolving = done; });
  const pending = new Promise(done => { resolve = done; });
  const proxy = await startGoogleBrowserProxy(async () => { resolving(); return pending; });
  const url = new URL(proxy.url);
  const client = createConnection({ host: url.hostname, port: Number(url.port) });
  try {
    await once(client, "connect");
    client.write("CONNECT accounts.google.com:443 HTTP/1.1\r\nHost: accounts.google.com:443\r\n\r\n");
    await started;
    const closed = once(client, "close");
    await proxy.close();
    await closed;
    resolve([]);
    await proxy.close();
    await assert.rejects(rawProxyRequest(proxy.url, "GET / HTTP/1.1\r\n\r\n"), { code: "ECONNREFUSED" });
  } finally { client.destroy(); resolve([]); await proxy.close(); }
});

test("browser tunnel expires even if its owner forgets cleanup", async () => {
  const proxy = await startGoogleBrowserProxy(async () => [], 30);
  try {
    await Bun.sleep(60);
    await assert.rejects(rawProxyRequest(proxy.url, "GET / HTTP/1.1\r\n\r\n"), { code: "ECONNREFUSED" });
  } finally { await proxy.close(); }
});

test("native public HTTPS passthrough still denies unauthenticated or private destinations", async (t) => {
  const googleLookups = [];
  const proxy = await startGoogleDnsProxy(async host => { googleLookups.push(host); return []; }, true);
  t.after(() => proxy.close());
  const url = new URL(proxy.url);
  const auth = Buffer.from(decodeURIComponent(url.username) + ":" + decodeURIComponent(url.password)).toString("base64");
  assert.match(await rawProxyRequest(proxy.url, "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com\r\n\r\n"), /^HTTP\/1\.1 407 /);
  for (const host of ["127.0.0.1", "localhost"]) {
    const response = await rawProxyRequest(proxy.url, "CONNECT " + host + ":443 HTTP/1.1\r\nHost: " + host + "\r\nProxy-Authorization: Basic " + auth + "\r\n\r\n");
    assert.match(response, /^HTTP\/1\.1 502 /);
  }
  assert.deepEqual(googleLookups, []);
});

test("a redirect into Google enters Xbox DNS and strips cross-origin credentials", async () => {
  const attempts = [];
  const routedFetch = createGoogleDnsFetch(async (request, options) => {
    attempts.push({ url: request.url, method: request.method, headers: request.headers, body: await request.text(), options });
    return attempts.length === 1
      ? new Response(null, { status: 302, headers: { location: "https://accounts.google.com/" } })
      : Response.json({ ok: true });
  }, async () => "http://momp:synthetic@127.0.0.1:1234");
  const response = await routedFetch("https://custom.example/start", {
    method: "POST", body: "example", headers: { Authorization: "synthetic", Cookie: "synthetic", "X-Test": "kept" },
  });
  assert.equal(response.redirected, true);
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].options.proxy, undefined);
  assert.equal(attempts[1].options.proxy.respectNoProxy, false);
  assert.equal(attempts[1].method, "GET");
  assert.equal(attempts[1].body, "");
  assert.equal(attempts[1].headers.get("authorization"), null);
  assert.equal(attempts[1].headers.get("cookie"), null);
  assert.equal(attempts[1].headers.get("content-type"), null);
  assert.equal(attempts[1].headers.get("x-test"), "kept");
});

test("307 preserves request body and same-origin authorization without duplicate attempts", async () => {
  const attempts = [];
  const routedFetch = createGoogleDnsFetch(async (request, options) => {
    attempts.push({ method: request.method, body: await request.text(), auth: request.headers.get("authorization"), proxy: options.proxy });
    return attempts.length === 1 ? new Response(null, { status: 307, headers: { location: "/next" } }) : new Response("done");
  }, async () => "http://momp:synthetic@127.0.0.1:1234");
  assert.equal(await (await routedFetch(new Request("https://oauth2.googleapis.com/token", {
    method: "POST", body: "grant_type=synthetic", headers: { Authorization: "synthetic" },
  }))).text(), "done");
  assert.equal(attempts.length, 2);
  for (const attempt of attempts) {
    assert.equal(attempt.method, "POST");
    assert.equal(attempt.body, "grant_type=synthetic");
    assert.equal(attempt.auth, "synthetic");
    assert.equal(attempt.proxy.respectNoProxy, false);
  }
});

test("redirect error/manual policies and redirect bounds are honored", async () => {
  let calls = 0;
  const routedFetch = createGoogleDnsFetch(async () => {
    calls++;
    return new Response(null, { status: 302, headers: { location: "/again" } });
  });
  assert.equal((await routedFetch("https://custom.example/", { redirect: "manual" })).status, 302);
  assert.equal(calls, 1);
  await assert.rejects(routedFetch("https://custom.example/", { redirect: "error" }), /redirect refused/);
  assert.equal(calls, 2);
  await assert.rejects(routedFetch("https://custom.example/"), /redirect refused/);
  assert.equal(calls, 23);
});


test("native fetch cannot follow a custom endpoint redirect around the Google tunnel", async (t) => {
  const lookups = [];
  const proxy = await startGoogleDnsProxy(async host => { lookups.push(host); return []; });
  const endpoint = createServer((_, response) => response.writeHead(302, { Location: "https://accounts.google.com/" }).end());
  endpoint.listen(0, "127.0.0.1");
  await once(endpoint, "listening");
  t.after(async () => { await proxy.close(); endpoint.close(); });
  const routed = createGoogleDnsFetch(fetch, async () => proxy.url);
  await assert.rejects(routed("http://127.0.0.1:" + endpoint.address().port, {
    signal: AbortSignal.timeout(3000),
  }), { message: "The Google connection through Xbox DNS failed" });
  assert.deepEqual(lookups, ["accounts.google.com"]);
});
