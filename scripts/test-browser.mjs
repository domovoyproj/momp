import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, openSync, closeSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { chromium } from "playwright";

const fixture = mkdtempSync(join(tmpdir(), "momp-browser-"));
const project = join(fixture, "project");
const agentDir = join(fixture, "agent");
const screenshots = resolve(process.env.MOMP_SCREENSHOTS_DIR || "test-artifacts/browser");
for (const directory of [project, agentDir, screenshots]) mkdirSync(directory, { recursive: true });
const git = (...args) => execFileSync("git", args, { cwd: project, windowsHide: true });
git("init", "-q", "--template=");
git("config", "core.autocrlf", "false");
writeFileSync(join(project, "greeting.txt"), "Hello\n");
git("add", "greeting.txt");
git("-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "Browser fixture");

const providerCalls = [];
const proposal = JSON.stringify({ summary: "Update the welcome message to Hello, workspace!", changes: [{ path: "greeting.txt", content: "Hello, workspace!\n" }] });
const review = "The change matches the request. Add an assertion for the exact greeting in the application test suite.";
const event = (value) => `data: ${JSON.stringify(value)}\n\n`;
const mock = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
  const path = new URL(request.url).pathname;
  const headers = { "Content-Type": "text/event-stream" };
  if (request.method === "POST" && path.endsWith("/chat/completions")) {
    providerCalls.push({ provider: "GPT", body: await request.json() });
    const chunk = { id: "chatcmpl-test", object: "chat.completion.chunk", model: "gpt-browser-fixture", created: 123 };
    return new Response(event({ ...chunk, choices: [{ index: 0, delta: { role: "assistant", content: proposal }, finish_reason: null }] })
      + event({ ...chunk, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }) + "data: [DONE]\n\n", { headers });
  }
  if (request.method === "POST" && path.includes(":streamGenerateContent")) {
    providerCalls.push({ provider: "Gemini", body: await request.json() });
    return new Response(event({ candidates: [{ index: 0, content: { role: "model", parts: [{ text: review }] }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 32, candidatesTokenCount: 20, totalTokenCount: 52 } }), { headers });
  }
  return Response.json({ data: [], models: [] });
} });

writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: {
  openai: { api: "openai-completions", baseUrl: `${mock.url.origin}/v1`, apiKey: "fixture-key", models: [{ id: "gpt-browser-fixture", name: "GPT fixture" }] },
  google: { api: "google-generative-ai", baseUrl: `${mock.url.origin}/v1beta`, apiKey: "fixture-key", models: [{ id: "gemini-browser-fixture", name: "Gemini fixture" }] },
} }));

const portReservation = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
const port = portReservation.port;
portReservation.stop(true);
const origin = `http://127.0.0.1:${port}`;
const safeEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => /^(?:path|systemroot|windir|comspec|pathext|tmp|temp|tmpdir|omp_web_dist_dir)$/i.test(key)));
const serverLog = join(fixture, "server.log");
const log = openSync(serverLog, "w");
const server = Bun.spawn([process.execPath, "--bun", resolve("node_modules/next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", String(port)], {
  env: { ...safeEnv, PI_CODING_AGENT_DIR: agentDir, HOME: fixture, USERPROFILE: fixture,
    APPDATA: fixture, LOCALAPPDATA: fixture, NEXT_TELEMETRY_DISABLED: "1", OMP_WEB_UPDATE_INSTALL_DISABLED: "1" },
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
  let taskId;
  for (const [theme, viewport] of [["light", { width: 1440, height: 960 }], ["dark", { width: 1440, height: 960 }], ["light", { width: 390, height: 844 }], ["dark", { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport, colorScheme: theme, locale: "en-US" });
    activePage = page;
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(({ theme }) => {
      localStorage.setItem("pi-theme", theme);
      localStorage.setItem("momp-locale", "en");
    }, { theme });
    await page.goto(`${origin}/?${new URLSearchParams({ cwd: project })}`);
    const button = page.locator(viewport.width < 600 ? ".workspace-toolbar" : ".sidebar-footer").getByRole("button", { name: "AI tasks", exact: true });
    await button.click();
    const dialog = page.getByRole("dialog", { name: "AI tasks" });
    await dialog.waitFor();
    if (!taskId) {
      await dialog.getByRole("combobox", { name: "GPT", exact: true }).selectOption("openai/gpt-browser-fixture");
      await dialog.getByRole("combobox", { name: "Gemini", exact: true }).selectOption("google/gemini-browser-fixture");
      await dialog.getByLabel("Task", { exact: true }).fill("Update the greeting in greeting.txt.");
      await dialog.getByLabel(/Tracked text files/).fill("greeting.txt");
      const pending = page.waitForResponse((response) => response.url().includes("/api/collaboration?") && response.status() === 201);
      await dialog.getByRole("button", { name: "Prepare task" }).click();
      taskId = (await (await pending).json()).task.id;
      assert.equal(providerCalls.length, 0, "Preparing a task must not contact a provider");
      await dialog.getByRole("button", { name: "Confirm and run" }).click();
      await dialog.getByText(review, { exact: true }).waitFor({ timeout: 45_000 });
      assert.deepEqual(providerCalls.map(({ provider }) => provider), ["GPT", "Gemini"]);
      assert.match(JSON.stringify(providerCalls[1].body), /Hello, workspace!/);
      assert.equal(readFileSync(join(project, "greeting.txt"), "utf8"), "Hello\n");
    } else {
      await dialog.getByRole("button", { name: "Update the greeting in greeting.txt." }).click();
      await dialog.getByText(review, { exact: true }).waitFor();
    }
    await dialog.getByText("Whitespace check passed", { exact: false }).waitFor();
    assert.equal(await dialog.evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
    const size = viewport.width < 600 ? "mobile" : "desktop";
    await page.screenshot({ path: join(screenshots, `ai-tasks-${size}-${theme}.png`), animations: "disabled" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "detached" });
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
      await page.getByRole("button", { name: "Usage limits", exact: true }).click();
      const usage = page.getByRole("dialog", { name: "Usage limits" });
      await usage.getByText("Quota reached", { exact: true }).waitFor();
      await usage.getByText("Amount unavailable", { exact: true }).waitFor();
      assert.equal(await usage.locator("time").getAttribute("datetime"), new Date(resetsAt).toISOString());
      assert.equal(await usage.locator("meter").count(), 1);
      await usage.getByRole("table", { name: "Google Antigravity CLI" }).getByText("65%", { exact: true }).waitFor();
      await usage.screenshot({ path: join(screenshots, `usage-${theme}.png`), animations: "disabled" });
      await usage.getByRole("button", { name: "Refresh", exact: true }).click();
      await usage.getByRole("alert").waitFor();
      await usage.getByText("Quota reached", { exact: true }).waitFor();
      await page.keyboard.press("Escape");
      await usage.waitFor({ state: "detached" });
    }
    assert.equal(await page.locator("html").evaluate((node) => node.scrollWidth <= node.clientWidth + 1), true);
    assert.deepEqual(errors, []);
    await page.close();
    console.log(`PASS ${size} ${theme}: collaboration, persisted review, Escape and viewport`);
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
  rmSync(fixture, { recursive: true, force: true });
}
