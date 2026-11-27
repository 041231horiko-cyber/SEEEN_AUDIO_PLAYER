(function (root) {
  "use strict";

  const asset = "melody-data/step04-rms.json";
  const profile = Object.freeze({brightness: 30, brightnessMin: 20, brightnessMax: 40,
    wavelength: 80, speed: 150, balance: 50, smoothing: 400});
  const limits = [-41.1, -16.9];
  const mix = (a, b, t) => a + (b - a) * t;
  const mod = (n, size) => ((n % size) + size) % size;

  // Identical centered, circular RMS filter to the STEP 03.3 preview.
  function smooth(values, interval, milliseconds) {
    const radius = Math.round(milliseconds / (2000 * interval));
    const length = values.length;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += values[mod(k, length)];
    return values.map((_, index) => {
      const average = sum / (2 * radius + 1);
      sum += values[mod(index + radius + 1, length)] - values[mod(index - radius, length)];
      return average;
    });
  }

  function sampleRms(values, interval, time) {
    const frame = mod(time / interval, values.length);
    const index = Math.floor(frame);
    return mix(values[index], values[(index + 1) % values.length], frame - index);
  }

  function phaseFrame(rms, bright, elapsed) {
    const normalized = Math.max(0, Math.min(1, (rms - limits[0]) / (limits[1] - limits[0])));
    const brightness = mix(profile.brightnessMin, profile.brightnessMax, normalized);
    const phase = elapsed * (bright ? 1.8 : 0.85) * profile.speed / 100;
    return {
      f: (bright ? 38 : 15) * 100 / profile.wavelength,
      firstPhase: mod(phase, 2 * Math.PI),
      secondPhase: mod(phase * 0.62, 2 * Math.PI),
      firstMix: 0.5 * (1 - profile.balance / 100),
      secondMix: 0.5 * profile.balance / 100,
      brightness: brightness / 100
    };
  }

  function preparePoint(point, narrow) {
    point.melodyRadius = Math.hypot(point.x, point.y);
    point.melodyX = point.x * 3;
    point.melodyEnvelope = Math.max(0, 1 - (point.melodyRadius / (narrow ? 1.42 : 1.05)) ** 1.5);
  }

  function alpha(point, frame) {
    const radial = point.melodyRadius * frame.f;
    const s = 0.5 + frame.firstMix * Math.sin(radial - frame.firstPhase) +
      frame.secondMix * Math.sin(radial * 0.61 + point.melodyX + frame.secondPhase);
    const level = Math.max(0, s);
    const squared = level * level;
    return squared * squared * point.melodyEnvelope * frame.brightness;
  }

  function prepareData(data, baseUrl) {
    const {sampleInterval: interval, audioDuration: duration} = data;
    if (data.schemaVersion !== 1 || interval !== 0.05 || duration !== 124.7) {
      throw new Error("STEP 04 RMS schema mismatch");
    }
    const profiles = new Map();
    for (const theme of ["bright", "dark"]) {
      const series = data.rmsTenthsDbfs[theme];
      if (!Array.isArray(series) || series.length !== Math.round(duration / interval) ||
          !series.every(value => Number.isInteger(value) && value >= -1000 && value <= 0)) {
        throw new Error("STEP 04 RMS series mismatch");
      }
      profiles.set(theme, smooth(series.map(value => value / 10), interval, profile.smoothing));
    }
    const tracks = new Map();
    for (const [key, track] of Object.entries(data.tracks)) {
      if (track.profile !== key.split("-")[0] || !profiles.has(track.profile) ||
          !/^[a-f0-9]{64}$/.test(track.audioSha256)) throw new Error("STEP 04 audio mapping mismatch");
      tracks.set(key, {
        source: new URL("audio/" + track.audioFile, baseUrl).href,
        values: profiles.get(track.profile),
        bright: track.profile === "bright"
      });
    }
    return {tracks, duration, interval};
  }

  function createClock(fetchData, baseUrl) {
    let dataset, pending, key, source, lastTime, lastSample, lastFrame, cycles = 0;

    function preload() {
      if (!dataset && !pending) {
        pending = fetchData(asset).then(response => {
          if (!response.ok) throw new Error("RMS data HTTP " + response.status);
          return response.json();
        }).then(data => {
          dataset = prepareData(data, baseUrl);
        }).catch(error => console.warn("[SEEEN melody sync]", error)).finally(() => { pending = null; });
      }
      return pending;
    }

    function select(track, src) {
      key = track;
      source = new URL(src, baseUrl).href;
      lastTime = lastSample = lastFrame = undefined;
      cycles = 0;
      return preload();
    }

    function seek(audio) {
      // A native loop also seeks, but its target is the start of the source.
      if (audio.currentSrc === source && (audio.paused || audio.currentTime > 0)) lastTime = undefined;
    }

    function observe(audio) {
      const time = audio.currentTime;
      if (!dataset || audio.currentSrc !== source || audio.seeking || !Number.isFinite(time) || time < 0) return false;
      if (audio.loop && time < lastTime && lastTime >= dataset.duration - 2 && time < 2) cycles++;
      lastTime = time;
      return true;
    }

    // For the player's explicit restart after an ended event. A native wrap is
    // detected in observe(), using the same boundary as the knock clock.
    function restartLoop(audio) {
      if (!dataset || audio.currentSrc !== source) return;
      cycles++;
      lastTime = lastSample = lastFrame = undefined;
    }

    function sample(audio) {
      if (audio.paused || !observe(audio)) return null;
      const track = dataset.tracks.get(key);
      if (!track || track.source !== source) return null;
      const time = audio.currentTime;
      const elapsed = cycles * dataset.duration + time;
      if (elapsed !== lastSample) {
        lastSample = elapsed;
        lastFrame = phaseFrame(sampleRms(track.values, dataset.interval, time), track.bright, elapsed);
      }
      return lastFrame;
    }

    return {select, preload, seek, observe, restartLoop, sample};
  }

  const api = {asset, profile, sampleRms, phaseFrame, preparePoint, alpha, prepareData, createClock};
  if (typeof module === "object") module.exports = api;
  else root.SEEENMelodySync = api;
}(typeof window === "object" ? window : undefined));
