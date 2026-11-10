// Optional Windows/Edge smoke: bun scripts/verify-google-browser.mjs
// Uses Xbox DNS and Google's public callback page, but ONLY synthetic OAuth data
// and a compiled fake CLI. No account, token exchange or model task is involved.
// This network-dependent check intentionally does not run in the ordinary CI suite.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { signInToAntigravityBrowser } from "../lib/antigravity-browser-login.ts";
import { createGoogleAuthBrowser } from "../lib/google-auth-browser.ts";
import { installGoogleDnsFetch, startGoogleBrowserProxy } from "../lib/google-network.ts";
import { resolveXboxDns } from "../lib/xbox-dns.ts";

assert.equal(process.platform, "win32", "This optional smoke requires Windows and installed Microsoft Edge.");
assert.ok(Bun.semver.satisfies(Bun.version, ">=1.4.4"), "Use the project's Bun 1.4.4 runtime or newer.");
const originalFetch = fetch;
const root = await mkdtemp(join(tmpdir(), "momp-synthetic-google-smoke-"));
const profile = join(root, "agent");
const receipt = join(root, "synthetic-receipt.json");
const phases = join(root, "synthetic-phases.json");
const browserGate = join(root, "public-callback-loaded");
const state = "momp-synthetic-state-" + crypto.randomUUID();
const code = "momp-synthetic-code-not-a-credential";
const callback = new URL("https://antigravity.google/oauth-callback");
callback.searchParams.set("state", state);
callback.searchParams.set("code", code);
const authorization = new URL("https://accounts.google.com/o/oauth2/v2/auth");
for (const [key, value] of Object.entries({
  client_id: "momp-synthetic-client-not-registered", state,
  redirect_uri: "https://antigravity.google/oauth-callback", response_type: "code",
  code_challenge: "momp-synthetic-pkce-challenge-not-a-credential", code_challenge_method: "S256",
})) authorization.searchParams.set(key, value);
let completed = false;
let navigatedAfterHandshake = false;
let routedCallback = false;
let launchedBrowser = false;
let loadedHelper = false;

let browserClosed;
let proxyStatus;
const browserEvents = [];
const nativeSource = join(root, "synthetic-cli.mjs");
const executable = join(root, "synthetic-agy.exe");

try {
  await mkdir(profile);
  const source = `
import { spawn } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
const phase = {launcherStarted:true, launcherExited:null, codeReceived:false, eof:false};
const record = () => writeFileSync(${JSON.stringify(phases)},JSON.stringify(phase));record();
const expected = ${JSON.stringify(code)};
const gate = ${JSON.stringify(browserGate)};
const launcher = spawn("rundll32", ["url.dll,FileProtocolHandler", ${JSON.stringify(authorization.href)}], {shell:false,windowsHide:true,stdio:"ignore"});
const launched = new Promise((resolve,reject)=>{launcher.once("error",reject);launcher.once("exit",value=>{phase.launcherExited=value;record();value===0?resolve():reject(new Error("Synthetic launcher failed"));});});
void launched.catch(()=>process.exit(31));
let buffer="", initialized=false, received=0;
process.stdin.setEncoding("utf8");
process.stdin.on("data", chunk=>{
 buffer+=chunk;
 const newline=buffer.indexOf("\\n");
 if(newline<0)return;
 const value=buffer.slice(0,newline);buffer=buffer.slice(newline+1);received++;
 if(value!==expected||received!==1||buffer)process.exit(32);
 phase.codeReceived=true;record();
 void (async()=>{
  await launched;
  const deadline=Date.now()+20000;
  while(!existsSync(gate)){if(Date.now()>deadline)process.exit(33);await Bun.sleep(25);}
  initialized=true;
  process.stdout.write(JSON.stringify({event:"init",conversation_id:"synthetic-no-account",init:{cwd:process.cwd()}})+"\\n");
 })().catch(()=>process.exit(34));
});
process.stdin.on("end",()=>{
 phase.eof=true;record();
 if(!initialized||received!==1||buffer)process.exit(35);
 writeFileSync(${JSON.stringify(receipt)},JSON.stringify({synthetic:true,codeDelivered:true,inputLines:received,taskSent:false}));
 process.exit(0);
});
`;
  await writeFile(nativeSource, source, { flag: "wx" });
  const compileRuntime = join(root, "fixture-bun.exe");
  await copyFile(process.execPath, compileRuntime);
  execFileSync(process.execPath, ["build", "--compile", "--no-compile-autoload-dotenv", "--no-compile-autoload-bunfig",
    "--compile-executable-path=" + compileRuntime, nativeSource, "--outfile", executable],
  { windowsHide: true, timeout: 60_000, stdio: "pipe" });

  process.env.MOMP_XBOX_DNS = "1";
  await installGoogleDnsFetch();
  await signInToAntigravityBrowser(executable, AbortSignal.timeout(60_000), {
    temporaryRoot: root, bunExecutable: process.execPath,
    env: { ...process.env, HOME: root, USERPROFILE: root },
    timeoutMs: 55_000,
    createBrowser: async options => {
      // Fixture-only navigation substitution: retain the real worker, relay,
      // state validation and tabs API. Never visit a real account consent page.
      const workerPath = join(options.extensionDirectory, "background.js");
      const worker = await readFile(workerPath, "utf8");
      const substitute = `const syntheticCreateTab = chrome.tabs.create.bind(chrome.tabs);
chrome.tabs.create = properties => {
  if (properties.url !== ${JSON.stringify(authorization.href)}) throw new Error("Unexpected synthetic navigation");
  return syntheticCreateTab({...properties, url:${JSON.stringify(callback.href)}});
};\n`;
      await writeFile(workerPath, substitute + worker);
      return createGoogleAuthBrowser({ ...options, beforeNavigate: async () => {
      browserEvents.push({event:"waiting-for-helper"});
      await options.beforeNavigate();
      browserEvents.push({event:"helper-ready"});
      navigatedAfterHandshake = true;
    }, dependencies: {
      agentDir: () => profile,
      startProxy: async () => {
        const tunnel = await startGoogleBrowserProxy(async host => {
          const addresses = await resolveXboxDns(host);
          if (host === "antigravity.google" && launchedBrowser && addresses.length) {
            routedCallback = true;
            await writeFile(browserGate, "synthetic browser route resolved through Xbox DNS");
          }
          return addresses;
        });
        // Confirm the same browser tunnel can reach Google with TLS verification.
        const response = await originalFetch("https://antigravity.google/oauth-callback", {
          method: "HEAD", proxy: { url: tunnel.url, respectNoProxy: false }, signal: AbortSignal.timeout(15_000),
        });
        proxyStatus = response.status;
        if (response.status !== 200) { await tunnel.close(); throw new Error("Public callback endpoint is unavailable through Xbox DNS."); }
        return tunnel;
      },
      spawn: (browserExecutable, args, options) => {
        assert.equal(launchedBrowser, false, "The extension flow must use a single owned browser process.");
        assert.equal(args.at(-1), "about:blank", "No account navigation may precede helper readiness.");
        launchedBrowser = true;
        loadedHelper = args.some(arg => arg.startsWith("--load-extension="));
        const testArgs = ["--headless", "--disable-gpu", "--disable-background-networking",
          ...args.filter(arg => arg !== "--new-window")];
        const child = spawn(browserExecutable, testArgs, { ...options, windowsHide: true, stdio: "ignore" });
        child.once("spawn", () => browserEvents.push({event:"spawn"}));
        child.once("error", error => browserEvents.push({event:"error",code:error.code}));
        child.once("exit", code => browserEvents.push({event:"exit",code}));
        browserClosed = new Promise(resolve => child.once("close", resolve));
        return child;
      },
    } });
    },
  });
  await browserClosed;
  assert.equal(navigatedAfterHandshake, true);
  assert.equal(launchedBrowser && loadedHelper && routedCallback, true);
  assert.equal(proxyStatus, 200);
  assert.deepEqual(JSON.parse(await readFile(receipt, "utf8")), { synthetic: true, codeDelivered: true, inputLines: 1, taskSent: false });
  assert.equal((await readdir(root)).some(name => name.startsWith("momp-agy-browser-auth-")), false, "Login-owned helper and callback extension must be removed.");
  completed = true;

} finally {
  if (completed) {
    const resolved = await realpath(root);
    const temporary = await realpath(tmpdir());
    assert.equal(dirname(resolved).toLowerCase(), temporary.toLowerCase(), "Cleanup must remain inside the owned temporary root.");
    await rm(resolved, { recursive: true, force: true, maxRetries: 12, retryDelay: 200 });
  } else {
    console.error("Synthetic browser phases: " + JSON.stringify(browserEvents));
    console.error("Synthetic-only diagnostics retained at " + root);
  }
}
console.log("PASS synthetic Google browser flow: real Edge, Xbox DNS/TLS, callback extension, generated PATH launcher, one code, clean native init/exit and cleanup; no account or model task.");
