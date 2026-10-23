import { createHash } from "node:crypto";
import { createReadStream, readFileSync, statSync, writeFileSync } from "node:fs";

async function binaryHash(target) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(target)) digest.update(chunk);
  return digest.digest("hex");
}

export async function isBunRuntimeCacheValid(target, triple, version) {
  try {
    const metadata = JSON.parse(readFileSync(`${target}.version.json`, "utf8"));
    const stats = statSync(target);
    return metadata.version === version
      && metadata.triple === triple
      && stats.isFile()
      && stats.size > 0
      && metadata.size === stats.size
      && metadata.sha256 === await binaryHash(target);
  } catch {
    return false;
  }
}

export async function writeBunRuntimeCacheMetadata(target, triple, version) {
  const stats = statSync(target);
  if (!stats.isFile() || stats.size === 0) throw new Error("Bun runtime binary is missing or empty");
  const sha256 = await binaryHash(target);
  writeFileSync(`${target}.version.json`, `${JSON.stringify({ version, triple, size: stats.size, sha256 })}\n`);
}
