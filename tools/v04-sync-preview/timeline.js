(function (root) {
  "use strict";

  const lifetimes = {
    wide: (13 + Math.PI) / 3.5,
    narrow: (1.97 + .22) / .66
  };
  const narrowEnd = 1.97 + .22;
  const narrowDefaults = Object.freeze({
    diffusionMs: 380, returnMs: 1800, boundaryPercent: 70, decayPercent: 0
  });
  const softDefaults = Object.freeze({
    cushionMs: 60, compressionPercent: 5, speedDecayPercent: 55, startSpeedPercent: 100
  });

  function lifetime(mode, narrowProfile) {
    return mode === "narrow" && narrowProfile
      ? narrowProfile.diffusionMs / 1000 + reflectionSeconds(narrowProfile) : lifetimes[mode];
  }

  function reflectionSeconds(profile) {
    return profile.returnMs / 1000 / (startScale(profile) * (1 - speedDecay(profile) / 2));
  }

  function speedDecay(profile) {
    return (profile.speedDecayPercent || 0) / 100;
  }

  function startScale(profile) {
    return speedDecay(profile) ? (profile.startSpeedPercent ?? 100) / 100 : 1;
  }

  function wallSpeed(profile) {
    if (!profile) return .66;
    const outward = profile.diffusionMs / 1000;
    const inward = profile.returnMs / 1000;
    return 2 / (outward + inward / (narrowEnd - 1)) * startScale(profile);
  }

  function cushionCompression(age, profile) {
    if (!profile || !profile.cushionMs || !profile.compressionPercent) return 0;
    const u = (age * 1000 - profile.diffusionMs) / profile.cushionMs;
    if (u <= 0 || u >= 1) return 0;
    // Smooth compression and release, with zero slope at both ends.
    return (profile.compressionPercent / 100) * 16 * u * u * (1 - u) * (1 - u);
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
    if (age < outward) return segment(age / outward, 1, 1, wallRate * startScale(profile) * outward);
    const duration = reflectionSeconds(profile);
    if (age >= outward + duration) return narrowEnd;
    const q = (age - outward) / duration;
    // Integral of a clock that starts at startScale and then ramps down.
    // Normalizing the integral reaches the same phase without changing
    // the wall speed or forcing the return to fit its original duration.
    const decel = speedDecay(profile);
    const u = q * (1 - decel * q / 2) / (1 - decel / 2);
    return 1 + segment(u, remaining, wallRate * inward, remaining);
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

  function activeWaves(events, time, mode, narrowProfile, previousCycleDuration = 0) {
    const waves = [];
    const limit = lifetime(mode, narrowProfile);
    for (let i = upperBound(events, time) - 1; i >= 0; i--) {
      const age = time - events[i].time;
      if (age >= limit) break;
      waves.push({ id: events[i].id, age });
    }
    if (previousCycleDuration && time < limit) {
      for (let i = events.length - 1; i >= 0; i--) {
        const age = previousCycleDuration - events[i].time + time;
        if (age >= limit) break;
        if (age >= 0) waves.push({ id: events[i].id, age });
      }
    }
    return waves;
  }

  function adjustedEvents(events, globalMs, corrections) {
    return events.map((event, id) => ({
      id,
      time: (Math.round(event.time * 1000) + globalMs + (corrections.get(id) || 0)) / 1000
    })).sort((a, b) => a.time - b.time || a.id - b.id);
  }

  const timeline = { lifetimes, lifetime, narrowDefaults, softDefaults, narrowTravel,
    reflectionSeconds, wallSpeed, cushionCompression, upperBound, activeWaves, adjustedEvents };
  if (typeof module === "object") module.exports = timeline;
  else root.SEEENSyncTimeline = timeline;
}(typeof window === "object" ? window : undefined));
