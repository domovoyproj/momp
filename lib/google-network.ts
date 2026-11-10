import { randomBytes, timingSafeEqual } from "node:crypto";
import { once } from "node:events";
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

export async function startGoogleDnsProxy(resolveHost = resolveXboxDns) {
  const password = randomBytes(32).toString("base64url");
  const expected = Buffer.from("Basic " + Buffer.from("momp:" + password).toString("base64"));
  const server = createServer({ maxHeaderSize: 8192, headersTimeout: 5_000, requestTimeout: 5_000 }, (_, response) => {
    response.writeHead(405, { Connection: "close" }).end();
  });
  server.maxConnections = 64;
  server.on("connect", (request, _, initialBytes) => {
    const client = request.socket;
    client.unref();
    client.setTimeout(12_000, () => client.destroy());
    client.on("error", () => client.destroy());
    const supplied = Buffer.from(request.headers["proxy-authorization"] ?? "");
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) {
      refuse(client, "407 Proxy Authentication Required");
      return;
    }
    const hostname = request.url?.match(/^([a-z0-9.-]+):443$/i)?.[1].toLowerCase().replace(/\.$/, "");
    if (!hostname || !isGoogleHost(hostname)) {
      refuse(client, "403 Destination not allowed");
      return;
    }
    client.pause();
    void connectGoogle(hostname, client, initialBytes, resolveHost).catch(() => refuse(client, "502 Xbox DNS unavailable"));
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
  return { server, url: "http://momp:" + password + "@127.0.0.1:" + address.port };
}

async function googleProxyUrl(): Promise<string> {
  runtime.__mompXboxDnsProxy ??= startGoogleDnsProxy().then(proxy => {
    runtime.__mompXboxDnsProxyUrl = proxy.url;
    return proxy;
  }).catch(error => {
    delete runtime.__mompXboxDnsProxy;
    throw error;
  });
  return (await runtime.__mompXboxDnsProxy).url;
}

export function createGoogleDnsFetch(fetcher: typeof fetch, proxyUrl = googleProxyUrl): typeof fetch {
  return Object.assign(async (input: RequestInfo | URL, init?: BunFetchRequestInit) => {
    let url: URL;
    try { url = new URL(input instanceof Request ? input.url : input); }
    catch { return fetcher(input, init); }
    if (!isGoogleHost(url.hostname.replace(/\.$/, ""))) return fetcher(input, init);
    if (url.protocol !== "https:" || (url.port && url.port !== "443")) {
      throw new Error("Xbox DNS Google connections require HTTPS on port 443");
    }
    try {
      return await fetcher(input, {
        ...init, unix: undefined,
        proxy: { url: await proxyUrl(), respectNoProxy: false },
        tls: { ...init?.tls, rejectUnauthorized: true },
      });
    } catch (error) {
      if (init?.signal?.aborted || input instanceof Request && input.signal.aborted) throw error;
      throw new Error("The Google connection through Xbox DNS failed");
    }
  }, fetcher);
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
