// Compare real renderer commands with STEP 03.3 and STEP 02.1.
// Canvas drawing, media and Service Worker lifecycle are mocked.
"use strict";
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {performance} = require("node:perf_hooks");
const {loadApp} = require("./verify-step02");
const appDir = path.resolve(__dirname, "../../SEEEN_AUDIO_PLAYER");
const melody = require("../../SEEEN_AUDIO_PLAYER/melody-sync");
const knock = require("../../SEEEN_AUDIO_PLAYER/knock-sync");
const data = require("../../SEEEN_AUDIO_PLAYER/melody-data/step04-rms.json");
const baseRef = "9dac3c1b658eebdee82a3d5ab05fdc5efdabd1e3";
const scope = "https://local.test/v04/";
const profiles = melody.prepareData(data, scope);
const near = (actual, expected, epsilon = 1e-11) =>
  assert.ok(Math.abs(actual - expected) <= epsilon, actual + " vs " + expected);
function expectedWideAge(age) {
  const maxPhase = 13 + Math.PI;
  const duration = maxPhase / 3.5;
  const p = Math.max(0, Math.min(1, age / duration));
  return maxPhase * (0.5 * p + 0.5 * (1 - Math.pow(1 - p, 3))) / 3.5;
}

const previewPath = path.resolve(process.argv[2]);
const preview = require(path.join(previewPath, "melody.js")).MelodyPreview;
const {createRenderer} = require(path.join(previewPath, "preview.js"));
const originalFiles = new Map();
const before = loadApp({withMelody: false, readAsset(name) {
  if (!originalFiles.has(name)) originalFiles.set(name,
    execFileSync("git", ["show", baseRef + ":SEEEN_AUDIO_PLAYER/" + name], {cwd: appDir}));
  return originalFiles.get(name);
}});
const app = loadApp();
const duration = data.audioDuration;
const previewDots = [];
const previewRender = createRenderer({getContext: () => ({
  clearRect() { previewDots.length = 0; }, beginPath(){},
  arc(x, y, radius) { previewDots.push([x + 12, y + 75, radius, this.globalAlpha]); },
  fill(){}
})});

async function main() {
  const metrics = [];
  let brightnessComparisons = 0, particleComparisons = 0;
  for (const [key, track] of profiles.tracks) {
    const [theme, mode] = key.split("-");
    const full = require(path.join(previewPath, "analysis", key + ".json"));
    const prepared = preview.prepareFeatures(full, 400);
    assert.deepEqual(track.values, prepared.rms);
    const values = [];
    for (let i = 0; i < track.values.length * 2; i++) {
      const t = i * data.sampleInterval / 2;
      const rms = melody.sampleRms(track.values, data.sampleInterval, t);
      const param = preview.parameters("AMPLITUDE", preview.defaults, preview.sampleFeatures(prepared, full.sampleInterval, t));
      const expected = preview.phaseFrame(param, theme === "bright", t);
      assert.deepEqual(melody.phaseFrame(rms, theme === "bright", t), expected);
      values.push(expected.brightness);
      brightnessComparisons++;
    }
    near(Math.min(...values), .2);
    near(Math.max(...values), .4);
    near(melody.sampleRms(track.values, data.sampleInterval, duration - 1e-9),
      melody.sampleRms(track.values, data.sampleInterval, 0), 1e-5);

    const times = knock.renderedEventTimes(full.knockEvents.map(event => event.time), mode, duration);
    for (const [time, cycles] of [[0, 0], [1, 0], [times[0] + .38, 0], [times[0] + .43, 0],
      [times[1] + .16, 0], [times[1] + .64, 0], [124.69, 0], [.01, 1], [56.78, 0], [94.2, 3]]) {
      const ages = knock.waveAges(times, time, mode, cycles ? duration : 0);
      const settings = {mode, theme, time, scale: 1, waveAges: ages};
      const oldRendererAges = mode === "wide" ? ages.map(expectedWideAge) : ages;
      const appKnock = app.capture(settings);
      const referenceKnock = before.capture({...settings, waveAges: oldRendererAges});
      assert.equal(appKnock.length, referenceKnock.length);
      for (let i = 0; i < appKnock.length; i++) {
        appKnock[i].forEach((value, component) => near(value, referenceKnock[i][component], 1e-12));
      }
      const param = preview.parameters("AMPLITUDE", preview.defaults, preview.sampleFeatures(prepared, full.sampleInterval, time));
      const expectedFrame = preview.phaseFrame(param, theme === "bright", time + cycles * duration);
      const melodyFrame = melody.phaseFrame(melody.sampleRms(track.values, data.sampleInterval, time),
        theme === "bright", time + cycles * duration);
      for (const waveAges of [[], ages]) {
        const previewAges = mode === "wide" ? waveAges.map(expectedWideAge) : waveAges;
        previewRender({mode, theme, melodyFrame: expectedFrame, ages: previewAges});
        const pixels = app.capture({...settings, melodyFrame, waveAges});
        assert.equal(previewDots.length - 1, pixels.length);
        for (let i = 0; i < pixels.length; i++) {
          pixels[i].forEach((value, component) => near(value, previewDots[i][component]));
          particleComparisons++;
        }
      }
    }

    const clock = melody.createClock(async () => new Response(JSON.stringify(data)), scope);
    const meta = data.tracks[key];
    await clock.select(key, "audio/" + meta.audioFile);
    const audio = {currentSrc: track.source, currentTime: 3.5, paused: false, loop: true};
    const frame = clock.sample(audio);
    assert.ok(frame);
    audio.paused = true;
    assert.equal(clock.sample(audio), null);
    audio.paused = false;
    assert.equal(clock.sample(audio), frame);
    audio.currentTime = 82.35; // seek forward
    assert.deepEqual(clock.sample(audio), melody.phaseFrame(melody.sampleRms(track.values, .05, 82.35), track.bright, 82.35));
    audio.seeking = true;
    audio.currentTime = 15.8;
    assert.equal(clock.sample(audio), null);
    audio.seeking = false;
    assert.deepEqual(clock.sample(audio), melody.phaseFrame(melody.sampleRms(track.values, .05, 15.8), track.bright, 15.8));
    audio.currentTime = 124.69;
    clock.observe(audio);
    audio.currentTime = .01;
    clock.observe(audio);
    assert.deepEqual(clock.sample(audio), melody.phaseFrame(melody.sampleRms(track.values, .05, .01), track.bright, duration + .01));
    audio.currentTime = 124.69;
    clock.observe(audio);
    audio.currentTime = .5;
    clock.seek(audio);
    assert.deepEqual(clock.sample(audio), melody.phaseFrame(melody.sampleRms(track.values, .05, .5), track.bright, duration + .5));
    await clock.select(key, "audio/" + meta.audioFile);
    audio.currentTime = .01;
    assert.deepEqual(clock.sample(audio), melody.phaseFrame(melody.sampleRms(track.values, .05, .01), track.bright, .01));
    audio.currentSrc = scope + "audio/ui-switch.wav";
    assert.equal(clock.sample(audio), null);

    if (theme !== "bright") continue;
    const overlap = times.find((time, i) => i && time - times[i - 1] < knock.lifetimes[mode] - .65);
    const starts = [[0, .12], [1, times[0] + .2], [2, overlap + .2]];
    for (const [count, start] of starts) {
      const samples = [];
      for (let i = 0; i < 145; i++) {
        const time = start + (i % 17) / 100;
        const begin = performance.now();
        const waveAges = knock.waveAges(times, time, mode, 0);
        assert.equal(waveAges.length, count);
        const melodyFrame = melody.phaseFrame(melody.sampleRms(track.values, .05, time), true, time);
        app.renderer.render({mode, theme, time, scale: 1, waveAges, melodyFrame});
        if (i >= 45) samples.push(performance.now() - begin);
      }
      samples.sort((a, b) => a - b);
      const ms = value => value.toFixed(2);
      metrics.push({mode, knockWaves: count, average: ms(samples.reduce((a, b) => a + b, 0) / samples.length),
        median: ms((samples[49] + samples[50]) / 2), p95: ms(samples[94]), max: ms(samples[99])});
    }
  }

  app.select("bright-wide");
  await app.settle();
  app.advance(25, 1);
  assert.ok(app.renderer.lastRender.melodyFrame);
  const frozen = app.renderer.lastRender.melodyFrame;
  app.toggle();
  app.flush();
  app.frame();
  assert.equal(app.renderer.lastRender.melodyFrame, frozen);
  app.advance(26);
  assert.equal(app.renderer.motionState, "point");
  app.toggle();
  await app.settle();
  app.advance(20);
  assert.equal(app.renderer.lastRender.melodyFrame, frozen);
  app.select("dark-wide");
  await app.settle();
  assert.match(app.audio.currentSrc, /ui-switch\.wav$/);
  app.frame();
  assert.ok(!app.renderer.lastRender.melodyFrame);
  app.advance(58);
  assert.ok(!app.renderer.lastRender.melodyFrame);
  app.endCue();
  await app.settle();
  app.advance(18, 0);
  assert.ok(app.renderer.lastRender.melodyFrame);
  assert.equal(app.renderer.lastRender.melodyFrame.f, 18.75);
  assert.ok(app.pending() <= 1);
  console.log("PASS", brightnessComparisons, "brightness/phase frames,", particleComparisons,
    "particle coordinate/radius/alpha comparisons, STEP 02.1 knock snapshots and media state");
  console.log("Node VM, mock Canvas, milliseconds/frame, 100 frames per case after warmup");
  console.table(metrics);
}
main().catch(error => {console.error(error); process.exitCode = 1;});
