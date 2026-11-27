// Compare the deployed diagnostic reference against the exact STEP 06.2 source,
// then compare Canvas inputs on the same clocks and wave ages.
"use strict";
const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");
const {loadApp} = require("../v04-audio/verify-step02");
const app = path.resolve(__dirname, "../../SEEEN_AUDIO_PLAYER");
const base = "6d95111cda2066283e50b797808983357943b862";
const oldField = execFileSync("git", ["show", base + ":SEEEN_AUDIO_PLAYER/particle-field.js"], {cwd: app});
const read = name => fs.readFileSync(path.join(app, name));
assert.deepEqual(read("fps-reference.js"), oldField);
const reference = loadApp({readAsset: name => name === "particle-field.js" ? oldField : read(name)});
const current = loadApp();
const knock = require("../../SEEEN_AUDIO_PLAYER/knock-sync");
const melody = require("../../SEEEN_AUDIO_PLAYER/melody-sync");
const cases = [
  [], [0], [.12], [.379], [.38], [.43], [.48], [.5], [1.7], [2.5], [3.8],
  [.03, 1.7], [.43, 2.3], [.5, 2.5], [.6, 1.7, 2.7], [4.58], []
];
let comparisons = 0, maxAlphaError = 0;
for (const mode of ["wide", "narrow"]) {
  for (const theme of ["bright", "dark"]) {
    for (const scale of [1, .23]) {
      for (const [i, waveAges] of cases.entries()) {
        const time = i * .377 + 124.7;
        const melodyFrame = melody.phaseFrame(-23 + Math.sin(time) * 8, theme === "bright", time);
        const args = {mode, theme, scale, time, waveAges, melodyFrame, fieldOpacity: i % 2 ? .63 : 1};
        const old = reference.capture(args), next = current.capture(args);
        assert.equal(old.length, next.length);
        for (let p = 0; p < old.length; p++) {
          for (let prop = 0; prop < 3; prop++) assert.equal(next[p][prop], old[p][prop]);
          maxAlphaError = Math.max(maxAlphaError, Math.abs(next[p][3] - old[p][3]));
          comparisons++;
        }
      }
    }
  }
}
assert.ok(maxAlphaError < 1e-13, "only double-precision roundoff is allowed");
for (let i = 0; i <= 1024; i++) {
  const age = i * knock.lifetimes.wide / 1024;
  assert.equal(current.formulas.wideExpansionPhase(age), reference.formulas.wideExpansionPhase(age));
}
console.log(JSON.stringify({comparisons, maxAlphaError, maxPositionAndRadiusError: 0, wideCurveSamples: 1025}));
