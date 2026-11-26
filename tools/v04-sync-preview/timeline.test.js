const assert = require("node:assert/strict");
const {test} = require("node:test");
const {activeWaves, adjustedEvents, lifetimes} = require("./timeline");

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
