import assert from "node:assert/strict";
import test from "node:test";
import { decode, encode, TRUNCATED_RESPONSE } from "dns-packet";
import { createGoogleDnsFetch, startGoogleDnsProxy } from "./google-network.ts";
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

test("ordinary provider requests keep their original fetch options", async () => {
  const openai = "https://api.openai.com/v1/models";
  const init = { cache: "no-store" };
  const routedFetch = createGoogleDnsFetch(async (url, options) => {
    assert.equal(url, openai);
    assert.equal(options, init);
    return Response.json({ data: [] });
  }, () => { throw new Error("Should not start a Google tunnel"); });
  assert.deepEqual(await (await routedFetch(openai, init)).json(), { data: [] });
});
