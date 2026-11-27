(function (root) {
  "use strict";

  const defaults = Object.freeze({
    brightness: 30, wavelength: 80, speed: 150, balance: 50,
    brightnessMin: 20, brightnessMax: 40,
    wavelengthMin: 65, wavelengthMax: 95,
    balanceMin: 35, balanceMax: 65, smoothing: 400
  });

  // Shared across themes, from the pooled STEP 01 p5/p95 (rounded).
  const limits = Object.freeze({rms: [-41.1, -16.9], centroid: [134, 1645], bandRatio: [-67.2, 12.3]});
  const clamp = (n, min, max) => Math.max(min, Math.min(n, max));
  const mix = (a, b, t) => a + (b - a) * t;
  const mod = (n, size) => ((n % size) + size) % size;

  function fillGaps(values) {
    const valid = values.map((v, i) => Number.isFinite(v) ? i : -1).filter(i => i >= 0);
    if (!valid.length) throw Error("持続音の有効なデータがありません");
    let right = 0;
    return values.map((v, index) => {
      if (Number.isFinite(v)) return v;
      while (right < valid.length && valid[right] < index) right++;
      const a = right ? valid[right - 1] : valid[valid.length - 1] - values.length;
      const b = right < valid.length ? valid[right] : valid[0] + values.length;
      return mix(values[mod(a, values.length)], values[mod(b, values.length)], (index - a) / (b - a));
    });
  }

  function extractFeatures(data) {
    const melody = data.melodyFeatures;
    const bands = melody.bandEnergyDbfs.map(band => band.map(db => 10 ** (db / 10)));
    const bandRatio = melody.centroidHz.map((hz, i) => {
      if (!Number.isFinite(hz)) return null;
      let low = 0, high = 0;
      melody.bandEdgesHz.forEach(([lower], band) => {
        if (lower < 750) low += bands[band][i];
        else high += bands[band][i];
      });
      return 10 * Math.log10(high / low);
    });
    return {
      rms: melody.rmsDbfs,
      centroid: fillGaps(melody.centroidHz),
      bandRatio: fillGaps(bandRatio)
    };
  }

  // A centered, circular box filter. Recomputed only when smoothing changes.
  function smooth(values, interval, milliseconds) {
    const radius = Math.round(milliseconds / (2000 * interval));
    if (!radius) return values;
    const length = values.length;
    let sum = 0;
    for (let k = -radius; k <= radius; k++) sum += values[mod(k, length)];
    return values.map((_, index) => {
      const average = sum / (2 * radius + 1);
      sum += values[mod(index + radius + 1, length)] - values[mod(index - radius, length)];
      return average;
    });
  }

  function prepareFeatures(data, milliseconds, extracted = extractFeatures(data)) {
    return Object.fromEntries(Object.entries(extracted).map(([key, values]) =>
      [key, smooth(values, data.sampleInterval, milliseconds)]));
  }

  function sampleFeatures(prepared, interval, time) {
    const length = prepared.rms.length;
    const frame = mod(time / interval, length);
    const index = Math.floor(frame);
    const next = (index + 1) % length;
    const frac = frame - index;
    return {
      rms: mix(prepared.rms[index], prepared.rms[next], frac),
      centroid: mix(prepared.centroid[index], prepared.centroid[next], frac),
      bandRatio: mix(prepared.bandRatio[index], prepared.bandRatio[next], frac)
    };
  }

  function normalize(value, [lo, hi], logarithmic = false) {
    if (logarithmic) return clamp(Math.log(value / lo) / Math.log(hi / lo), 0, 1);
    return clamp((value - lo) / (hi - lo), 0, 1);
  }

  function parameters(mode, settings, features) {
    const useAmplitude = mode === "AMPLITUDE" || mode === "COMBINED";
    const useFrequency = mode === "FREQUENCY" || mode === "COMBINED";
    return {
      brightness: useAmplitude ? mix(settings.brightnessMin, settings.brightnessMax,
        normalize(features.rms, limits.rms)) : settings.brightness,
      wavelength: useFrequency ? mix(settings.wavelengthMax, settings.wavelengthMin,
        normalize(features.centroid, limits.centroid, true)) : settings.wavelength,
      balance: mode === "COMBINED" ? mix(settings.balanceMin, settings.balanceMax,
        normalize(features.bandRatio, limits.bandRatio)) : settings.balance,
      speed: settings.speed
    };
  }

  function phaseFrame(effective, bright, elapsed) {
    const phase = elapsed * (bright ? 1.8 : 0.85) * effective.speed / 100;
    return {
      f: (bright ? 38 : 15) * 100 / effective.wavelength,
      // The two terms have different rates, so wrap each angle independently.
      firstPhase: mod(phase, 2 * Math.PI),
      secondPhase: mod(phase * 0.62, 2 * Math.PI),
      firstMix: 0.5 * (1 - effective.balance / 100),
      secondMix: 0.5 * effective.balance / 100,
      brightness: effective.brightness / 100
    };
  }

  function alpha(point, frame) {
    const radial = point.melodyRadius * frame.f;
    const s = 0.5 + frame.firstMix * Math.sin(radial - frame.firstPhase) +
      frame.secondMix * Math.sin(radial * 0.61 + point.melodyX + frame.secondPhase);
    const level = Math.max(0, s);
    const squared = level * level;
    return squared * squared * point.melodyEnvelope * frame.brightness;
  }

  function createTimeline(duration) {
    let lastTime, cycles = 0, hasTail = false;
    return {
      seek() { lastTime = undefined; hasTail = false; },
      sample(time) {
        // The only manual seek control calls seek() before changing currentTime.
        if (lastTime !== undefined && time < lastTime) {
          cycles++;
          hasTail = true;
        }
        lastTime = time;
        return {elapsed: time + cycles * duration, previousCycle: hasTail ? duration : 0};
      }
    };
  }

  root.MelodyPreview = {defaults, limits, extractFeatures, prepareFeatures, sampleFeatures,
    parameters, phaseFrame, alpha, createTimeline};
}(typeof window === "object" ? window : module.exports));
