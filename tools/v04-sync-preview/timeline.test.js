const assert = require("node:assert/strict");
const {test} = require("node:test");
const {activeWaves, adjustedEvents, lifetimes, narrowDefaults, narrowTravel} = require("./timeline");

// Synthetic unit fixtures only. The package uses all 35 original timestamps.
const events = adjustedEvents([
  {time: 1.2, echoes: [{time: 1.7}]},
  {time: 4.4, echoes: []},
  {time: 121.9, echoes: []}
], 0, new Map());

test("WIDE appears at the direct timestamp and finishes without repeating", () => {
  assert.deepEqual(activeWaves(events, 1.199, "wide"), []);
  assert.deepEqual(activeWaves(events, 1.2, "wide"), [{id: 0, age: 0}]);
  assert.deepEqual(activeWaves(events, 9.1, "wide"), []);
});

test("NARROW reflection markers do not emit waves", () => {
  assert.deepEqual(activeWaves(events, 1.7, "narrow"), [{id: 0, age: .5}]);
  assert.deepEqual(activeWaves(events, 8, "narrow"), []);
  assert.ok(lifetimes.narrow > 3.31 && lifetimes.narrow < 3.32);
});

test("dropped frames and forward or backward seeks reconstruct from audio time", () => {
  const overlap = activeWaves(events, 4.5, "wide");
  assert.deepEqual(overlap.map(wave => wave.id), [1, 0]);
  assert.ok(Math.abs(overlap[0].age - .1) < 1e-9);
  assert.ok(Math.abs(overlap[1].age - 3.3) < 1e-9);
  assert.deepEqual(activeWaves(events, 4.5, "wide"), overlap);
  assert.deepEqual(activeWaves(events, 2.2, "wide").map(wave => wave.id), [0]);
});

test("loop seam clears the old event and the next pass uses the same timestamp", () => {
  assert.equal(activeWaves(events, 124.69, "wide")[0].id, 2);
  assert.deepEqual(activeWaves(events, 0, "wide"), []);
  assert.deepEqual(activeWaves(events, 1.2, "wide"), [{id: 0, age: 0}]);
});

test("global and individual offsets are sorted by adjusted time", () => {
  const original = [{time: 1.2}, {time: 1.3}];
  assert.deepEqual(adjustedEvents(original, -50, new Map([[0, 300]])),
    [{id: 1, time: 1.25}, {id: 0, time: 1.45}]);
  assert.equal(original[0].time, 1.2);
});

test("asymmetric travel hits the wall and endpoint at the specified independent times", () => {
  assert.equal(narrowTravel(0, narrowDefaults), 0);
  assert.equal(narrowTravel(.5, narrowDefaults), 1);
  assert.equal(narrowTravel(1.7, narrowDefaults), 2.19);
  assert.equal(narrowTravel(.5), .33);
  const slowerReturn = {...narrowDefaults, returnMs: 2000};
  assert.equal(narrowTravel(.5, slowerReturn), 1);
  assert.ok(narrowTravel(1.7, slowerReturn) < 2.19);
});

test("travel stays strictly forward with continuous, positive wall velocity across slider extremes", () => {
  for (const diffusionMs of [100, 500, 3000]) {
    for (const returnMs of [200, 1200, 6000]) {
      const profile = {...narrowDefaults, diffusionMs, returnMs};
      const wall = diffusionMs / 1000;
      const duration = (diffusionMs + returnMs) / 1000;
      const eps = 1e-7;
      const before = (1 - narrowTravel(wall - eps, profile)) / eps;
      const after = (narrowTravel(wall + eps, profile) - 1) / eps;
      assert.ok(before > 0 && Math.abs(before - after) / before < 1e-4);
      let previous = 0;
      for (let i = 1; i <= 1000; i++) {
        const position = narrowTravel(duration * (i / 1000), profile);
        assert.ok(position > previous);
        previous = position;
      }
    }
  }
});

test("longer NARROW settings keep both direct waves active on the same clock", () => {
  const profile = {...narrowDefaults, returnMs: 5000};
  assert.deepEqual(activeWaves(events, 4.55, "narrow", profile).map(wave => wave.id), [1, 0]);
  assert.deepEqual(activeWaves(events, 4.55, "narrow").map(wave => wave.id), [1]);
  assert.deepEqual(activeWaves(events, 4.55, "wide", profile), activeWaves(events, 4.55, "wide"));
});
