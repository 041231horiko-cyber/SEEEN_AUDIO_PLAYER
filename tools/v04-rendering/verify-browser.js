// Local Chromium smoke test. Pass a prepared Pages release directory to test
// the generated integrity-checking worker as well as the default worktree.
"use strict";
const assert = require("node:assert/strict");
const {once} = require("node:events");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const {chromium} = require("playwright");
const root = path.resolve(process.argv[2] || path.join(__dirname, "../../SEEEN_AUDIO_PLAYER"));
const types = {html:"text/html", js:"text/javascript", css:"text/css", json:"application/json",
  m4a:"audio/mp4", wav:"audio/wav", png:"image/png", ttf:"font/ttf"};
const prefix = "/preview/";
const server = http.createServer((request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (!url.pathname.startsWith(prefix)) return response.writeHead(404).end();
  const name = url.pathname.slice(prefix.length) || "index.html";
  if (!/^[\w./-]+$/.test(name) || name.split("/").includes("..")) return response.writeHead(404).end();
  const file = path.join(root, name);
  const info = fs.statSync(file, {throwIfNoEntry: false});
  if (!info?.isFile()) return response.writeHead(404).end();
  response.writeHead(200, {"Content-Type": types[name.split(".").pop()] || "application/octet-stream",
    "Content-Length": info.size});
  fs.createReadStream(file).pipe(response);
});
async function main() {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let browser;
  try {
    browser = await chromium.launch({executablePath: process.env.CHROMIUM || "/usr/lib/chromium/chromium",
      args: ["--disable-gpu"]});
    const context = await browser.newContext({viewport: {width: 900, height: 450}, deviceScaleFactor: 2,
      permissions: ["clipboard-read", "clipboard-write"]});
    const url = "http://127.0.0.1:" + server.address().port + prefix;
    const errors = [];
    const setup = async query => {
      const page = await context.newPage();
      page.on("pageerror", error => errors.push(error));
      await page.goto(url + query);
      return page;
    };
    const normal = await setup("");
    assert.equal(await normal.locator("details").count(), 0);
    await normal.waitForFunction(() => document.querySelector("#offline-status").dataset.state === "ready",
      null, {timeout: 60000});
    await normal.close();
    const baseline = await setup("?fps=baseline");
    await baseline.locator("summary").filter({hasText: /06\.2.*ready/}).waitFor();
    const optimized = await setup("?fps=1");
    await optimized.locator("summary").filter({hasText: /07\.1.*ready/}).waitFor();

    const snapshots = page => page.evaluate(() => {
      const {renderer} = window.SEEENParticleField;
      const snapshots = [];
      for (const mode of ["wide", "narrow"]) for (const theme of ["bright", "dark"]) {
        for (const ages of [[], [.43], [.48, 1.7]]) {
          renderer.render({mode, theme, scale: 1, waveAges: ages,
            melodyFrame: window.SEEENMelodySync.phaseFrame(-23, theme === "bright", .725)});
          snapshots.push(renderer.canvas.toDataURL());
        }
      }
      return snapshots;
    });
    const before = await snapshots(baseline), after = await snapshots(optimized);
    assert.equal(before.length, 12);
    for (let i = 0; i < before.length; i++) assert.equal(after[i] === before[i], true, "DPR2 PNG snapshot " + i);
    await baseline.close();

    await optimized.locator('[data-track="bright-wide"]').click();
    await optimized.waitForFunction(() => document.querySelector("audio").currentTime > 1 &&
      document.querySelector("#playback-state").dataset.state === "playing");
    await optimized.locator("#play-toggle").click();
    await optimized.waitForFunction(() => document.querySelector("canvas").dataset.motionState === "point");
    await optimized.locator("#play-toggle").click();
    await optimized.waitForFunction(() => document.querySelector("#playback-state").dataset.state === "playing");
    await optimized.locator('[data-track="dark-narrow"]').click();
    await optimized.waitForFunction(() => document.querySelector("audio").currentSrc.includes("dark_narrow") &&
      document.querySelector("canvas").dataset.motionState === "playing");
    await optimized.locator("summary").click();
    await optimized.getByRole("button", {name: "Copy report"}).click();
    const report = await optimized.evaluate(() => navigator.clipboard.readText());
    for (const label of [" / playing", " / start", " / stop", " / switch", "frame interval med/p95/max", ">33.3ms", "render avg/med/p95/max"]) {
      assert.ok(report.includes(label), label);
    }
    await context.setOffline(true);
    await optimized.reload();
    await optimized.waitForFunction(() => document.querySelector("#offline-status").dataset.state === "ready");
    await optimized.locator('[data-track="bright-narrow"]').click();
    await optimized.waitForFunction(() => document.querySelector("audio").currentTime > 1 &&
      document.querySelector("audio").currentSrc.includes("bright_narrow"));
    assert.deepEqual(errors, []);
    console.log("12 DPR2 Canvas PNGs byte-identical. Browser diagnostic/copy, play/pause/resume/switch and offline audio passed.");
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
