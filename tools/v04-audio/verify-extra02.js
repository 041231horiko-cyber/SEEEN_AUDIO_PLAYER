"use strict";
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const melody = require("../../SEEEN_AUDIO_PLAYER/melody-sync");
const app = path.resolve(__dirname, "../../SEEEN_AUDIO_PLAYER");
const baseline = "47ffb78917288341fd7817e4ccb8bd1233e55eac";
const baseRead = file => execFileSync("git", ["show", baseline + ":SEEEN_AUDIO_PLAYER/" + file], {cwd: app, maxBuffer: 8 * 1024 * 1024});
const currentRead = file => fs.readFileSync(path.join(app, file));
const manifest = "melody-data/step04-rms.json";
const oldData = JSON.parse(baseRead(manifest));
const newData = JSON.parse(currentRead(manifest));
const scope = "https://seeen.invalid/";
const ref = {module: {exports: {}}, URL};
vm.runInNewContext(baseRead("melody-sync.js").toString(), ref);
const referenceMelody = ref.module.exports;
const base = referenceMelody.prepareData(oldData, scope);
const uncorrected = referenceMelody.prepareData(newData, scope);
const current = melody.prepareData(newData, scope);

assert.equal(newData.sampleInterval, oldData.sampleInterval);
assert.equal(newData.audioDuration, oldData.audioDuration);
assert.deepEqual(newData.rmsTenthsDbfs.bright, oldData.rmsTenthsDbfs.bright);
for (const name of ["knock-sync.js", "particle-field.js", "fps-diagnostics.js", "fps-reference.js",
  "style.css", "index.html", "audio/ui-switch.wav"]) {
  assert.deepEqual(currentRead(name), baseRead(name), name);
}
for (const [key, track] of Object.entries(newData.tracks)) {
  const file = "knock-data/" + key + ".json";
  const events = JSON.parse(currentRead(file));
  const oldEvents = JSON.parse(baseRead(file));
  assert.deepEqual(events.knockEvents, oldEvents.knockEvents);
  const audio = currentRead("audio/" + track.audioFile);
  const sha = crypto.createHash("sha256").update(audio).digest("hex");
  assert.equal(sha, events.audioSha256);
  assert.equal(sha, track.audioSha256);
  if (key.startsWith("bright")) {
    assert.deepEqual(audio, baseRead("audio/" + track.audioFile));
    assert.deepEqual(track, oldData.tracks[key]);
    assert.deepEqual(currentRead(file), baseRead(file));
  } else {
    assert.notEqual(sha, oldData.tracks[key].audioSha256);
  }
}

function curve(set, key) {
  const track = set.tracks.get(key);
  return Array.from({length: Math.round(set.duration * 200)}, (_, i) =>
    melody.phaseFrame(melody.sampleRms(track.values, set.interval, i / 200), track.bright, i / 200).brightness * 100);
}
function describe(values, reference) {
  const sorted = values.slice().sort((a, b) => a - b);
  const percentile = q => sorted[Math.floor(q * (sorted.length - 1))];
  const mean = a => a.reduce((sum, value) => sum + value, 0) / a.length;
  const delta = values.map((value, i) => Math.abs(value - reference[i]));
  const centered = a => { const m = mean(a); return a.map(x => x - m); };
  const a = centered(values), b = centered(reference);
  const correlation = mean(a.map((x, i) => x * b[i])) /
    Math.sqrt(mean(a.map(x => x*x)) * mean(b.map(x => x*x)));
  return {p05: percentile(.05), median: percentile(.5), p95: percentile(.95), mean: mean(values),
    capPercent: values.filter(value => value === 40).length * 100 / values.length,
    meanAbsoluteDifference: mean(delta), maxDifference: Math.max(...delta), correlation};
}

for (const key of ["bright-wide", "bright-narrow"]) {
  assert.deepEqual(curve(current, key), curve(base, key));
}
const previous = curve(base, "dark-wide");
const raw = curve(uncorrected, "dark-wide");
const corrected = curve(current, "dark-wide");
assert.deepEqual(corrected, curve(current, "dark-narrow"));
const result = describe(corrected, previous);
assert.equal(corrected[0], 20);
assert.equal(corrected.at(-1), 20);
assert.ok(result.correlation > 0.995 && result.meanAbsoluteDifference < 0.25);
assert.ok(Math.abs(result.capPercent - describe(previous, previous).capPercent) < 0.5);
console.log(JSON.stringify({samples: previous.length, old: describe(previous, previous),
  uncorrected: describe(raw, previous), corrected: result}, null, 2));
