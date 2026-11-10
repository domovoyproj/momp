import { createHash } from "node:crypto";
import { constants, createReadStream, createWriteStream } from "node:fs";
import { access, chmod, lstat, mkdir, mkdtemp, rename, rm } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { getAgentDir } from "@oh-my-pi/pi-coding-agent";
import { AntigravityFailure } from "./antigravity-acp";
import { xboxDnsEnabled } from "./google-network";

type FileDigest = { size: number; sha512: string };
type ReleaseFile = FileDigest & { path: string; member?: FileDigest };
type ManagedRuntime = { url: string; executable: string; file: FileDigest; member?: FileDigest };

// Google publishes the download SHA-512 values in its per-platform CLI manifests.
// For tarballs, also pin the verified member so the installed binary can be checked on reuse.
const VERSION = "1.5.5";
const RELEASE = "https://storage.googleapis.com/antigravity-public/antigravity-cli/1.5.5-6740358537805824";
const FILES: Readonly<Partial<Record<string, ReleaseFile>>> = {
  "win32-x64": {
    path: "windows-x64/cli_windows_x64.exe",
    size: 226_117_784,
    sha512: "11e01089801b86db04d92d4cec3f67bbeff90ca1076ae46bc7475415ab5f3ad7b53419252b7b2c2a68066375b2b6821a6e74a0a959892dad656d3ef769d44955",
  },
  "win32-arm64": {
    path: "windows-arm/cli_windows_arm64.exe",
    size: 214_514_328,
    sha512: "dd195d009c1b39e205916882adc7d2cc193ca768b39242fa695d412e6e4522621e5042ee948e4c915776f83d0efd7a2f02022409217b0c5d318e04c48af43dab",
  },
  "linux-x64": {
    path: "linux-x64/cli_linux_x64.tar.gz",
    size: 74_057_768,
    sha512: "746a2bd73f83b65d9b44f2fc55d0f0f511ff7f89702846213eeabd76d06bc9c98576b424c2babc7b947f15e518447b946ba02dca260b778363c55c07a7f7a277",
    member: {
      size: 247_853_456,
      sha512: "53bbde737a55a22fd93810fca64cfb45190e9fd975d2448964ecad56863375e5a9bea6bffc6ae5db9e09dd722bd7a30acce0630b3a9a9f5ebd21a6693887a174",
    },
  },
  "linux-arm64": {
    path: "linux-arm/cli_linux_arm64.tar.gz",
    size: 70_187_550,
    sha512: "eb3e025c125c1c60a1493a0c1d9cdf15e8372277d6d3b015e8d29e1bd095344eece5cbc2447f238148bd259d5f2daa0f75641adc0ac02b5fad57edc4ed842d59",
    member: {
      size: 236_540_280,
      sha512: "8c9d1ff862093810c600db9fbd39db054d0d3e3cd88531d21da29e5dbc9dcfb31cdf854195d4f8a1431eeb5978577656e2438f3e1226615c15e65a5e9cbfcf54",
    },
  },
  "darwin-x64": {
    path: "darwin-x64/cli_mac_x64.tar.gz",
    size: 71_220_827,
    sha512: "54bbe42eee81d75d746ed560995bfa7cc9d14c601b4b1a3756f5e9c0f2b79ffb9ca64894368e326e211445de2075cf54ecaecb0c26ad79d231ed819feba3618d",
    member: {
      size: 218_859_568,
      sha512: "2aa0e7fd72be24f113f32e966530cbdce16d65af5fb78ba16580978399253486a0616118618fa1030a4105de09f4729a0952f95bea318d41d361d99456b630a5",
    },
  },
  "darwin-arm64": {
    path: "darwin-arm/cli_mac_arm64.tar.gz",
    size: 65_509_958,
    sha512: "ca6424867a4527698e54b805c2456605b905a49ffc9b664ae2ee0fd4510fcd7b82d9721b2622a1d46048156a44431dc894359177fae44207363c8c878687b647",
    member: {
      size: 209_824_176,
      sha512: "79cd7c432f33894a4a417764007a5eb68d1bb75f186981e1ede60c1046060118f3b47ce98ac302b6a21fc5323917296d1392a043cecbf9a26d3d32ae26056be5",
    },
  },
};

export function managedAntigravityRuntime(): ManagedRuntime | undefined {
  // The Windows browser adapter is verified against this exact vendor build.
  // Never launch a different executable that might bypass the app's route.
  if (process.env.MOMP_ANTIGRAVITY_CLI?.trim() && !xboxDnsEnabled()) return undefined;
  const target = `${process.platform}-${process.arch}`;
  const file = FILES[target];
  if (!file) return undefined;
  const name = process.platform === "win32" ? "agy.exe" : "agy";
  return {
    url: `${RELEASE}/${file.path}`,
    executable: resolve(getAgentDir(), "momp-antigravity-runtime", VERSION, target, name),
    file,
    member: file.member,
  };
}

async function hashFile(path: string): Promise<string> {
  const digest = createHash("sha512");
  for await (const chunk of createReadStream(path)) digest.update(chunk);
  return digest.digest("hex");
}

let verified: { key: string; matches: Promise<boolean> } | undefined;

export async function findManagedAntigravity(runtime = managedAntigravityRuntime()): Promise<string | undefined> {
  if (!runtime) return undefined;
  const { executable, file, member } = runtime;
  const expected = member ?? file;
  try {
    const info = await lstat(executable);
    if (!info.isFile() || info.size !== expected.size) return undefined;
    await access(executable, constants.X_OK);
    const key = JSON.stringify([executable, expected.sha512, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
    if (verified?.key !== key) {
      verified = { key, matches: hashFile(executable).then((hash) => hash === expected.sha512, () => false) };
    }
    if (await verified.matches) return executable;
  } catch { /* No usable managed binary. */ }
}

async function downloadRuntime(runtime: ManagedRuntime, path: string, signal: AbortSignal) {
  const response = await fetch(runtime.url, { redirect: "error", signal });
  if (response.status !== 200 || !response.body) {
    await response.body?.cancel();
    throw new AntigravityFailure("setup-failed");
  }
  const digest = createHash("sha512");
  let size = 0;
  const verify = new Transform({
    transform(chunk: Buffer, _, callback) {
      size += chunk.length;
      if (size > runtime.file.size) {
        callback(new AntigravityFailure("setup-integrity"));
        return;
      }
      digest.update(chunk);
      callback(null, chunk);
    },
  });
  // The DOM and Bun declarations describe the same Web stream with different types.
  const source = Readable.fromWeb(response.body as unknown as Parameters<typeof Readable.fromWeb>[0]);
  await pipeline(source, verify, createWriteStream(path, { flags: "wx", mode: 0o600 }), { signal });
  if (size !== runtime.file.size || digest.digest("hex") !== runtime.file.sha512) {
    throw new AntigravityFailure("setup-integrity");
  }
}

export async function prepareManagedAntigravity(runtime: ManagedRuntime, signal: AbortSignal): Promise<string> {
  let staging: string | undefined;
  try {
    signal.throwIfAborted();
    const current = await findManagedAntigravity(runtime);
    if (current) return current;
    const directory = dirname(runtime.executable);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    staging = await mkdtemp(join(directory, ".download-"));
    const payload = join(staging, "payload");
    await downloadRuntime(runtime, payload, AbortSignal.any([signal, AbortSignal.timeout(600_000)]));
    signal.throwIfAborted();

    let binary = payload;
    if (runtime.member) {
      const archive = new Bun.Archive(await Bun.file(payload).bytes());
      const member = (await archive.files("antigravity")).get("antigravity");
      if (!member || member.size !== runtime.member.size) throw new AntigravityFailure("setup-integrity");
      binary = join(staging, "agy");
      await Bun.write(binary, member);
      if (await hashFile(binary) !== runtime.member.sha512) throw new AntigravityFailure("setup-integrity");
    }
    await chmod(binary, 0o700);
    signal.throwIfAborted();
    try {
      await rename(binary, runtime.executable);
    } catch (error) {
      // Another momp process may have installed and started the same release.
      if (!(await findManagedAntigravity(runtime))) throw error;
    }
    return runtime.executable;
  } catch (error) {
    if (signal.aborted) throw new AntigravityFailure("cancelled");
    if (error instanceof AntigravityFailure) throw error;
    throw new AntigravityFailure("setup-failed");
  } finally {
    if (staging) await rm(staging, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }).catch(() => {});
  }
}
