// Run the app, audio-clock selector, Canvas commands and worker in a desktop
// Node harness. Media events, Canvas rasterization and Cache Storage are stubs.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const {performance} = require("node:perf_hooks");
const {captureRenderer} = require("../v04-sync-preview/measure-rendering");
const sync = require("../../SEEEN_AUDIO_PLAYER/knock-sync");

const app = path.resolve(__dirname, "../../SEEEN_AUDIO_PLAYER");
const keys = ["bright-wide", "bright-narrow", "dark-wide", "dark-narrow"];
const scope = "https://local.test/v04/";
const read = name => fs.readFileSync(path.join(app, name));
const data = key => JSON.parse(read("knock-data/" + key + ".json"));
const href = key => new URL("audio/" + data(key).audioFile, scope).href;

function expectedHermite(y0, y1, m0, m1, t) {
  const t2 = t * t, t3 = t2 * t;
  return (2*t3 - 3*t2 + 1)*y0 + (t3 - 2*t2 + t)*m0 +
    (-2*t3 + 3*t2)*y1 + (t3 - t2)*m1;
}

function expectedWideProgress(age, duration) {
  const initialDuration = .5, ratio = .45;
  const joinVelocity = 1.5 * (1-ratio) / (duration-initialDuration);
  const initialVelocity = 2 * ratio / initialDuration;
  if (age <= 0) return 0;
  if (age < initialDuration) {
    const q = age / initialDuration;
    return expectedHermite(0, ratio, initialVelocity*initialDuration,
      joinVelocity*initialDuration, q);
  }
  const u = Math.max(0, Math.min(1, (age-initialDuration)/(duration-initialDuration)));
  return expectedHermite(ratio, 1, joinVelocity*(duration-initialDuration), 0, u);
}

function checkWideCurve(formulas, constants) {
  const duration = (13 + Math.PI) / 3.5;
  assert.equal(constants.wideInitialExpansionRatio, .45);
  assert.equal(constants.wideInitialExpansionDurationMs, 500);
  assert.equal(constants.wideMaxPhase, 13 + Math.PI);
  assert.ok(Math.abs(formulas.wideExpansionProgress(.5)-.45) < 1e-12);
  let previous = -1;
  for (let i=0; i<=1000; i++) {
    const age = duration*i/1000;
    const value = formulas.wideExpansionProgress(age);
    assert.ok(value >= previous, "WIDE expansion must not reverse");
    assert.ok(Math.abs(value-expectedWideProgress(age,duration)) < 1e-12,
      "production curve must match the approved Hermite construction");
    previous = value;
  }
  assert.equal(formulas.wideExpansionPhase(0), 0);
  assert.equal(formulas.wideExpansionPhase(duration), 13 + Math.PI);
  const step = 1e-6;
  const atJoinFromLeft = (formulas.wideExpansionProgress(.5)-formulas.wideExpansionProgress(.5-step))/step;
  const atJoinFromRight = (formulas.wideExpansionProgress(.5+step)-formulas.wideExpansionProgress(.5))/step;
  const joinVelocity = 1.5*.55/(duration-.5);
  assert.ok(Math.abs(atJoinFromLeft-atJoinFromRight) < 1e-5, "join velocity must be continuous");
  assert.ok(Math.abs(atJoinFromLeft-joinVelocity) < 1e-5);
  assert.ok(Math.abs((formulas.wideExpansionProgress(step)-formulas.wideExpansionProgress(0))/step-1.8) < 1e-4);
  assert.ok((1-formulas.wideExpansionProgress(duration-step))/step < 1e-4,
    "expansion speed should settle to zero at maximum distance");
  const epsilon = 1e-5;
  let previousSpeed = 1.8;
  for (let i=1; i<1000; i++) {
    const age=duration*i/1000;
    const speed=(formulas.wideExpansionProgress(age+epsilon)-
      formulas.wideExpansionProgress(age-epsilon))/(2*epsilon);
    assert.ok(speed <= previousSpeed+1e-5, "WIDE expansion speed must decrease monotonically");
    previousSpeed=speed;
  }
}

async function checkClock() {
  const replies = new Map();
  const clock = sync.createClock(name => new Promise(resolve => replies.set(name, resolve)), scope);
  const first = clock.select("bright-wide", "audio/" + data("bright-wide").audioFile);
  const last = clock.select("dark-narrow", "audio/" + data("dark-narrow").audioFile);
  replies.get("knock-data/dark-narrow.json")(new Response(JSON.stringify(data("dark-narrow"))));
  await last;
  replies.get("knock-data/bright-wide.json")(new Response(JSON.stringify(data("bright-wide"))));
  await first;
  assert.equal(clock.sample({currentSrc: href("bright-wide"), currentTime: 1.2, loop: true}), null);
  assert.equal(clock.sample({currentSrc: new URL("audio/ui-switch.wav", scope).href, currentTime: 1.2, loop: false}), null);
  assert.equal(clock.sample({currentSrc: href("dark-narrow"), currentTime: 1.2, loop: true}).length, 1);
  for (const key of keys) {
    const entry = data(key), mode = key.split("-")[1];
    const times = entry.knockEvents.map(event => event.time);
    const atOnset = times.map(t => sync.waveAges(times, t, mode, entry.audioDuration).length);
    assert.equal(Math.max(...atOnset), 2);
    const rendered = sync.renderedEventTimes(times, mode, entry.audioDuration);
    if (mode === "wide") {
      assert.equal(sync.wideLeadMs, 50);
      assert.equal(rendered[0], times[0] - 0.05);
      assert.equal(sync.waveAges(rendered, rendered[0], mode, entry.audioDuration)[0], 0);
      assert.ok(Math.abs(sync.waveAges(rendered, times[0], mode, entry.audioDuration)[0] - 0.05) < 1e-9);
      const last = times[times.length - 1];
      const beforeWrap = sync.waveAges(rendered, last - 0.05, mode, entry.audioDuration)[0];
      const afterWrap = sync.waveAges(rendered, 0.02, mode, entry.audioDuration)[0];
      assert.equal(beforeWrap, 0);
      assert.ok(Math.abs(afterWrap - (entry.audioDuration - last + 0.07)) < 1e-9);
    } else {
      assert.equal(rendered, times);
      assert.equal(sync.wideLeadMs, 50);
    }
  }
}

function element() {
  const classes = new Set(), handlers = new Map();
  return {
    dataset: {}, textContent: "", hidden: false, parentElement: {dataset: {}},
    style: {setProperty(){}, removeProperty(){}},
    classList: {
      add: item => classes.add(item), remove: item => classes.delete(item),
      toggle(item, on) { if (on) classes.add(item); else classes.delete(item); },
      contains: item => classes.has(item)
    },
    setAttribute(name, value) { this[name] = value; },
    querySelector() { return this; },
    addEventListener(name, listener) {
      if (!handlers.has(name)) handlers.set(name, []);
      handlers.get(name).push(listener);
    },
    dispatchEvent(event) { for (const listener of handlers.get(event.type) || []) listener(event); }
  };
}

function loadApp({readAsset = read, withMelody = true, fetchAsset = async name => new Response(readAsset(name))} = {}) {
  const elements = new Map();
  const get = id => {
    if (!elements.has(id)) elements.set(id, element());
    return elements.get(id);
  };
  const buttons = keys.map(key => Object.assign(element(), {dataset: {track: key}, textContent: key}));
  const state = get("playback-state");
  state.dataset.state = "idle";
  const events = [];
  const audio = get("audio-player");
  let pausePlay;
  let pendingPlay;
  Object.assign(audio, {
    currentSrc: "", src: "", currentTime: 0, paused: true, ended: false, loop: true,
    fire(type) { this.dispatchEvent({type}); },
    load() { this.currentSrc = this.src ? new URL(this.src, scope).href : ""; this.currentTime = 0; this.ended = false; },
    removeAttribute() { this.src = ""; },
    play() {
      this.paused = false;
      events.push(this.currentSrc);
      if (pausePlay) {
        pausePlay = false;
        return new Promise(resolve => { pendingPlay = resolve; });
      }
      this.fire("play");
      this.fire("playing");
      return Promise.resolve();
    },
    pause() { this.paused = true; this.fire("pause"); }
  });
  const document = Object.assign(element(), {
    body: element(), baseURI: scope, visibilityState: "visible",
    getElementById: get, querySelector(selector) {
      if (selector === ".selector") return get("selector");
      if (selector.includes("aria-pressed")) return buttons.find(button => button["aria-pressed"] === "true");
      return buttons.find(button => selector.includes('"' + button.dataset.track + '"'));
    },
    querySelectorAll() { return buttons; }
  });
  const canvas = get("particle-field");
  let arcs = [];
  let capture = false;
  canvas.getContext = () => ({
    setTransform(){}, clearRect() { arcs = []; }, save(){}, beginPath(){}, rect(){}, clip(){},
    arc(x, y, radius) { if (capture) arcs.push([x, y, radius, this.globalAlpha]); },
    fill(){}, restore(){}
  });
  const requests = new Map(), metrics = new Map(), observers = [];
  let id = 0, time = 0;
  const env = Object.assign(element(), {
    document, location: new URL(scope), navigator: {}, isSecureContext: true, devicePixelRatio: 1,
    URL, URLSearchParams, AbortController, Event, CustomEvent, console,
    fetch: fetchAsset,
    performance: {now: () => time}, setTimeout, clearTimeout,
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} },
    requestAnimationFrame(callback) { requests.set(++id, callback); return id; },
    cancelAnimationFrame(id) { requests.delete(id); }
  });
  env.window = env;
  vm.createContext(env);
  const scripts = ["knock-sync.js", "player.js", "particle-field.js"];
  if (withMelody) scripts.splice(1, 0, "melody-sync.js");
  for (const name of scripts) {
    vm.runInContext(readAsset(name).toString(), env, {filename: name});
  }
  const renderer = env.SEEENParticleField.renderer;
  const render = renderer.render;
  let collect = false;
  let maxConcurrent = 0;
  renderer.render = function (settings) {
    const t = performance.now();
    render.call(this, settings);
    if (!collect) return;
    const waves = settings.waveAges;
    const name = this.motionState === "playing" && waves ?
      waves.length ? settings.mode + (waves.length > 1 ? " multi" : " single") : "quiet" : this.motionState;
    const labels = [name];
    if (waves && this.motionState === "playing" && settings.mode === "narrow") {
      if (waves.some(age => sync.cushionCompression(age) > 0)) labels.push("cushion");
      if (waves.some(age => age >= .38)) labels.push("deceleration");
    }
    if (waves) maxConcurrent = Math.max(maxConcurrent, waves.length);
    const elapsed = performance.now() - t;
    for (const label of labels) {
      if (!metrics.has(label)) metrics.set(label, []);
      metrics.get(label).push(elapsed);
    }
  };

  function flush() { observers.forEach(callback => callback()); }
  async function settle() { await new Promise(resolve => setImmediate(resolve)); flush(); }
  function frame(mediaTime) {
    if (mediaTime !== undefined) audio.currentTime = mediaTime;
    time += 1000 / 60;
    assert.ok(requests.size <= 1, "only one render callback may be pending");
    const entry = requests.entries().next().value;
    if (entry) { requests.delete(entry[0]); entry[1](time); }
  }
  function advance(count, mediaStart) {
    for (let i = 0; i < count; i++) frame(mediaStart === undefined ? undefined : mediaStart + i / 60);
  }
  function select(key) { buttons[keys.indexOf(key)].dispatchEvent({type: "click"}); }
  function toggle() { get("play-toggle").dispatchEvent({type: "click"}); }
  function endCue() {
    audio.currentTime = .75;
    audio.ended = true;
    audio.fire("ended");
  }
  return {
    audio, renderer, formulas: env.SEEENParticleField.formulas,
    constants: env.SEEENParticleField.constants,
    state, document, events, get, select, toggle, endCue, camera: canvas, flush, settle, frame, advance,
    melodyClock: env.SEEENMelodySync?.clock,
    capture(settings) { capture = true; renderer.render(settings); capture = false; return arcs.slice(0, -1); },
    collect(value) { collect = value; },
    pending() { return requests.size; },
    holdNextPlay() { pausePlay = true; },
    releasePlay() { pendingPlay(); },
    performance() {
      const result = {};
      for (const [label, values] of metrics) {
        values.sort((a,b) => a-b);
        result[label] = {frames: values.length, average: +(values.reduce((a,b) => a+b, 0)/values.length).toFixed(2),
          p95: +values[Math.ceil(values.length*.95)-1].toFixed(2), max: +values[values.length-1].toFixed(2)};
      }
      return {rendererMs: result, simulatedFrameIntervalMs: 1000/60, maxDrawnWaves: maxConcurrent};
    }
  };
}

async function checkApp(previewDirectory) {
  const app = loadApp();
  checkWideCurve(app.formulas, app.constants);
  const oldDraw = captureRenderer(previewDirectory);
  const previewTimeline = require(path.resolve(previewDirectory, "timeline.js"));
  for (const mode of ["wide", "narrow"]) for (const theme of ["bright", "dark"]) {
    const knots = data(theme + "-" + mode).knockEvents;
    const times = knots.map(event => event.time);
    const previewEvents = previewTimeline.adjustedEvents(knots, 0, new Map());
    for (const position of [.1, times[0], times[0]+.39, times[0]+.43, times[0]+.49,
      times[0]+1.6, times[1]+.03, 124.69, .15]) {
      const wrapped = position === .15;
      const waveAges = sync.waveAges(times, position, mode, wrapped ? 124.7 : 0);
      const previewWaves = previewTimeline.activeWaves(previewEvents, position, mode, sync.narrow,
        wrapped && mode === "narrow" ? 124.7 : 0).map(wave => wave.age);
      const args = {mode, theme, scale: waveAges.length ? 1 : 0, waveAges};
      const expectedWaves = mode === "wide" && !wrapped ?
        waveAges.map(age => expectedWideProgress(age, sync.lifetimes.wide) * (13+Math.PI) / 3.5) : previewWaves;
      const before = oldDraw({...args, scale: expectedWaves.length ? 1 : 0, waveAges: expectedWaves,
        narrowProfile: sync.narrow}), after = app.capture(args);
      if (wrapped && mode === "wide") {
        assert.equal(before.length, 0);
        assert.equal(waveAges.length, 1);
        assert.ok(after.some(dot => dot[3] > .02), "wrapped WIDE wave retains a visible tail");
        continue;
      }
      assert.equal(before.length, after.length);
      for (const [i, dot] of before.entries()) {
        assert.deepEqual(after[i].slice(0, 3), dot.slice(0, 3));
        assert.ok(Math.abs(after[i][3] - dot[3]) < 1e-12);
      }
    }
  }
  console.log("34 same-source/same-time preview comparisons match. Two WIDE wraps intentionally retain the tail.");

  const {renderer, audio} = app;
  app.collect(true);
  app.select("bright-wide");
  await app.settle();
  assert.equal(audio.currentSrc, href("bright-wide"));
  app.advance(6, 0);
  audio.fire("waiting");
  app.flush();
  assert.equal(renderer.motionState, "emitting");
  app.advance(18, .1);
  assert.equal(renderer.motionState, "playing", "emission finishes even while buffering");
  audio.fire("playing");
  app.flush();
  app.frame(.55);
  assert.equal(renderer.lastRender.waveAges.length, 0);
  const first = data("bright-wide").knockEvents[0].time;
  const second = data("bright-wide").knockEvents[1].time;
  app.advance(26, first + .03);
  app.advance(20, second + .03);
  assert.equal(renderer.lastRender.waveAges.length, 2);
  const frozen = renderer.lastRender.waveAges;
  app.toggle();
  app.flush();
  app.advance(32);
  assert.equal(renderer.motionState, "point");
  assert.equal(audio.paused, true);
  app.toggle();
  await app.settle();
  app.advance(19);
  app.frame();
  assert.equal(renderer.lastRender.waveAges, frozen);
  app.frame(124.69);
  app.frame(.02);
  assert.ok(renderer.lastRender.waveAges[0] > 2, "wide tail survives natural wrap");

  for (const from of keys) {
    if (audio.currentSrc !== href(from)) {
      app.select(from);
      await app.settle();
      app.endCue();
      await app.settle();
      app.advance(57, 0);
    }
    for (const to of keys.filter(key => key !== from)) {
      app.select(to);
      await app.settle();
      assert.match(audio.currentSrc, /ui-switch\.wav$/);
      assert.equal(audio.loop, false);
      assert.equal(renderer.motionState, "resetting");
      app.advance(45, 0);
      app.endCue();
      await app.settle();
      assert.equal(audio.currentSrc, href(to));
      assert.equal(audio.loop, true);
      app.advance(12, 0);
      assert.equal(renderer.motionState, "playing");
      assert.equal(app.document.body.classList.contains("bright"), to.startsWith("bright"));
      assert.equal(renderer.lastRender.waveAges.length, 0);
      assert.equal(renderer.lastRender.melodyFrame.f, to.startsWith("bright") ? 47.5 : 18.75);
      app.select(from);
      await app.settle();
      app.endCue();
      await app.settle();
      app.advance(55, 0);
    }
  }
  app.select("dark-narrow");
  await app.settle();
  app.endCue();
  await app.settle();
  app.advance(56, 0);
  const nFirst = data("dark-narrow").knockEvents[0].time;
  app.advance(31, nFirst + .36);
  app.advance(15, data("dark-narrow").knockEvents[1].time + .03);
  assert.equal(renderer.lastRender.waveAges.length, 2);
  for (const hit of data("dark-narrow").knockEvents.slice(2, 8)) {
    app.advance(20, hit.time + .361);
  }
  app.frame(124.69);
  app.frame(.02);
  assert.ok(renderer.lastRender.waveAges[0] > 2, "narrow tail survives natural wrap");

  app.holdNextPlay();
  app.select("bright-narrow");
  app.select("dark-wide");
  await app.settle();
  app.releasePlay();
  app.endCue();
  await app.settle();
  app.advance(56, 0);
  assert.equal(audio.currentSrc, href("dark-wide"));
  assert.equal(app.state.dataset.state, "playing");
  assert.ok(app.pending() <= 1);
  console.log("App simulation: four tracks, cues, all switch directions, pauses, stalls, wraps and stale plays passed.");
  console.log(JSON.stringify(app.performance(), null, 2));
}

async function checkWorker() {
  const stores = new Map();
  const cacheKey = (request, options) => {
    const url = new URL(typeof request === "string" ? request : request.url, scope);
    if (options?.ignoreSearch) url.search = "";
    return url.href;
  };
  const caches = {
    async open(name) {
      if (!stores.has(name)) stores.set(name, new Map());
      const store = stores.get(name);
      return {
        async match(request, options) { return store.get(cacheKey(request, options))?.clone(); },
        async put(request, response) { store.set(cacheKey(request), response.clone()); }
      };
    }
  };
  await (await caches.open("seeen-audio-v39")).put(scope, new Response("old V03"));
  const oldCache = await caches.open("seeen-v04-step02-1-v1:" + scope);
  await oldCache.put(new URL("index.html", scope).href, new Response("old STEP 02.1"));
  let offline = false, failPath = "", claimCount = 0;
  const v03Scope = "https://041231horiko-cyber.github.io/SEEEN_AUDIO_PLAYER/SEEEN_AUDIO_PLAYER/";
  function worker(workerScope) {
    const handlers = new Map();
    const env = {
      URL, Request, Response, Headers, caches,
      fetch: async request => {
        if (offline) throw Error("offline");
        const name = new URL(typeof request === "string" ? request : request.url, scope).href.slice(scope.length);
        if (name === failPath) throw Error("interrupted download");
        return new Response(read(name === "" ? "index.html" : name), {headers: {"Content-Type": "application/octet-stream"}});
      },
      self: {
        registration: {scope: workerScope},
        clients: {claim() { claimCount++; return Promise.resolve(); }},
        addEventListener(type, handler) { handlers.set(type, handler); }
      }
    };
    vm.runInNewContext(read("service-worker.js").toString(), env, {filename: "service-worker.js"});
    return {
      lifetime(type) {
        let work;
        handlers.get(type)({waitUntil(value) { work = value; }});
        return work;
      },
      async message(type) {
        let output, work;
        handlers.get("message")({data: {type},
          ports: [{postMessage(value) { output = value; }}], waitUntil(value) { work = value; }});
        await work;
        return output;
      },
      fetch(name, range, mode) {
        let response;
        handlers.get("fetch")({request: {url: new URL(name, scope).href, method: "GET",
          credentials: "same-origin", mode, headers: new Headers(range ? {Range: range} : {})},
          respondWith(value) { response = value; }});
        return response;
      }
    };
  }
  await assert.rejects(worker(v03Scope).lifetime("install"), /separate/);
  const instance = worker(scope);
  failPath = "melody-data/step04-rms.json";
  await assert.rejects(instance.lifetime("install"), /interrupted/);
  assert.equal(claimCount, 0);
  assert.equal((await instance.message("CHECK_OFFLINE_STATUS")).ready, false);
  assert.equal(await (await (await caches.open("seeen-audio-v39")).match(scope)).text(), "old V03");
  assert.equal(await (await oldCache.match(new URL("index.html", scope).href)).text(), "old STEP 02.1");
  failPath = null;
  await instance.lifetime("install");
  await instance.lifetime("activate");
  assert.equal(claimCount, 1);
  const status = await instance.message("CHECK_OFFLINE_STATUS");
  assert.equal(status.ready, true);
  assert.equal(status.cacheName, "seeen-v04-extra02-v1:" + scope);
  assert.equal(status.switchCueCached, true);
  const store = stores.get(status.cacheName);
  assert.equal(store.size, 26);
  offline = true;
  assert.equal(await (await instance.fetch("", null, "navigate")).text(), read("index.html").toString());
  for (const name of ["knock-sync.js", "melody-sync.js", "fps-diagnostics.js", "fps-reference.js", "melody-data/step04-rms.json"]) {
    assert.equal(await (await instance.fetch(name)).text(), read(name).toString());
  }
  for (const key of keys) {
    const entry = data(key);
    const name = "audio/" + entry.audioFile;
    const json = await (await instance.fetch("knock-data/" + key + ".json")).json();
    assert.deepEqual(json, entry);
    const full = await instance.fetch(name);
    assert.equal(full.status, 200);
    assert.equal(full.headers.get("Content-Type"), "audio/mp4");
    const bytes = Buffer.from(await full.arrayBuffer());
    assert.deepEqual(bytes, read(name));
    for (const [header, start, end] of [["bytes=0-99", 0, 99], ["bytes=-50", bytes.length-50, bytes.length-1],
      ["bytes=" + (bytes.length-53) + "-", bytes.length-53, bytes.length-1]]) {
      const part = await instance.fetch(name, header);
      assert.equal(part.status, 206);
      assert.equal(part.headers.get("Content-Type"), "audio/mp4");
      assert.equal(part.headers.get("Content-Range"), "bytes " + start + "-" + end + "/" + bytes.length);
      assert.equal(part.headers.get("Content-Length"), String(end-start+1));
      assert.deepEqual(Buffer.from(await part.arrayBuffer()), bytes.subarray(start, end+1));
    }
    assert.equal((await instance.fetch(name, "bytes=-")).status, 416);
    assert.equal((await instance.fetch(name, "bytes=" + bytes.length + "-")).status, 416);
  }
  const cue = await instance.fetch("audio/ui-switch.wav", "bytes=0-11");
  assert.equal(cue.headers.get("Content-Type"), "audio/wav");
  assert.equal(Buffer.from(await cue.arrayBuffer()).toString("ascii", 8), "WAVE");
  const offlineApp = loadApp({fetchAsset: name => instance.fetch(name)});
  for (const [index, key] of keys.entries()) {
    offlineApp.select(key);
    await offlineApp.settle();
    if (index) {
      offlineApp.endCue();
      await offlineApp.settle();
    }
    offlineApp.advance(58, 1.55);
    assert.equal(offlineApp.audio.currentSrc, href(key));
    assert.ok(offlineApp.renderer.lastRender.melodyFrame);
    assert.ok(offlineApp.renderer.lastRender.waveAges.length);
  }
  store.delete(new URL("melody-data/step04-rms.json", scope).href);
  assert.equal((await instance.message("CHECK_OFFLINE_STATUS")).ready, false);
  assert.equal((await instance.message("CACHE_ALL_ASSETS")).ready, false);
  offline = false;
  assert.equal((await instance.message("CACHE_ALL_ASSETS")).ready, true);
  assert.equal(instance.fetch("unknown"), undefined);
  console.log("Worker simulation: 26 assets, update failure/repair, offline sync data and scripts, four MP4 streams, 206/416 and WAV passed.");
}

async function main() {
  if (!process.argv[2]) throw new Error("Pass the unpacked STEP 01.3 preview directory");
  await checkClock();
  await checkApp(process.argv[2]);
  await checkWorker();
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = {loadApp, checkWorker};
