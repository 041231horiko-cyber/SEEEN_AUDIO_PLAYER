(function (root) {
  "use strict";

  const narrow = Object.freeze({
    diffusionMs: 380, returnMs: 1800, boundaryPercent: 70, decayPercent: 50,
    cushionMs: 100, compressionPercent: 30, speedDecayPercent: 55, startSpeedPercent: 70
  });
  const outward = narrow.diffusionMs / 1000;
  const inward = narrow.returnMs / 1000;
  const remaining = 1.19;
  const slowdown = narrow.speedDecayPercent / 100;
  const startScale = narrow.startSpeedPercent / 100;
  const wallRate = 2 / (outward + inward / remaining);
  const returnSeconds = inward / (startScale * (1 - slowdown / 2));
  const lifetimes = {wide: (13 + Math.PI) / 3.5, narrow: outward + returnSeconds};
  const empty = Object.freeze([]);

  function segment(u, distance, startRate, endRate) {
    return distance * u * u * (3 - 2 * u) +
      u * (1 - u) * (startRate * (1 - u) - endRate * u);
  }

  function narrowTravel(age) {
    if (age <= 0) return 0;
    if (age < outward) return segment(age / outward, 1, 1, wallRate * startScale * outward);
    if (age >= lifetimes.narrow) return 1 + remaining;
    const q = (age - outward) / returnSeconds;
    const u = q * (1 - slowdown * q / 2) / (1 - slowdown / 2);
    return 1 + segment(u, remaining, wallRate * inward, remaining);
  }

  function cushionCompression(age) {
    const u = (age * 1000 - narrow.diffusionMs) / narrow.cushionMs;
    if (u <= 0 || u >= 1) return 0;
    return (narrow.compressionPercent / 100) * 16 * u * u * (1 - u) * (1 - u);
  }

  function upperBound(times, time) {
    let left = 0;
    let right = times.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (times[mid] <= time) left = mid + 1;
      else right = mid;
    }
    return left;
  }

  function waveAges(times, time, mode, previousCycleDuration) {
    const ages = [];
    const limit = lifetimes[mode];
    for (let i = upperBound(times, time) - 1; i >= 0; i--) {
      const age = time - times[i];
      if (age >= limit) break;
      ages.push(age);
    }
    // Only reached after observing a natural wrap for this source instance.
    if (previousCycleDuration && time < limit) {
      for (let i = times.length - 1; i >= 0; i--) {
        const age = previousCycleDuration - times[i] + time;
        if (age >= limit) break;
        ages.push(age);
      }
    }
    return ages.length ? ages : empty;
  }

  function createClock(fetchData, baseUrl) {
    const loaded = new Map();
    let track;
    let source;
    let request;
    let dataset;
    let lastTime;
    let lastAges = empty;
    let previousCycle = 0;

    function select(key, src) {
      if (request) request.abort();
      track = key;
      source = new URL(src, baseUrl).href;
      lastTime = undefined;
      lastAges = empty;
      previousCycle = 0;
      dataset = loaded.get(key);
      if (dataset) return Promise.resolve();
      const task = new AbortController();
      request = task;
      return fetchData("knock-data/" + key + ".json", {signal: task.signal}).then(response => {
        if (!response.ok) throw new Error("Knock data HTTP " + response.status);
        return response.json();
      }).then(data => {
        const times = data.knockEvents.map(event => event.time);
        if (data.schemaVersion !== 1 || data.trackId !== key || data.audioDuration !== 124.7 ||
            new URL("audio/" + data.audioFile, baseUrl).href !== source ||
            !/^[a-f0-9]{64}$/.test(data.audioSha256) || times.length !== 35 ||
            !times.every((time, i) => Number.isFinite(time) && time >= 0 && time < data.audioDuration &&
              (!i || time > times[i - 1]))) throw new Error("Knock data does not match this track");
        if (task.signal.aborted || request !== task) return;
        dataset = {times, duration: data.audioDuration};
        loaded.set(key, dataset);
      }).catch(error => {
        if (!task.signal.aborted) console.warn("[SEEEN knock sync]", error);
      }).finally(() => {
        if (request === task) request = null;
      });
    }

    function sample(audio) {
      if (!dataset || audio.currentSrc !== source) return null;
      const time = audio.currentTime;
      if (!Number.isFinite(time) || time < 0) return null;
      if (time === lastTime) return lastAges;
      if (lastTime > time) {
        previousCycle = audio.loop && lastTime >= dataset.duration - 2 && time < 2 ? dataset.duration : 0;
      }
      lastTime = time;
      lastAges = waveAges(dataset.times, time, track.endsWith("-wide") ? "wide" : "narrow", previousCycle);
      return lastAges;
    }

    return {select, sample};
  }

  const sync = {narrow, lifetimes, narrowTravel, cushionCompression, waveAges, createClock};
  if (typeof module === "object") module.exports = sync;
  else root.SEEENKnockSync = sync;
}(typeof window === "object" ? window : undefined));
