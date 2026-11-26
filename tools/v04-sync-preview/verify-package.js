// Exercise the packaged scripts with a controlled media clock and Canvas stub.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {webcrypto} = require("node:crypto");

const root = process.argv[2];
if (!root) throw new Error("Pass the packaged preview directory");
const read = name => fs.readFileSync(path.join(root, name));

class Element {
  constructor() {
    this.dataset = {};
    this.style = {};
    this.children = [];
    this.listeners = new Map();
    this.classList = {toggle(){}, add(){}, remove(){}};
  }
  append(node) { this.children.push(node); }
  insertRow() { const row = new Element(); this.append(row); return row; }
  insertCell() { return this.insertRow(); }
  replaceChildren() { this.children = []; }
  scrollIntoView() {}
  addEventListener(name, handler) { this.listeners.set(name, handler); }
  fire(name) { this.listeners.get(name)?.(); }
}

const elements = new Map();
function get(id) {
  if (!elements.has(id)) elements.set(id, new Element());
  return elements.get(id);
}
const media = get("audio");
media.paused = true;
media.currentTime = 0;
media.pause = () => { media.paused = true; media.fire("pause"); };
media.play = async () => { media.paused = false; media.fire("playing"); };
media.load = () => { media.currentTime = 0; };
media.removeAttribute = () => { media.src = ""; };
get("track").value = "bright-wide";
get("loop").checked = true;

let arcs = 0;
const canvas = get("particle-field");
canvas.getContext = () => ({
  setTransform(){}, clearRect(){ arcs = 0; }, save(){}, beginPath(){}, rect(){}, clip(){},
  arc(){ arcs++; }, fill(){}, restore(){}
});
let frameId = 0;
const pending = new Map();
const document = Object.assign(new Element(), {
  getElementById: get, createElement: () => new Element(), hidden: false
});
const env = {
  performance, document, crypto: webcrypto, AbortController, Blob, URL, setTimeout, devicePixelRatio: 1,
  fetch: async name => new Response(read(name)),
  requestAnimationFrame: handler => { pending.set(++frameId, handler); return frameId; },
  cancelAnimationFrame: id => pending.delete(id),
  addEventListener(){}
};
env.window = env;
const context = vm.createContext(env);
for (const file of ["preview-renderer.js", "timeline.js", "sync-preview.js"]) {
  vm.runInContext(read(file).toString(), context, {filename: file});
}

function frameAt(time) {
  media.currentTime = time;
  assert.equal(pending.size, 1, "only one animation loop may queue a frame");
  const [id, draw] = pending.entries().next().value;
  pending.delete(id);
  draw();
}
function seek(time) {
  get("seek").value = time;
  get("seek").oninput();
  media.fire("seeked");
}
function closeTo(actual, expected) {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${actual} != ${expected}`);
}

async function verify() {
  for (const key of ["bright-wide", "bright-narrow", "dark-wide", "dark-narrow"]) {
    const narrow = key.endsWith("-narrow");
    const track = JSON.parse(read("analysis/" + key + ".json"));
    const hit = track.knockEvents[0];
    get("track").value = key;
    await get("track").onchange();
    assert.match(get("status").textContent, /SHA-256一致/);
    assert.equal(get("events").children.length, 35);
    assert.equal(get("marks").children.length, narrow ? 62 : 35);
    assert.equal(+canvas.dataset.wideCount, 6500);
    assert.equal(+canvas.dataset.narrowCount, 9500);
    assert.equal(canvas.dataset.eventIds, "");
    assert.equal(pending.size, 0);
    get("next").onclick();
    closeTo(media.currentTime, hit.time - .25);
    await get("play").onclick();
    frameAt(hit.time + .02);
    closeTo(+canvas.dataset.time, .02);
    assert.equal(canvas.dataset.eventIds, "1");
    const renderer = env.SEEENParticleField.renderer;
    // Six NARROW particles are hidden beneath the opaque center at full scale.
    const visible = narrow ? renderer.narrow.filter(point => point.coveredUntilScale < 1).length : 6500;
    assert.equal(arcs, visible + 1);
    media.fire("playing");
    media.fire("waiting");
    frameAt(media.currentTime);
    closeTo(+canvas.dataset.time, .02);
    frameAt(hit.time + .66);
    closeTo(+canvas.dataset.time, .66);
    assert.equal(canvas.dataset.eventIds, "1");
    await get("play").onclick();
    assert.equal(pending.size, 0);
    seek(hit.time - .001);
    assert.equal(canvas.dataset.eventIds, "");
    seek(hit.echoes[0]?.time ?? hit.time + .6);
    assert.equal(canvas.dataset.eventIds, "1");
    await get("play").onclick();
    frameAt(124.69);
    assert.equal(canvas.dataset.eventIds, "35");
    frameAt(.005);
    assert.equal(canvas.dataset.eventIds, "");
    frameAt(hit.time + .04);
    assert.equal(canvas.dataset.eventIds, "1");
    get("offset").value = 100;
    get("offset").onchange({target: get("offset")});
    assert.equal(canvas.dataset.eventIds, "");
    await get("play").onclick();
    console.log(key, "SHA, initial onset, pause, resume, seek, buffering, dropped frame, loop, offset");
  }
  const timeline = require("./timeline");
  const knots = JSON.parse(read("analysis/bright-narrow.json")).knockEvents;
  const events = timeline.adjustedEvents(knots, 0, new Map());
  const started = performance.now();
  for (let i = 0; i < 200000; i++) timeline.activeWaves(events, (i / 60) % 124.7, "narrow");
  console.log("Node clock lookup only:", ((performance.now() - started) / 200).toFixed(2), "µs / call");
}

verify().catch(error => { console.error(error); process.exitCode = 1; });
