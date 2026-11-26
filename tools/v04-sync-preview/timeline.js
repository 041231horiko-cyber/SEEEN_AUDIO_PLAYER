(function (root) {
  "use strict";

  const lifetimes = {
    wide: (13 + Math.PI) / 3.5,
    narrow: (1.97 + .22) / .66
  };

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

  function activeWaves(events, time, mode) {
    const waves = [];
    for (let i = upperBound(events, time) - 1; i >= 0; i--) {
      const age = time - events[i].time;
      if (age >= lifetimes[mode]) break;
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

  const timeline = { lifetimes, upperBound, activeWaves, adjustedEvents };
  if (typeof module === "object") module.exports = timeline;
  else root.SEEENSyncTimeline = timeline;
}(typeof window === "object" ? window : undefined));
