import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
import { lookup } from "node:dns/promises";
import { createServer } from "node:http";
import { createConnection, type Socket } from "node:net";
import { isPublicDnsAddress, resolveXboxDns } from "./xbox-dns";

const GOOGLE_DOMAINS = ["google.com", "googleapis.com", "antigravity.google", "gstatic.com", "googleusercontent.com"];
const GOOGLE_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const LOCAL_BYPASS = "localhost,127.0.0.1,::1,[::1]";
export const XBOX_DNS_BROWSER_REQUIRED = "Google sign-in through Xbox DNS requires a managed browser route.";

type ProxyRuntime = Awaited<ReturnType<typeof startGoogleDnsProxy>>;
const runtime = globalThis as typeof globalThis & {
  __mompXboxDnsProxy?: Promise<ProxyRuntime>;
  __mompXboxDnsProxyUrl?: string;
  __mompXboxDnsFetchInstalled?: boolean;
};

export function xboxDnsEnabled(): boolean {
  return process.env.MOMP_XBOX_DNS === "1";
}

function isGoogleHost(host: string): boolean {
  return host.length <= 253 && GOOGLE_HOST.test(host)
    && GOOGLE_DOMAINS.some(domain => host === domain || host.endsWith("." + domain));
}

function refuse(socket: Socket, status: string): void {
  if (!socket.destroyed) socket.end("HTTP/1.1 " + status + "\r\nConnection: close\r\nContent-Length: 0\r\n\r\n");
}

async function connectGoogle(
  hostname: string, client: Socket, initialBytes: Buffer, resolveHost: typeof resolveXboxDns,
): Promise<void> {
  const addresses = (await resolveHost(hostname)).filter(({ address, family }) => isPublicDnsAddress(address, family));
  if (client.destroyed) return;
  if (!addresses.length) {
    refuse(client, "502 Xbox DNS unavailable");
    return;
  }

  // The lookup callback contains only addresses returned by the DoH resolver.
  // TLS stays inside the tunnel and is verified for the original hostname.
  const upstream = createConnection({
    host: hostname, port: 443, autoSelectFamily: true,
    lookup: (_host, options, callback) => {
      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    },
  });
  let connected = false;
  client.once("close", () => upstream.destroy());
  upstream.setTimeout(6_000, () => upstream.destroy(new Error("Connection timed out")));
  upstream.once("error", () => {
    if (connected) client.destroy();
    else refuse(client, "502 Xbox DNS connection failed");
  });
  upstream.once("close", () => {
    if (connected && !upstream.readableEnded) client.destroy();
  });
  upstream.once("connect", () => {
    connected = true;
    upstream.unref();
    upstream.setTimeout(0);
    client.setTimeout(300_000);
    client.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    if (initialBytes.length) upstream.write(initialBytes);
    client.pipe(upstream).pipe(client);
  });
}

async function resolvePublicHost(host: string): Promise<Awaited<ReturnType<typeof resolveXboxDns>>> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const answers = await Promise.race([
      lookup(host, { all: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error("DNS lookup timed out")), 5_000);
        timer.unref();
      }),
    ]);
    return answers.flatMap(({ address, family }) => isPublicDnsAddress(address, family)
      ? [{ address, family: family as 4 | 6 }] : []);
  } finally { clearTimeout(timer); }
}

async function startTunnelProxy(options: {
  resolveHost: typeof resolveXboxDns;
  authenticated: boolean;
  publicHttps?: boolean;
  lifetimeMs?: number;
}) {
  const password = options.authenticated ? randomBytes(32).toString("base64url") : undefined;
  const expected = password && Buffer.from("Basic " + Buffer.from("momp:" + password).toString("base64"));
  const sockets = new Set<Socket>();
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 5_000, requestTimeout: 5_000 }, (_, response) => {
    response.writeHead(405, { Connection: "close" }).end();
  });
  server.maxConnections = 64;
  server.on("connection", socket => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
    socket.unref();
    socket.setTimeout(12_000, () => socket.destroy());
    socket.on("error", () => socket.destroy());
  });
  server.on("connect", (request, _, initialBytes) => {
    const client = request.socket;
    // The browser proxy is scoped to this machine and session. Browser pages
    // cannot turn an Origin-bearing request into an unrestricted local tunnel.
    if (request.headers.origin !== undefined || client.remoteAddress !== "127.0.0.1") {
      refuse(client, "403 Request not allowed");
      return;
    }
    if (expected) {
      const supplied = Buffer.from(request.headers["proxy-authorization"] ?? "");
      if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
        refuse(client, "407 Proxy Authentication Required");
        return;
      }
    }
    const hostname = request.url?.match(/^([a-z0-9.-]+):443$/i)?.[1].toLowerCase().replace(/\.$/, "");
    if (!hostname || !GOOGLE_HOST.test(hostname) || hostname.length > 253
      || !isGoogleHost(hostname) && !options.publicHttps) {
      refuse(client, "403 Destination not allowed");
      return;
    }
    client.pause();
    const resolver = isGoogleHost(hostname) ? options.resolveHost : resolvePublicHost;
    void connectGoogle(hostname, client, initialBytes, resolver).catch(() => refuse(client, "502 Connection unavailable"));
  });

  const listening = once(server, "listening");
  server.listen(0, "127.0.0.1");
  await listening;
  const address = server.address();
  if (!address || typeof address === "string") {
    server.close();
    throw new Error("Could not start the Xbox DNS tunnel");
  }
  server.unref();
  let closing: Promise<void> | undefined;
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const close = () => closing ??= new Promise<void>(resolve => {
    clearTimeout(expiry);
    for (const socket of sockets) socket.destroy();
    server.close(() => resolve());
  });
  if (options.lifetimeMs !== undefined) {
    expiry = setTimeout(() => void close(), options.lifetimeMs);
    expiry.unref();
  }
  return { server, close, url: "http://" + (password ? "momp:" + password + "@" : "") + "127.0.0.1:" + address.port };
}

export async function startGoogleDnsProxy(resolveHost = resolveXboxDns, publicHttps = false) {
  return startTunnelProxy({ resolveHost, authenticated: true, publicHttps });
}

// Separate from the authenticated native transport: Google-only, short-lived,
// loopback-only, with no proxy password prompt in the real browser.
export async function startGoogleBrowserProxy(resolveHost = resolveXboxDns, lifetimeMs = 5 * 60_000) {
  const { url, close } = await startTunnelProxy({ resolveHost, authenticated: false, lifetimeMs });
  return { url, close };
}

async function googleProxyUrl(): Promise<string> {
  runtime.__mompXboxDnsProxy ??= startGoogleDnsProxy(resolveXboxDns, true).then(proxy => {
    runtime.__mompXboxDnsProxyUrl = proxy.url;
    return proxy;
  }).catch(error => {
    delete runtime.__mompXboxDnsProxy;
    throw error;
  });
  return (await runtime.__mompXboxDnsProxy).url;
}

export function createGoogleDnsFetch(fetcher: typeof fetch, proxyUrl = googleProxyUrl): typeof fetch {
  const routedFetch = async (input: RequestInfo | URL, init?: BunFetchRequestInit) => {
    let url: URL;
    try { url = new URL(input instanceof Request ? input.url : input); }
    catch { return fetcher(input, init); }
    if (url.protocol !== "http:" && url.protocol !== "https:") return fetcher(input, init);
    let request = new Request(input, init);
    // Inspect every redirect, including a custom endpoint redirecting into Google.
    // Request owns the standard fetch fields; retain Bun's transport extensions.
    const transport = { ...init, redirect: "manual" as const };
    for (const key of ["method", "body", "headers", "signal", "cache", "credentials", "integrity", "keepalive", "mode", "referrer", "referrerPolicy"] as const) {
      delete transport[key];
    }
    try {
      for (let hops = 0; ; hops++) {
        const google = isGoogleHost(url.hostname.replace(/\.$/, ""));
        if (google && (url.protocol !== "https:" || url.port && url.port !== "443")) {
          throw new Error("Xbox DNS Google connections require HTTPS on port 443");
        }
        let response: Response;
        try {
          const options: BunFetchRequestInit = google ? {
            ...transport, unix: undefined,
            proxy: { url: await proxyUrl(), respectNoProxy: false },
            tls: { ...init?.tls, rejectUnauthorized: true },
          } : transport;
          // Keep a replayable copy for 307/308. Release it on the terminal response.
          response = await fetcher(request.clone(), options);
        } catch (error) {
          if (!google || request.signal.aborted) throw error;
          throw new Error("The Google connection through Xbox DNS failed");
        }
        const location = response.headers.get("location");
        if (!location || ![301, 302, 303, 307, 308].includes(response.status) || request.redirect === "manual") {
          if (hops) Object.defineProperty(response, "redirected", { value: true });
          return response;
        }
        await response.body?.cancel();
        if (request.redirect === "error" || hops >= 20) throw new TypeError("Fetch redirect refused");
        const next = new URL(location, url);
        if (!["http:", "https:"].includes(next.protocol) || next.username || next.password) {
          throw new TypeError("Invalid fetch redirect destination");
        }
        const headers = new Headers(request.headers);
        if (next.origin !== url.origin) {
          for (const name of ["authorization", "cookie", "proxy-authorization"]) headers.delete(name);
        }
        const changeToGet = response.status === 303 && request.method !== "GET" && request.method !== "HEAD"
          || (response.status === 301 || response.status === 302) && request.method === "POST";
        if (changeToGet) {
          for (const name of ["content-encoding", "content-language", "content-location", "content-type", "content-length"]) headers.delete(name);
          void request.body?.cancel().catch(() => {});
        }
        request = new Request(next, {
          method: changeToGet ? "GET" : request.method, headers,
          body: changeToGet ? undefined : request.body,
          signal: request.signal, redirect: request.redirect, cache: request.cache,
          credentials: request.credentials, integrity: request.integrity,
          referrer: request.referrer, referrerPolicy: request.referrerPolicy,
        });
        url = next;
      }
    } finally { void request.body?.cancel().catch(() => {}); }
  };
  return Object.assign(routedFetch, fetcher, {
    // Native preconnect cannot use this per-request tunnel. Google warm-ups use
    // the SDK's ordinary HEAD transport instead; never open a direct socket here.
    preconnect: (url: string | URL, options?: Parameters<typeof fetch.preconnect>[1]) => {
      if (!isGoogleHost(new URL(url).hostname.replace(/\.$/, ""))) fetcher.preconnect?.(url, options);
    },
  });
}

export async function installGoogleDnsFetch(): Promise<void> {
  if (!xboxDnsEnabled()) return;
  if (!runtime.__mompXboxDnsFetchInstalled) {
    globalThis.fetch = createGoogleDnsFetch(globalThis.fetch);
    runtime.__mompXboxDnsFetchInstalled = true;
  }
  // A bind failure leaves other providers available. Google fetches retry the
  // local startup, and CLI launches fail before starting any direct requests.
  await googleProxyUrl().catch(() => {});
}

export function antigravityNetworkEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  if (!xboxDnsEnabled()) return env;
  const proxy = runtime.__mompXboxDnsProxyUrl;
  if (!proxy) throw new Error("The Xbox DNS tunnel is unavailable");
  const passthrough = { ...env };
  for (const key of Object.keys(passthrough)) {
    if (/^(?:https?|all|no|grpc)_proxy$/i.test(key)) delete passthrough[key];
  }
  return { ...passthrough, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, NO_PROXY: LOCAL_BYPASS };
}
