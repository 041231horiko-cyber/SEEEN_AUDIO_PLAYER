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
let drawn = [];
const canvas = get("particle-field");
canvas.getContext = () => ({
  setTransform(){}, clearRect(){ arcs = 0; drawn = []; }, save(){}, beginPath(){}, rect(){}, clip(){},
  arc(x, y, radius) { arcs++; drawn.push([x, y, radius, this.globalAlpha]); }, fill(){}, restore(){}
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

function setControl(id, value) {
  get(id).value = value;
  get(id).onchange({target: get(id)});
}

function checkNarrow(renderer, track, hit, visible) {
  assert.match(get("reflection-timing").textContent, /\+380 ms.*72\.5 px\/s.*1800 ms.*\+2180 ms/);
  assert.match(get("reflection-timing").textContent, /反響候補との差/);
  get("edit-base").checked = true;
  get("edit-base").onchange({target: get("edit-base")});
  assert.equal(get("diffusionMs").readOnly, false);
  setControl("diffusionMs", 410);
  assert.match(get("reflection-timing").textContent, /壁到達 \+410 ms/);
  get("edit-base").checked = false;
  get("edit-base").onchange({target: get("edit-base")});
  assert.equal(get("diffusionMs").readOnly, true);
  assert.equal(get("diffusionMs").value, 380);
  seek(hit.time + .38 - 1e-6);
  const before = drawn;
  seek(hit.time + .38 + 1e-6);
  for (const [id, dot] of before.entries()) {
    assert.deepEqual(drawn[id].slice(0, 3), dot.slice(0, 3));
    assert.ok(Math.abs(drawn[id][3] - dot[3]) < .001);
  }
  const boundary = renderer.previewBoundaryPoints;
  setControl("decayPercent", 100);
  assert.equal(renderer.previewBoundaryPoints, boundary);
  seek(hit.time + 1.25);
  const quieter = drawn;
  setControl("decayPercent", 0);
  assert.ok(drawn.some((dot, id) => dot[3] > quieter[id][3] + .01));
  seek(hit.time + 2.179);
  assert.ok(drawn.slice(0, -1).every(dot => dot[3] < .001));
  seek(hit.time + 2.2);
  assert.equal(canvas.dataset.eventIds, "");
  assert.equal(arcs, 1);
  seek(hit.time + .41);
  const unpressed = drawn;
  setControl("narrow-mode", "cushion");
  assert.match(get("reflection-timing").textContent, /クッション終了 \+440 ms/);
  let changed = 0;
  for (const [id, dot] of unpressed.entries()) {
    assert.deepEqual(drawn[id].slice(0, 3), dot.slice(0, 3));
    if (drawn[id][3] !== dot[3]) {
      assert.ok(drawn[id][3] < dot[3]);
      assert.ok(drawn[id][3] >= 0);
      const {centerX, centerY, narrowHalf} = env.SEEENParticleField.constants;
      assert.ok(Math.max(Math.abs(dot[0]-centerX), Math.abs(dot[1]-centerY)) <= narrowHalf * .7);
      changed++;
    }
  }
  assert.ok(changed > 0 && changed < visible / 2);
  seek(hit.time + .44);
  const released = drawn;
  setControl("narrow-mode", "base");
  assert.deepEqual(drawn, released);

  setControl("narrow-mode", "combined");
  assert.match(get("reflection-timing").textContent, /72\.5 px\/s.*2483 ms.*\+2863 ms/);
  setControl("speedDecayPercent", 90);
  setControl("startSpeedPercent", 50);
  seek(track.knockEvents[1].time + .1);
  assert.equal(canvas.dataset.eventIds, "2,1");
  assert.equal(arcs, visible + 1, "overlapping waves share a single particle draw");
  checkPlaybackWrap(track);
  setControl("narrow-mode", "legacy");
  assert.match(get("reflection-timing").textContent, /\+1515 ms.*\+3318 ms/);
  assert.ok(get("speedDecayPercent").disabled);
  seek(hit.time + 1.75);
  assert.equal(canvas.dataset.eventIds, "1");
  get("reset-narrow").onclick();
  assert.equal(get("decayPercent").value, 0);
  assert.equal(get("narrow-mode").value, "base");
}

function checkPlaybackWrap(track) {
  media.play();
  frameAt(124.69);
  frameAt(.01);
  assert.ok(canvas.dataset.eventIds.split(",").includes("35"));
  const first = track.knockEvents[0].time;
  frameAt(first + .02);
  assert.ok(canvas.dataset.eventIds.startsWith("1,35"));
  media.pause();
  seek(first + .02);
  assert.equal(canvas.dataset.eventIds, "1");
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
    if (!narrow) {
      frameAt(track.knockEvents[1].time + .03);
      assert.equal(canvas.dataset.eventIds, "2,1");
      assert.equal(arcs, visible + 1);
    }
    await get("play").onclick();
    assert.equal(pending.size, 0);
    seek(hit.time - .001);
    assert.equal(canvas.dataset.eventIds, "");
    seek(hit.echoes[0]?.time ?? hit.time + .6);
    assert.equal(canvas.dataset.eventIds, "1");
    assert.equal(get("narrow-controls").hidden, !narrow);
    if (narrow) checkNarrow(renderer, track, hit, visible);
    await get("play").onclick();
    frameAt(124.69);
    assert.equal(canvas.dataset.eventIds, narrow ? "" : "35");
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
