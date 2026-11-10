import { BlockList, isIP } from "node:net";
import { decode, encode, RECURSION_DESIRED, TRUNCATED_RESPONSE } from "dns-packet";

const RESOLVER = "https://xbox-dns.ru/dns-query";
const DNS_MESSAGE = "application/dns-message";
const DNS_SIZE_LIMIT = 65_535;

type RecordType = "A" | "AAAA";
type Address = { address: string; family: 4 | 6 };

const privateAddresses = new BlockList();
for (const [subnet, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24], ["203.0.113.0", 24],
  ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) privateAddresses.addSubnet(subnet, prefix, "ipv4");
for (const [subnet, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
] as const) privateAddresses.addSubnet(subnet, prefix, "ipv6");
const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");

export function isPublicDnsAddress(address: string, family: number): boolean {
  if (family !== isIP(address)) return false;
  if (family === 4) return !privateAddresses.check(address, "ipv4");
  return family === 6 && globalIpv6.check(address, "ipv6") && !privateAddresses.check(address, "ipv6");
}

async function readDnsMessage(response: Response): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Xbox DNS returned an empty response");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return Buffer.concat(chunks, size);
      size += value.byteLength;
      if (size > DNS_SIZE_LIMIT) {
        await reader.cancel();
        throw new Error("Xbox DNS response exceeded the DNS message limit");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
}

async function query(host: string, type: RecordType, fetcher: typeof fetch): Promise<Address[]> {
  const question = { name: host, type, class: "IN" as const };
  const message = encode({ type: "query", id: 0, flags: RECURSION_DESIRED, questions: [question] });
  const url = new URL(RESOLVER);
  url.searchParams.set("dns", message.toString("base64url"));
  const response = await fetcher(url, {
    headers: { Accept: DNS_MESSAGE },
    redirect: "error",
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok || response.headers.get("content-type")?.split(";")[0].trim() !== DNS_MESSAGE) {
    await response.body?.cancel();
    throw new Error("Xbox DNS returned an invalid response");
  }

  const reply = decode(await readDnsMessage(response));
  const [answerQuestion] = reply.questions ?? [];
  const invalidFlags = (reply.flags ?? 0) & (TRUNCATED_RESPONSE | 0x000f);
  if (reply.type !== "response" || reply.id !== 0 || invalidFlags || reply.questions?.length !== 1
    || answerQuestion?.name.toLowerCase() !== host || answerQuestion.type !== type || answerQuestion.class !== "IN") {
    return [];
  }

  // Addresses from unrelated answers and the additional section are never used.
  const family = type === "A" ? 4 : 6;
  const records = reply.answers?.filter(record => "class" in record && record.class === "IN") ?? [];
  let name = host;
  for (let hops = 0; hops < 16; hops++) {
    const addresses = records.flatMap<Address>(record => record.name.toLowerCase() === name
      && record.type === type && typeof record.data === "string" && isPublicDnsAddress(record.data, family)
      ? [{ address: record.data, family }] : []);
    if (addresses.length) return addresses.slice(0, 8);
    const alias = records.find(record => record.type === "CNAME" && record.name.toLowerCase() === name);
    if (alias?.type !== "CNAME") return [];
    name = alias.data.toLowerCase();
  }
  return [];
}

export async function resolveXboxDns(host: string, fetcher: typeof fetch = fetch): Promise<Address[]> {
  const results = await Promise.allSettled([query(host, "A", fetcher), query(host, "AAAA", fetcher)]);
  return results.flatMap(result => result.status === "fulfilled" ? result.value : []);
}
