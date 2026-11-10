import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";
import { buildAntigravityFixture } from "./fixtures/build-antigravity.mjs";

const fixture = mkdtempSync(join(tmpdir(), "momp-browser-"));
const project = join(fixture, "project");
const agentDir = join(fixture, "agent");
const screenshots = resolve(process.env.MOMP_SCREENSHOTS_DIR || "test-artifacts/browser");
for (const directory of [project, agentDir, screenshots]) mkdirSync(directory, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: project, windowsHide: true });
const cliDirectory = process.platform === "win32" ? join(fixture, "agy", "bin") : join(fixture, ".local", "bin");
const cliExecutable = join(cliDirectory, process.platform === "win32" ? "agy.exe" : "agy");
const cliAccount = join(cliDirectory, "fixture-google-sign-in");
mkdirSync(cliDirectory, { recursive: true });
renameSync(buildAntigravityFixture(fixture), cliExecutable);
git("init", "-q", "--template=");
git("config", "core.autocrlf", "false");
writeFileSync(join(project, "greeting.txt"), "Hello\n");
writeFileSync(join(project, "greeting.test.mjs"), 'import { expect, test } from "bun:test";\ntest("workspace greeting", async () => expect(await Bun.file("greeting.txt").text()).toBe("Hello, workspace!\\n"));\n');
const sampleWorkspace = 'export interface WorkspaceTask {\n  title: string;\n  status: "ready" | "running" | "complete";\n}\n\nexport function titleForTask(task: WorkspaceTask): string {\n  return task.title.trim();\n}\n';
writeFileSync(join(project, "workspace.ts"), sampleWorkspace);
git("add", "greeting.txt", "greeting.test.mjs", "workspace.ts");
git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Browser fixture");

const providerCalls = [];
const proposal = JSON.stringify({ summary: "Update the welcome message to Hello, workspace!", changes: [{ path: "greeting.txt", content: "Hello, workspace!\n" }] });
const review = "The change matches the request. Add an assertion for the exact greeting in the application test suite.";
const gptChat = "The workspace uses a small typed task model. The greeting is tracked in Git.";
const geminiChat = "The fixture contains a typed workspace and a tracked greeting.";
const event = (value) => `data: ${JSON.stringify(value)}\n\n`;
const mock = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  const headers = { "Content-Type": "text/event-stream" };
  if (request.method === "POST" && path.endsWith("/chat/completions")) {
    const body = await request.json();
    providerCalls.push({ provider: "GPT", body });
    const reply = JSON.stringify(body).includes("Perform this coding task") ? proposal : gptChat;
    const chunk = { id: "chatcmpl-test", object: "chat.completion.chunk", model: "gpt-browser-fixture", created: 123 };
    return new Response(event({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: reply }, finish_reason: null }] })
      + event({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "data: [DONE]\n\n", { headers });
  }
  if (request.method === "POST" && path.includes(":streamGenerateContent")) {
    const body = await request.json();
    providerCalls.push({ provider: "Gemini", body });
    const reply = JSON.stringify(body).includes("Independently review") ? review : geminiChat;
    return new Response(event({ candidates: [{ index: 0, content: { role: "model", parts: [{ text: reply }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 32, candidatesTokenCount: 20, totalTokenCount: 52 } }), { headers });
  }
  return Response.json({ data: [], models: [] });
} });

writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {
  openai: { api: "openai-completions", baseUrl: `${mock.url.origin}/v1`, apiKey: "fixture-key", models: [{ id: "gpt-browser-fixture", name: "GPT fixture" }] },
  google: { api: "google-generative-ai", baseUrl: `${mock.url.origin}/v1beta`, apiKey: "fixture-key", models: [{ id: "gemini-browser-fixture", name: "Gemini fixture" }] },
} }));

const mcpServer = {
  type: "stdio", enabled: false, command: "fixture-tool", args: ["--token", "SYNTHETIC-ARG", "--api-key=SYNTHETIC-KEY"],
  env: { FIXTURE_MODE: "SYNTHETIC-ENV" }, auth: { example: ["SYNTHETIC-AUTH"] },
};
const mcpPath = join(agentDir, "mcp.json");
writeFileSync(mcpPath, JSON.stringify({ mcpServers: {
  "workspace-tool": mcpServer,
  "workspace-http": { type: "http", enabled: false, url: "https://example.invalid/mcp?token=SYNTHETIC-URL" },
} }));
const skillDir = join(agentDir, "skills", "workspace-checks");
mkdirSync(skillDir, { recursive: true });
writeFileSync(join(skillDir, "SKILL.md"), "---\nname: workspace-checks\ndescription: Review the sample workspace.\n---\n# Workspace checks\nRead greeting.txt and inspect the Git diff.\n");

const portReservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = portReservation.port;
portReservation.stop(true);
const origin = `http://127.0.0.1:${port}`;
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|systemroot|windir|comspec|pathext|tmp|temp|tmpdir|omp_web_dist_dir)$/i.test(key)));
const serverLog = join(fixture, "server.log");
const log = openSync(serverLog, "w");
const server = Bun.spawn([process.execPath, "--bun", resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
  env: { ...safeEnv, PI_CODING_AGENT_DIR: agentDir, HOME: fixture, USERPROFILE: fixture,
    // This suite uses the synthetic ACP executable. The real browser route has
    // its own contract tests and optional verify-google-browser.mjs smoke.
    MOMP_XBOX_DNS: "0",
    APPDATA: fixture, LOCALAPPDATA: fixture, NEXT_TELEMETRY_DISABLED: "1", OMP_WEB_UPDATE_INSTALL_DISABLED: "1",
    MOMP_TEST_RUNNER_IMAGE: process.env.MOMP_TEST_RUNNER_IMAGE },
  stdout: log, stderr: log,
});

let browser;
let activePage;
try {
  let ready = false;
  for (let i = 0; i < 120 && server.exitCode === null; i++) {
    try { if ((await fetch(origin)).ok) { ready = true; break; } } catch { /* starting */ }
    await Bun.sleep(250);
  }
  assert.ok(ready, "Production application did not start");
  browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  const movedProject = join(fixture, "moved-project");
  mkdirSync(movedProject);
  writeFileSync(join(movedProject, "marker.txt"), "This project will move during the test.\n");
  const recoveryPage = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: "en-US" });
  activePage = recoveryPage;
  await recoveryPage.addInitScript(() => localStorage.setItem("momp-locale", "en"));
  const initialGitStatus = recoveryPage.waitForResponse((response) => new URL(response.url()).pathname === "/api/git/status");
  await recoveryPage.goto(`${origin}/?${new URLSearchParams({ cwd: movedProject })}`);
  await recoveryPage.getByText("marker.txt", { exact: true }).waitFor();
  await initialGitStatus;
  const relocatedProject = `${movedProject}-new-location`;
  // Git can hold the directory open briefly during workspace discovery on Windows.
  for (let attempt = 0; ; attempt++) {
    try { renameSync(movedProject, relocatedProject); break; }
    catch (error) {
      if (process.platform !== "win32" || error.code !== "EBUSY" || attempt === 15) throw error;
      await Bun.sleep(100);
    }
  }
  await recoveryPage.getByTitle("Refresh explorer", { exact: true }).click();
  const unavailable = "This project folder is unavailable. Select an existing folder to continue.";
  const explorerRecovery = recoveryPage.getByText(unavailable, { exact: false });
  await explorerRecovery.getByRole("button", { name: "Open project" }).click();
  const picker = recoveryPage.getByRole("dialog", { name: "Select directory" });
  await picker.waitFor();
  await recoveryPage.keyboard.press("Escape");
  await picker.waitFor({ state: "detached" });
  await recoveryPage.getByRole("button", { name: "Skills library" }).click();
  const skills = recoveryPage.getByRole("dialog", { name: "Settings" });
  await skills.getByText(unavailable, { exact: false }).waitFor();
  await recoveryPage.screenshot({ path: join(screenshots, "unavailable-project-skills.png"), animations: "disabled" });
  await skills.getByRole("button", { name: "Open project" }).click();
  await picker.waitFor();
  await picker.getByText("Loading directories…", { exact: true }).waitFor({ state: "hidden" });
  const pathInput = picker.getByRole("textbox", { name: "Directory path" });
  await pathInput.fill(relocatedProject);
  await pathInput.press("Enter");
  await picker.getByRole("button", { name: "Select this folder", exact: true }).click();
  await picker.waitFor({ state: "detached" });
  await recoveryPage.getByText("marker.txt", { exact: true }).waitFor();
  await recoveryPage.close();
  console.log("PASS moved workspace: explorer and skills recover by selecting the new folder");

  let taskId;
  let antigravityChecked = false;
  let mcpSaved = false;
  for (const [theme, viewport] of [["light", { width: 1440, height: 960 }], ["dark", { width: 1440, height: 960 }], ["light", { width: 390, height: 844 }], ["dark", { width: 390, height: 844 }]]) {
    writeFileSync(join(project, "workspace.ts"), sampleWorkspace);
    const page = await browser.newPage({ viewport, colorScheme: theme, locale: "en-US", hasTouch: viewport.width < 600 });
    activePage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let updateChecksFail = false;
    let updateInstalls = 0;
    await page.route("**/api/updates", (route) => {
      if (route.request().method() === "POST") { updateInstalls++; return route.fulfill({ status: 409, json: {} }); }
      if (updateChecksFail) return route.fulfill({ status: 503, json: { error: "fixture offline" } });
      return route.fulfill({ json: {
        currentAppVersion: "1.6.0-rc.2", checkedAt: new Date().toISOString(), desktop: false, updateAvailable: true,
        latestRelease: { version: "1.6.1", tagName: "v1.6.1", name: "Fixture release", body: "Fixed project session recovery.",
          htmlUrl: "https://github.com/domovoyproj/momp/releases", publishedAt: null },
        availability: "installable", install: { canInstall: true, command: "bun add -g momp-web", alternateCommand: "npm i -g momp-web" },
      } });
    });
    await page.addInitScript(({ theme }) => {
      localStorage.setItem("pi-theme", theme);
      localStorage.setItem("momp-locale", "en");
    }, { theme });
    await page.goto(`${origin}/?${new URLSearchParams({ cwd: project })}`);
    const size = viewport.width < 600 ? "mobile" : "desktop";
    const workspaceActions = page.locator(size === "mobile" ? ".workspace-toolbar" : ".sidebar-footer");
    const button = workspaceActions.getByRole("button", { name: "AI tasks", exact: true });
    await page.getByRole("heading", { name: "Where shall we start?", exact: true }).waitFor();
    await page.screenshot({ path: join(screenshots, `workspace-${size}-${theme}.png`), animations: "disabled" });
    const toggleSidebar = page.getByRole("button", { name: "Show sidebar", exact: true });
    const sidebarResize = page.locator(".sidebar-resize-handle");
    if (size === "mobile") {
      await page.setViewportSize({ width: viewport.width, height: 630 });
      await toggleSidebar.click();
    } else {
      await page.setViewportSize({ width: 1000, height: 680 });
      await sidebarResize.press("Home");
    }
    const projectRow = page.locator(".sidebar-project").filter({ hasText: /^project/ });
    const menuTrigger = projectRow.getByRole("button", { name: "Project actions", exact: true });
    if (size === "mobile") await menuTrigger.tap();
    else await menuTrigger.click();
    const menu = page.getByRole("group", { name: "Project actions" });
    await menu.waitFor();
    assert.equal(await menu.evaluate((node) => {
      const rect = node.getBoundingClientRect();
      return rect.left >= 0 && rect.right <= innerWidth && rect.top >= 0 && rect.bottom <= innerHeight;
    }), true, "Project menu fits within the viewport");
    for (const name of ["Copy project path", "Rename", "Remove from sidebar", "Delete folder from disk"]) {
      const action = menu.getByRole("button", { name, exact: true });
      await action.scrollIntoViewIfNeeded();
      assert.equal(await action.evaluate((node) => {
        const { x, y, width, height } = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(x + width / 2, y + height / 2));
      }), true, `${name} is reachable outside the project list`);
    }
    const menuBounds = await menu.boundingBox();
    assert.ok(menuBounds);
    const menuViewport = page.viewportSize();
    await page.screenshot({ path: join(screenshots, `project-menu-${size}-${theme}.png`), animations: "disabled", clip: {
      x: 0, y: 0, width: Math.min(560, menuViewport.width),
      height: Math.min(menuViewport.height, Math.ceil(menuBounds.y + menuBounds.height + 18)),
    } });
    await page.keyboard.press("Escape");
    await menu.waitFor({ state: "detached" });
    assert.equal(await menuTrigger.evaluate((node) => node === document.activeElement), true);
    if (size === "mobile") {
      await page.locator(".sidebar-overlay-backdrop").click({ position: { x: viewport.width - 10, y: 400 } });
    } else {
      await sidebarResize.press("Enter");
    }
    await page.setViewportSize(viewport);
    await button.click();
    const dialog = page.getByRole("dialog", { name: "AI tasks" });
    await dialog.waitFor();
    if (!taskId) {
      await dialog.getByRole("combobox", { name: "GPT", exact: true }).selectOption("openai/gpt-browser-fixture");
      await dialog.getByRole("combobox", { name: "Gemini", exact: true }).selectOption("google/gemini-browser-fixture");
      await dialog.getByLabel("Task", { exact: true }).fill("Update the greeting in greeting.txt.");
      await dialog.getByLabel(/Tracked text files/).fill("greeting.txt");
      if (process.env.MOMP_TEST_RUNNER_IMAGE) await dialog.getByRole("checkbox", { name: /Run bun test/ }).check();
      const pending = page.waitForResponse((response) => response.url().includes("/api/collaboration?") && response.status() === 201);
      await dialog.getByRole("button", { name: "Prepare task" }).click();
      taskId = (await (await pending).json()).task.id;
      assert.equal(providerCalls.length, 0, "Preparing a task must not contact a provider");
      await dialog.getByRole("button", { name: "Confirm and run" }).click();
      await dialog.getByText(review, { exact: true }).waitFor({ timeout: 45_000 });
      assert.deepEqual(providerCalls.map(({ provider }) => provider), ["GPT", "Gemini"]);
      assert.match(JSON.stringify(providerCalls[1].body), /Hello, workspace!/);
      assert.equal(readFileSync(join(project, "greeting.txt"), "utf8"), "Hello\n");
      if (process.env.MOMP_TEST_RUNNER_IMAGE) {
        await dialog.getByText("Passed in the isolated container").waitFor();
        assert.match(JSON.stringify(providerCalls[1].body), /projectTests/);
      }
      await dialog.getByRole("button", { name: "Review application", exact: true }).click();
      await dialog.getByRole("button", { name: "Approve and apply", exact: true }).click();
      await dialog.getByText("Applied to working files", { exact: true }).waitFor();
      assert.equal(readFileSync(join(project, "greeting.txt"), "utf8"), "Hello, workspace!\n");
      await dialog.getByRole("button", { name: "Review rollback", exact: true }).click();
      await dialog.getByRole("button", { name: "Confirm rollback", exact: true }).click();
      await dialog.getByText("Patch reversed", { exact: true }).waitFor();
      assert.equal(readFileSync(join(project, "greeting.txt"), "utf8"), "Hello\n");
    } else {
      await dialog.getByRole("button", { name: "Update the greeting in greeting.txt." }).click();
      await dialog.getByText(review, { exact: true }).waitFor();
    }
    await dialog.getByText("Whitespace check passed", { exact: false }).waitFor();
    assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
    await page.screenshot({ path: join(screenshots, `ai-tasks-${size}-${theme}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });

    const openAntigravity = workspaceActions.getByRole("button", { name: "Antigravity chat", exact: true });
    await openAntigravity.click();
    const agy = page.getByRole("dialog", { name: "Google Antigravity" });
    if (!antigravityChecked) {
      await agy.getByRole("checkbox", { name: /Use Antigravity tools/ }).check();
      await agy.getByRole("button", { name: "Start conversation", exact: true }).click();
      await agy.getByText("Antigravity needs Google sign-in", { exact: false }).waitFor();
      const accountPage = await browser.newPage({ locale: "en-US" });
      activePage = accountPage;
      await accountPage.addInitScript(() => localStorage.setItem("momp-locale", "en"));
      let signInAttempts = 0;
      await accountPage.route((url) => url.pathname === "/api/antigravity", async (route) => {
        if (route.request().method() === "POST") {
          assert.equal(route.request().postDataJSON().action, "sign-in");
          signInAttempts++;
          return route.continue();
        }
        // Show the first-run state while the backend uses the isolated ACP fixture.
        const response = await route.fetch();
        const status = await response.json();
        return route.fulfill({ response, json: { ...status, configured: existsSync(cliAccount) && status.configured } });
      });
      await accountPage.goto(origin);
      await accountPage.locator(".sidebar-footer").getByRole("button", { name: "Connections", exact: true }).click();
      await accountPage.getByRole("button", { name: /Google Antigravity.*your Google Account/ }).click();
      const login = accountPage.getByRole("dialog", { name: "Google Antigravity" });
      const signIn = login.getByRole("button", { name: "Sign in with Google" });
      await signIn.waitFor();
      assert.equal(await login.getByRole("button", { name: "Start conversation" }).count(), 0);
      assert.equal(await login.getByRole("link", { name: /install antigravity/i }).count(), 0);
      writeFileSync(`${cliAccount}-hold`, "delay fixture sign-in");
      await signIn.click();
      await login.getByText("Preparing Antigravity. Google sign-in will open in your browser.", { exact: true }).waitFor();
      for (let attempt = 0; attempt < 100 && !existsSync(`${cliAccount}-started`); attempt++) await Bun.sleep(100);
      assert.ok(existsSync(`${cliAccount}-started`), "Fixture received the OAuth request");
      const cancelledSignInPid = Number(readFileSync(`${cliAccount}-started`, "utf8"));
      assert.ok(Number.isSafeInteger(cancelledSignInPid) && cancelledSignInPid > 0);
      await login.getByRole("button", { name: "Cancel sign-in" }).click();
      rmSync(`${cliAccount}-hold`);
      assert.equal(existsSync(cliAccount), false);
      await signIn.click();
      await login.getByText("Google sign-in finished", { exact: false }).waitFor();
      assert.ok(existsSync(cliAccount), "OAuth retry reached the provider after cancellation");
      assert.throws(() => process.kill(cancelledSignInPid, 0), { code: "ESRCH" }, "Cancelled sign-in process exited before the retry completed");
      assert.equal(signInAttempts, 2, "Each click starts one sign-in without a manual setup step");
      await accountPage.screenshot({ path: join(screenshots, "antigravity-projectless-sign-in.png"), animations: "disabled" });
      await accountPage.close();
      activePage = page;
      await agy.getByRole("button", { name: "Reconnect conversation", exact: true }).click();
      await agy.getByRole("combobox", { name: "Model", exact: true }).selectOption("gemini-fixture-flash");
      await agy.getByRole("combobox", { name: "Thinking level", exact: true }).selectOption("high");
      await agy.getByRole("textbox", { name: "Ask Gemini about this project" }).fill("Please review edit to greeting.txt");
      await agy.getByRole("button", { name: "Send to Gemini" }).click();
      await agy.getByRole("heading", { name: "Tool permission" }).waitFor();
      assert.equal(readFileSync(join(project, "greeting.txt"), "utf8"), "Hello\n");
      assert.equal((await (await page.request.get(`${origin}/api/workspace-activity`)).json()).busy, true);
      await page.screenshot({ path: join(screenshots, `antigravity-permission-${theme}.png`), animations: "disabled" });

      const restore = Promise.withResolvers();
      const delayProjectRestore = async (route) => { await restore.promise; await route.continue(); };
      await page.route("**/api/cwd/validate", delayProjectRestore);
      try {
        await page.reload();
        await openAntigravity.click();
        await agy.getByText("Open a project to start an Antigravity conversation.", { exact: true }).waitFor();
      } finally {
        restore.resolve();
        await page.unroute("**/api/cwd/validate", delayProjectRestore);
      }
      await agy.getByRole("button", { name: "Review the workspace greeting", exact: true }).click();
      await agy.getByRole("button", { name: "Allow once", exact: true }).click();
      await agy.getByText("I found the workspace greeting. The approved edit is in greeting.txt.", { exact: true }).waitFor();
      assert.equal(readFileSync(join(project, "greeting.txt"), "utf8"), "Hello from Gemini\n");
      assert.equal(providerCalls.length, 2, "Antigravity chat must use its own ACP connection");
      antigravityChecked = true;
    } else {
      await agy.getByRole("searchbox", { name: "Search conversations" }).fill("workspace greeting");
      await agy.getByRole("button", { name: "Review the workspace greeting", exact: true }).click();
    }
    await agy.getByText("I found the workspace greeting. The approved edit is in greeting.txt.", { exact: true }).waitFor();
    assert.equal(await agy.getByText("I found the workspace greeting.", { exact: false }).count(), 1);
    await agy.locator(".antigravity-tool > summary").click();
    await agy.getByText("Hello from Gemini", { exact: true }).waitFor();
    assert.equal(await agy.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
    await page.keyboard.press("Tab");
    assert.equal(await agy.evaluate((node) => node.contains(document.activeElement)), true);
    await page.screenshot({ path: join(screenshots, `antigravity-${size}-${theme}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await agy.waitFor({ state: "detached" });
    if (size === "desktop") {
      let usageRequests = 0;
      const resetsAt = Date.now() + 45 * 60_000;
      await page.route("**/api/models-config/limits", async (route) => {
        if (++usageRequests > 1) return route.fulfill({ status: 503, json: { error: "usage_unavailable" } });
        await route.fulfill({ json: { antigravity: { status: "ready", fetchedAt: Date.now(), rows: [["Gemini fixture", "65%", "2026-11-11T07:00:00Z"]] },
          reports: [{ provider: "openai-codex", fetchedAt: Date.now(), limits: [
          { id: "test-weekly", label: "Weekly quota", usedFraction: 1, status: "exhausted", resetsAt, source: "provider" },
          { id: "test-unknown", label: "Model bucket", usedFraction: null, status: "unknown", source: "sdk" },
        ] }] } });
      });
      await page.locator(".sidebar-footer").getByRole("button", { name: "Connections", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Settings" });
      await settings.getByRole("button", { name: "Usage limits", exact: true }).click();
      const usage = page.getByRole("dialog", { name: "Usage limits" });
      await usage.getByText("Quota reached", { exact: true }).waitFor();
      await usage.getByText("Amount unavailable", { exact: true }).waitFor();
      assert.equal(await usage.locator(`time[datetime="${new Date(resetsAt).toISOString()}"]`).count(), 1);
      assert.equal(await usage.locator("meter").count(), 1);
      await usage.getByRole("table", { name: "Google Antigravity CLI" }).getByText("65%", { exact: true }).waitFor();
      assert.equal(await usage.locator('time[datetime="2026-11-11T07:00:00.000Z"]').count(), 1);
      await usage.screenshot({ path: join(screenshots, `usage-${theme}.png`), animations: "disabled" });
      await usage.getByRole("button", { name: "Refresh", exact: true }).click();
      await usage.getByRole("alert").waitFor();
      await usage.getByText("Quota reached", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await usage.waitFor({ state: "detached" });
      await settings.waitFor();
      await settings.screenshot({ path: join(screenshots, `connections-${theme}.png`), animations: "disabled" });
      await settings.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Skills", exact: true }).click();
      await settings.getByText("Review the sample workspace.", { exact: true }).waitFor();
      await settings.screenshot({ path: join(screenshots, `skills-${theme}.png`), animations: "disabled" });
      await settings.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Plugins", exact: true }).click();
      assert.equal(await settings.getByRole("navigation", { name: "Settings sections" }).getByRole("button", { name: "Plugins", exact: true }).getAttribute("aria-current"), "page");
      await settings.screenshot({ path: join(screenshots, `plugins-${theme}.png`), animations: "disabled" });
      await settings.getByRole("button", { name: "MCP", exact: true }).click();
      await settings.getByRole("button", { name: "workspace-tool", exact: true }).click();
      const json = settings.getByRole("textbox", { name: "Server JSON configuration" });
      const mcp = JSON.parse(await json.inputValue());
      assert.ok(!JSON.stringify(mcp).includes("SYNTHETIC-"));
      if (!mcpSaved) {
        await json.fill(JSON.stringify({ ...mcp, timeout: 2500 }, null, 2));
        const saved = page.waitForResponse((response) => response.request().method() === "PUT" && response.url().includes("/api/mcp") && response.ok());
        await settings.getByRole("button", { name: "Save MCP" }).click();
        const response = await (await saved).json();
        assert.ok(!JSON.stringify(response).includes("SYNTHETIC-"));
        const stored = JSON.parse(readFileSync(mcpPath, "utf8")).mcpServers["workspace-tool"];
        assert.deepEqual(stored, { ...mcpServer, timeout: 2500 });
        mcpSaved = true;
      }
      await settings.getByRole("button", { name: "Save MCP", exact: true }).waitFor();
      await settings.screenshot({ path: join(screenshots, `mcp-${theme}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await settings.waitFor({ state: "detached" });

      await page.getByText("workspace.ts", { exact: true }).click();
      const editor = page.locator(".file-viewer-shell");
      await editor.getByText("titleForTask", { exact: true }).waitFor();
      await page.screenshot({ path: join(screenshots, `workspace-editor-${theme}.png`), animations: "disabled" });
      const composerOverlap = await page.locator(".composer-footer").evaluate((node) => {
        const model = node.querySelector(".composer-models").getBoundingClientRect();
        const context = node.querySelector(".composer-context").getBoundingClientRect();
        return model.right > context.left + 1 && model.bottom > context.top && model.top < context.bottom;
      });
      assert.equal(composerOverlap, false);
      await editor.getByRole("button", { name: "Edit", exact: true }).click();
      const textarea = editor.getByRole("textbox", { name: /File editor/ });
      const replacement = `export const workspace = "${theme} theme";\n`;
      await textarea.fill(replacement);
      const fileSaved = page.waitForResponse((response) => /\/api\/files\//.test(response.url()) && response.request().method() === "PUT" && response.ok());
      await textarea.press("Control+s");
      await fileSaved;
      assert.equal(readFileSync(join(project, "workspace.ts"), "utf8"), replacement);
      await editor.getByRole("button", { name: "Diff", exact: true }).click();
      await editor.locator(".file-viewer-content").getByText(`${theme} theme`, { exact: false }).waitFor();
      await page.screenshot({ path: join(screenshots, `git-diff-${theme}.png`), animations: "disabled" });

      const modelPicker = page.locator(".composer-model-picker > button");
      await modelPicker.click();
      const model = theme === "light" ? "GPT fixture" : "Gemini fixture";
      await page.getByRole("button", { name: model, exact: false }).click();
      const input = page.getByRole("textbox", { name: "Message to the coding agent" });
      await input.fill("Briefly explain this coding workspace.");
      await input.press("Enter");
      await page.getByText(theme === "light" ? gptChat : geminiChat, { exact: true }).waitFor({ timeout: 45_000 });
      assert.equal(providerCalls.at(-1).provider, theme === "light" ? "GPT" : "Gemini");
      await page.screenshot({ path: join(screenshots, `chat-${theme}.png`), animations: "disabled" });
    } else {
      const toggle = page.getByRole("button", { name: "Show sidebar", exact: true });
      if (await toggle.isVisible()) await toggle.click();
      await page.locator(".sidebar-footer").getByRole("button", { name: "Connections", exact: true }).click();
      const settings = page.getByRole("dialog", { name: "Settings" });
      await settings.getByRole("textbox", { name: "Search settings…" }).fill("context");
      await settings.getByRole("heading", { name: /Search results/ }).waitFor();
      assert.equal(await settings.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
      await settings.screenshot({ path: join(screenshots, `settings-mobile-${theme}.png`), animations: "disabled" });
      await page.keyboard.press("Escape");
      await settings.waitFor({ state: "detached" });
    }
    const toggle = page.getByRole("button", { name: "Show sidebar", exact: true });
    if (await toggle.isVisible()) await toggle.click();
    await page.locator(".sidebar-footer").getByRole("button", { name: /Update center/ }).click();
    const update = page.getByRole("dialog", { name: "Update center" });
    await update.getByText("Fixed project session recovery.", { exact: true }).waitFor();
    await update.getByText("Roll back an update", { exact: true }).click();
    await update.getByText("Stop the web server.", { exact: false }).waitFor();
    await update.screenshot({ path: join(screenshots, `update-${size}-${theme}.png`), animations: "disabled" });
    await page.route("**/api/workspace-activity", (route) => route.fulfill({ json: { busy: true } }));
    await update.getByRole("button", { name: "Install update", exact: true }).click();
    await update.getByText("Wait for active tasks to finish", { exact: false }).waitFor();
    assert.equal(updateInstalls, 0);
    updateChecksFail = true;
    await update.getByRole("button", { name: "Check for updates", exact: true }).click();
    await update.getByText("Couldn’t check for updates.", { exact: false }).waitFor();
    await page.keyboard.press("Escape");
    await update.waitFor({ state: "detached" });
    assert.equal(await page.locator("html").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${size} ${theme}: collaboration, Antigravity, persisted history, keyboard and viewport`);
  }
} catch (error) {
  if (activePage && !activePage.isClosed()) {
    await activePage.screenshot({ path: join(screenshots, "failure.png") }).catch(() => {});
    console.error((await activePage.locator("body").innerText().catch(() => "")).slice(0, 4000));
  }
  console.error(readFileSync(serverLog, "utf8"));
  throw error;
} finally {
  await browser?.close();
  mock.stop(true);
  server.kill();
  await server.exited;
  closeSync(log);
  rmSync(fixture, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
