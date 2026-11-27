// Runs both revisions in the same Chromium, with a no-op context and with Canvas2D.
"use strict";
const {execFileSync} = require("node:child_process");
const {chromium: browserType} = require("playwright");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const {once} = require("node:events");

const baseline = "6d95111cda2066283e50b797808983357943b862";
const repo = path.resolve(__dirname, "../..");
const app = path.join(repo, "SEEEN_AUDIO_PLAYER");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "seeen-render-bench-"));
const chromium = process.env.CHROMIUM || (fs.existsSync("/usr/lib/chromium/chromium") ? "/usr/lib/chromium/chromium" : "chromium");
const revisions = process.argv.slice(2);
if (!revisions.length) revisions.push(baseline, "worktree");
function read(rev, name) {
  return rev === "worktree" ? fs.readFileSync(path.join(app, name), "utf8") :
    execFileSync("git", ["show", rev + ":SEEEN_AUDIO_PLAYER/" + name], {cwd: repo, encoding: "utf8"});
}
async function main() {
  const server = http.createServer((request, response) => {
    const name = new URL(request.url, "http://localhost").pathname.slice(1);
    if (!/^[a-z-]+\.(?:html|js)$/.test(name)) return response.writeHead(404).end();
    response.setHeader("Content-Type", name.endsWith(".js") ? "text/javascript" : "text/html");
    fs.createReadStream(path.join(dir, name)).on("error", () => response.end()).pipe(response);
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  let browser;
  try {
    browser = await browserType.launch({executablePath: chromium, args: ["--disable-gpu", "--disable-dev-shm-usage"],
    env: {...process.env, XDG_CONFIG_HOME: dir}});
    console.error(execFileSync(chromium, ["--version"], {encoding: "utf8"}).trim());
    for (const rev of revisions) {
      for (const name of ["knock-sync.js", "melody-sync.js", "particle-field.js"]) {
        let source = read(rev, name);
        if (name === "particle-field.js") {
          // Expose private kernels in the benchmark only. The production render
          // loop is measured as-is, with no timers inside the particle loop.
          const oldReflection = source.match(/    var press = compression > 0 && point.cushion;\n    var merged = [\s\S]+?(?=    var converge)/);
          if (!oldReflection) throw new Error("Cannot locate the reference reflection formula");
          source = source.replace("  var canvas = document.getElementById", `
            function referenceReflection(point, travel, compression) {
  ${oldReflection[0]}            return merged;
            }
            window.benchKernels = {
              prepareWave, synchronizedAmplitude,
              reflection: typeof narrowReflected === "function" ? narrowReflected : referenceReflection,
              fastMelody: typeof fixedMelodyAlpha === "function" ? fixedMelodyAlpha : null
            };
            var canvas = document.getElementById`);
        }
        fs.writeFileSync(path.join(dir, name), source);
      }
      fs.copyFileSync(path.join(__dirname, "benchmark-page.js"), path.join(dir, "benchmark-page.js"));
      fs.writeFileSync(path.join(dir, "index.html"), `<canvas id="particle-field"></canvas><pre id="result"></pre>
  <script>
  if (location.search.includes("mock=1")) {
    const noop = () => {};
    document.querySelector("canvas").getContext = () => ({
      setTransform: noop, clearRect: noop, save: noop, restore: noop, beginPath: noop,
      rect: noop, clip: noop, arc: noop, fill: noop
    });
  }
  </script>
  <script src="knock-sync.js"></script><script src="melody-sync.js"></script>
  <script src="particle-field.js"></script><script src="benchmark-page.js"></script>`);
      for (const mode of ["mock", "canvas"]) {
        const url = new URL("http://127.0.0.1:" + server.address().port + "/index.html");
        url.search = "particle-preview=wide&mock=" + Number(mode === "mock");
        const page = await browser.newPage({deviceScaleFactor: 2, viewport: {width: 1000, height: 600}});
        let error;
        page.on("pageerror", failure => { error = failure; });
        await page.goto(url.href, {timeout: 60000});
        if (error) throw error;
        const report = await page.locator("#result").textContent();
        console.log(JSON.stringify({rev, mode, ...JSON.parse(report)}));
        await page.close();
      }
    }
  } finally {
    if (browser) await browser.close();
    server.close();
    fs.rmSync(dir, {recursive: true, force: true});
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
