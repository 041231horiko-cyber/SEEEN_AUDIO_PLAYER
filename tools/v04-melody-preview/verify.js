"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const {performance} = require("node:perf_hooks");
const {createHash} = require("node:crypto");
const model = require("./melody.js").MelodyPreview;
const knock = require("./knock-sync.js");
const base = require("./step021-particles.js").Step021Particles;
const {createRenderer} = require("./preview.js");

const defaults = model.defaults;
const modes = ["BASE", "AMPLITUDE", "FREQUENCY", "COMBINED"];
const fields = ["wide", "narrow"];
const load = id => JSON.parse(fs.readFileSync(__dirname + "/analysis/" + id + ".json"));
const near = (a, b, tolerance = 1e-10) => assert.ok(Math.abs(a - b) <= tolerance, a + " vs " + b);
const bounds = (value, min, max) => assert.ok(value >= min && value <= max, value + " outside " + min + "–" + max);

const datasets = {};
const measured = {};
for (const theme of ["bright", "dark"]) {
  const bright = theme === "bright";
  for (const mode of fields) {
    const id = theme + "-" + mode;
    const data = load(id);
    const audio = fs.readFileSync(__dirname + "/audio/" + data.audioFile);
    assert.equal(createHash("sha256").update(audio).digest("hex"), data.audioSha256);
    const times = data.knockEvents.map(hit => hit.time);
    const scheduled = knock.renderedEventTimes(times, mode, data.audioDuration);
    assert.equal(times.length, 35);
    times.forEach((time, i) => near(time - scheduled[i], mode === "wide" ? 0.05 : 0));
    const prepared = model.prepareFeatures(data, defaults.smoothing);
    datasets[id] = {data, prepared, scheduled};
    assert.equal(prepared.rms.length, 2494);
    const seen = {brightness: [], wavelength: [], balance: []};
    for (let i = 0; i < prepared.rms.length; i++) {
      const t = i * data.sampleInterval;
      const feature = model.sampleFeatures(prepared, data.sampleInterval, t);
      for (const preset of modes) {
        const p = model.parameters(preset, defaults, feature);
        assert.equal(p.speed, 150);
        if (preset === "AMPLITUDE" || preset === "COMBINED") bounds(p.brightness, 20, 40);
        else assert.equal(p.brightness, 30);
        if (preset === "FREQUENCY" || preset === "COMBINED") bounds(p.wavelength, 65, 95);
        else assert.equal(p.wavelength, 80);
        if (preset === "COMBINED") {
          bounds(p.balance, 35, 65);
          for (const k of Object.keys(seen)) seen[k].push(p[k]);
        } else assert.equal(p.balance, 50);
      }
    }
    measured[id] = Object.fromEntries(Object.entries(seen).map(([k, values]) =>
      [k, [Math.min(...values).toFixed(1), Math.max(...values).toFixed(1)]]));
    const before = model.sampleFeatures(prepared, data.sampleInterval, data.audioDuration - 1e-9);
    const after = model.sampleFeatures(prepared, data.sampleInterval, 0);
    for (const key of Object.keys(before)) near(before[key], after[key], 0.00001);

    const points = mode === "wide" ? base.makeWide() : base.makeNarrow();
    assert.equal(points.length, mode === "wide" ? 6500 : 9500);
    for (const {x, y} of points.filter((_, i) => i % 37 === 0)) {
      const r = Math.hypot(x, y);
      const env = Math.max(0, 1 - (r / (mode === "narrow" ? 1.42 : 1.05)) ** 1.5);
      for (const t of [0, 1.37, 73.12, 124.69, 201.9, 950.2]) {
        const f = (bright ? 38 : 15) * 100 / 80;
        const phase = t * (bright ? 1.8 : 0.85) * 150 / 100;
        const s = 0.5 + 0.25 * Math.sin(r * f - phase) + 0.25 * Math.sin(r * f * 0.61 + x * 3 + phase * 0.62);
        const frame = model.phaseFrame(defaults, bright, t);
        near(model.alpha({melodyRadius: r, melodyX: x * 3, melodyEnvelope: env}, frame),
          Math.max(0, s) ** 4 * env * 0.3);
      }
    }
  }
}

const duration = 124.7;
const timeline = model.createTimeline(duration);
assert.deepEqual(timeline.sample(12), timeline.sample(12));
timeline.sample(duration - 0.01);
const wrap = timeline.sample(0.01);
near(wrap.elapsed, duration + 0.01);
assert.equal(wrap.previousCycle, duration);
assert.ok(knock.waveAges(datasets["bright-wide"].scheduled, 0.01, "wide", wrap.previousCycle).length);
timeline.seek();
assert.deepEqual(timeline.sample(110), {elapsed: duration + 110, previousCycle: 0});
timeline.seek();
assert.deepEqual(timeline.sample(0), {elapsed: duration, previousCycle: 0});

let drawn = new Map(), position;
const stub = {
  clearRect() { drawn = new Map(); }, beginPath() {},
  arc(x, y, radius) { position = [x, y, radius].join(","); },
  fill() { drawn.set(position, this.globalAlpha); }
};
const capture = createRenderer({getContext: () => stub});
for (const mode of fields) {
  const melodyFrame = model.phaseFrame(defaults, true, 1.234);
  const ages = [0.55, 3.5];
  const args = {mode, theme: "bright"};
  capture({...args, melodyFrame, ages: []});
  const melodyOnly = drawn;
  capture({...args, melodyFrame: null, ages});
  const knockOnly = drawn;
  capture({...args, melodyFrame, ages});
  assert.equal(drawn.size, new Set([...melodyOnly.keys(), ...knockOnly.keys()]).size);
  for (const [key, value] of drawn) near(value, Math.max(melodyOnly.get(key) || 0, knockOnly.get(key) || 0));
}
console.log("PASS: audio SHA-256, BASE formula, profile bounds, phase, wrap/seek, particle counts and max blend");
console.table(measured);

// Dummy Canvas methods exclude browser rasterization. Every frame computes all
// requested wave, feature and particle values using the same renderer as the UI.
const dummyCanvas = {getContext: () => ({clearRect(){}, beginPath(){}, arc(){}, fill(){}})};
const render = createRenderer(dummyCanvas);
const performanceRows = [];
for (const mode of fields) {
  const {data, prepared, scheduled} = datasets["bright-" + mode];
  const two = scheduled.find((start, i) => i > 0 && start - scheduled[i - 1] < knock.lifetimes[mode] - 0.6);
  assert.ok(two !== undefined);
  const samples = [
    ["MELODY", 0, scheduled[0] + 0.18],
    ["KNOCK", 1, scheduled[0] + 0.18],
    ["KNOCK", 2, two + 0.18],
    ["BOTH", 1, scheduled[0] + 0.18],
    ["BOTH", 2, two + 0.18]
  ];
  for (const preset of ["BASE", "COMBINED"]) {
    for (const [layer, count, start] of samples) {
      const times = [];
      for (let i = 0; i < 80; i++) {
        const t = start + (i % 16) / 90;
        const tick = performance.now();
        const features = model.sampleFeatures(prepared, data.sampleInterval, t);
        const effective = model.parameters(preset, defaults, features);
        const melodyFrame = layer === "KNOCK" ? null : model.phaseFrame(effective, true, t);
        const ages = layer === "MELODY" ? [] : knock.waveAges(scheduled, t, mode, 0);
        assert.equal(ages.length, count);
        render({mode, theme: "bright", melodyFrame, ages});
        if (i >= 20) times.push(performance.now() - tick);
      }
      times.sort((a, b) => a - b);
      performanceRows.push({field: mode, preset, layer, count,
        p50: times[29].toFixed(2), p95: times[56].toFixed(2)});
    }
  }
}
console.log("Node with dummy Canvas, milliseconds per frame after warmup");
console.table(performanceRows);
