// Production UI smoke: the real default Windows route, no account or native login.
import assert from "node:assert/strict";
import { closeSync, mkdirSync, mkdtempSync, openSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

assert.equal(process.platform, "win32", "The automatic route is a Windows feature.");
const root = mkdtempSync(join(tmpdir(), "momp-google-route-ui-"));
const screenshots = resolve(process.env.MOMP_SCREENSHOTS_DIR || "test-artifacts/google-route");
mkdirSync(screenshots, { recursive: true });
const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = reservation.port;
reservation.stop(true);
const origin = `http://127.0.0.1:${port}`;
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|systemroot|windir|comspec|pathext|tmp|temp|tmpdir|omp_web_dist_dir)$/i.test(key)));
const logfile = join(root, "server.log");
const log = openSync(logfile, "w");
const server = Bun.spawn([process.execPath, "--bun", resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
  env: { ...safeEnv, HOME: root, USERPROFILE: root, APPDATA: root, LOCALAPPDATA: root,
    PI_CODING_AGENT_DIR: join(root, "agent"), NEXT_TELEMETRY_DISABLED: "1", OMP_WEB_UPDATE_INSTALL_DISABLED: "1" },
  stdout: log, stderr: log, windowsHide: true,
});
let browser;
try {
  let ready = false;
  for (let attempt = 0; attempt < 120 && server.exitCode === null; attempt++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* Booting. */ }
    await Bun.sleep(250);
  }
  assert.equal(ready, true, "Production server must start.");
  const status = await (await fetch(origin + "/api/antigravity")).json();
  assert.equal(status.googleRoute, "xbox-dns", "Windows must enable routing without a user setting.");
  assert.equal(status.canPrepare, true);
  assert.equal(status.configured, false, "Smoke uses an empty isolated account profile.");
  browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || join(process.env["ProgramFiles(x86)"], "Microsoft", "Edge", "Application", "msedge.exe") });
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    const page = await browser.newPage({ viewport: { width, height: width > 600 ? 960 : 844 }, colorScheme: theme });
    const errors = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(theme => { localStorage.setItem("pi-theme", theme); localStorage.setItem("momp-locale", "en"); }, theme);
    await page.goto(origin);
    const actions = page.locator(width < 600 ? ".workspace-toolbar" : ".sidebar-footer");
    await actions.getByRole("button", { name: "Antigravity chat", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Google Antigravity" });
    await dialog.getByText("Xbox DNS is enabled automatically.", { exact: false }).waitFor();
    assert.equal(await dialog.getByRole("button", { name: "Sign in with Google", exact: true }).isEnabled(), true);
    assert.equal(await dialog.getByRole("link", { name: /install antigravity/i }).count(), 0);
    const box = await dialog.boundingBox();
    assert.ok(box && box.x >= -1 && box.x + box.width <= width + 1, "Dialog must fit the viewport.");
    assert.deepEqual(errors, []);
    await page.screenshot({ path: join(screenshots, `google-route-${width < 600 ? "mobile" : "desktop"}-${theme}.png`), animations: "disabled" });
    await page.close();
  }
  console.log("PASS automatic Windows Google route: production startup, account-free sign-in controls, desktop/mobile light/dark screenshots; no OAuth request started.");
} catch (error) {
  console.error(readFileSync(logfile, "utf8").slice(-6000));
  throw error;
} finally {
  await browser?.close();
  server.kill();
  await server.exited;
  closeSync(log);
  rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
