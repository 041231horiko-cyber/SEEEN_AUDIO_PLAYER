(function (root) {
  "use strict";

  const lifetimes = {
    wide: (13 + Math.PI) / 3.5,
    narrow: (1.97 + .22) / .66
  };
  const narrowEnd = 1.97 + .22;
  const narrowDefaults = Object.freeze({
    diffusionMs: 500, returnMs: 1200, boundaryPercent: 75, decayPercent: 65
  });

  function lifetime(mode, narrowProfile) {
    return mode === "narrow" && narrowProfile
      ? (narrowProfile.diffusionMs + narrowProfile.returnMs) / 1000 : lifetimes[mode];
  }

  // Hermite interpolation with a shared, nonzero velocity at the wall.
  // The harmonic mean limits either endpoint slope to twice its segment's
  // average velocity, keeping both intervals strictly increasing.
  function segment(u, distance, startRate, endRate) {
    return distance * u * u * (3 - 2 * u) +
      u * (1 - u) * (startRate * (1 - u) - endRate * u);
  }

  function narrowTravel(age, profile) {
    if (!profile) return age * .66;
    const outward = profile.diffusionMs / 1000;
    const inward = profile.returnMs / 1000;
    const remaining = narrowEnd - 1;
    const faster = 1 / outward;
    const slower = remaining / inward;
    const wallRate = 2 / (1 / faster + 1 / slower);
    if (age <= 0) return 0;
    if (age < outward) return segment(age / outward, 1, 1, wallRate * outward);
    if (age >= outward + inward) return narrowEnd;
    return 1 + segment((age - outward) / inward, remaining, wallRate * inward, remaining);
  }

  function upperBound(events, time) {
    let left = 0;
    let right = events.length;
    while (left < right) {
      const mid = (left + right) >>> 1;
      if (events[mid].time <= time) left = mid + 1;
      else right = mid;
    }
    return left;
  }

  function activeWaves(events, time, mode, narrowProfile) {
    const waves = [];
    const limit = lifetime(mode, narrowProfile);
    for (let i = upperBound(events, time) - 1; i >= 0; i--) {
      const age = time - events[i].time;
      if (age >= limit) break;
      waves.push({ id: events[i].id, age });
    }
    return waves;
  }

  function adjustedEvents(events, globalMs, corrections) {
    return events.map((event, id) => ({
      id,
      time: (Math.round(event.time * 1000) + globalMs + (corrections.get(id) || 0)) / 1000
    })).sort((a, b) => a.time - b.time || a.id - b.id);
  }

  const timeline = { lifetimes, narrowDefaults, narrowTravel, upperBound, activeWaves, adjustedEvents };
  if (typeof module === "object") module.exports = timeline;
  else root.SEEENSyncTimeline = timeline;
}(typeof window === "object" ? window : undefined));
