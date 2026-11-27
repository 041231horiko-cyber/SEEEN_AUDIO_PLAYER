(function (root) {
  "use strict";

  const inBrowser = typeof window === "object";
  const model = inBrowser ? root.MelodyPreview : require("./melody.js").MelodyPreview;
  const base = inBrowser ? root.Step021Particles : require("./step021-particles.js").Step021Particles;
  const knock = inBrowser ? root.SEEENKnockSync : require("./knock-sync.js");
  const VIEW_WIDTH = base.CLIP_WIDTH;

  function createRenderer(canvas) {
    const ctx = canvas.getContext("2d");
    const fields = {
      wide: base.makeWide(base.WIDE_COUNT),
      narrow: base.makeNarrow(base.NARROW_COUNT)
    };
    const reflection = base.reflectionGeometry(fields.narrow);

    for (const mode of Object.keys(fields)) {
      const narrow = mode === "narrow";
      const radius = narrow ? base.NARROW_HALF : base.WIDE_RADIUS;
      for (const point of fields[mode]) {
        point.melodyRadius = Math.hypot(point.x, point.y);
        point.melodyX = point.x * 3;
        point.melodyEnvelope = Math.max(0, 1 - (point.melodyRadius / (narrow ? 1.42 : 1.05)) ** 1.5);
        point.drawX = base.CENTER_X - base.CLIP_X + point.x * radius;
        point.drawY = base.CENTER_Y - base.CLIP_Y + point.y * radius;
        point.drawRadius = narrow ? point.dot : base.wideDot(point, radius);
        point.behindCenter = narrow && point.coveredUntilScale >= 1;
      }
    }

    return function render({mode, theme, melodyFrame, ages}) {
      const waveFrames = ages.map(age => base.prepareWave(age, mode));
      const reflect = mode === "narrow" ? reflection : null;
      const points = fields[mode];
      ctx.clearRect(0, 0, VIEW_WIDTH, base.CLIP_HEIGHT);
      ctx.fillStyle = base.COLORS[theme];
      if (melodyFrame || waveFrames.length) {
        for (let i = 0; i < points.length; i++) {
          const point = points[i];
          if (point.behindCenter) continue;
          const melodyAlpha = melodyFrame ? model.alpha(point, melodyFrame) : 0;
          const knockAlpha = waveFrames.length ? base.synchronizedAmplitude(point, reflect && reflect[i], waveFrames) : 0;
          const finalAlpha = Math.max(melodyAlpha, knockAlpha);
          if (finalAlpha <= 0) continue;
          ctx.globalAlpha = finalAlpha;
          ctx.beginPath();
          ctx.arc(point.drawX, point.drawY, point.drawRadius, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
      ctx.beginPath();
      ctx.arc(base.CENTER_X - base.CLIP_X, base.CENTER_Y - base.CLIP_Y, base.CENTER_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    };
  }

  if (!inBrowser) {
    module.exports = {createRenderer};
    return;
  }

  const $ = id => document.getElementById(id);
  const audio = $("audio");
  const seek = $("seek");
  const play = $("play");
  const track = $("track");
  const canvas = $("field");
  const settings = {...model.defaults};
  const loaded = new Map();
  const inputs = Array.from(document.querySelectorAll("[data-setting]"));
  const durationLabel = $("duration");
  const timeLabel = $("time");
  const status = $("status");
  const ctx = canvas.getContext("2d");
  const render = createRenderer(canvas);
  let current, generation = 0, lastFrameTime, dirty = true, raf = null, lastReadout = -Infinity;

  function formatTime(time) {
    const centiseconds = Math.round(time * 100);
    return Math.floor(centiseconds / 6000) + ":" + ((centiseconds % 6000) / 100).toFixed(2).padStart(5, "0");
  }

  function resize() {
    const ratio = window.devicePixelRatio || 1;
    canvas.width = Math.round(VIEW_WIDTH * ratio);
    canvas.height = Math.round(base.CLIP_HEIGHT * ratio);
    ctx.setTransform(canvas.width / VIEW_WIDTH, 0, 0, canvas.height / base.CLIP_HEIGHT, 0, 0);
    refresh();
  }

  async function selectTrack() {
    const token = ++generation;
    const key = track.value;
    const [theme, mode] = key.split("-");
    current = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    play.disabled = seek.disabled = $("save").disabled = true;
    seek.value = 0;
    timeLabel.textContent = formatTime(0);
    durationLabel.textContent = "–";
    document.documentElement.dataset.theme = theme;
    status.textContent = "解析データを読み込み中";
    refresh();
    try {
      let data = loaded.get(key);
      if (!data) {
        const response = await fetch("analysis/" + key + ".json");
        if (!response.ok) throw Error("HTTP " + response.status);
        data = await response.json();
        loaded.set(key, data);
      }
      if (token !== generation) return;
      const duration = data.audioDuration;
      const timeline = model.createTimeline(duration);
      const times = knock.renderedEventTimes(data.knockEvents.map(hit => hit.time), mode, duration);
      const extracted = model.extractFeatures(data);
      const smooth = model.prepareFeatures(data, settings.smoothing, extracted);
      current = {data, theme, mode, timeline, times, extracted, smooth};
      audio.src = "audio/" + data.audioFile;
      seek.max = duration;
      play.disabled = seek.disabled = $("save").disabled = false;
      durationLabel.textContent = formatTime(duration);
      status.textContent = "再生できます";
      refresh();
    } catch (error) {
      if (token === generation) status.textContent = "読み込みに失敗しました。ZIPを展開し、HTTPで開いてください。";
    }
  }

  function report(features, effective, state, time, count) {
    $("current-rms").textContent = features.rms.toFixed(1) + " dBFS";
    $("current-centroid").textContent = Math.round(features.centroid) + " Hz";
    $("current-bands").textContent = features.bandRatio.toFixed(1) + " dB";
    $("current-light").textContent = effective.brightness.toFixed(1) + "%";
    $("current-wave").textContent = effective.wavelength.toFixed(1) + "%";
    $("current-balance").textContent = effective.balance.toFixed(1) + " : " + (100 - effective.balance).toFixed(1);
    $("current-speed").textContent = effective.speed.toFixed(0) + "%";
    $("current-knocks").textContent = String(count);
    $("particle-count").textContent = (state.mode === "wide" ? base.WIDE_COUNT : base.NARROW_COUNT).toLocaleString("ja");
    timeLabel.textContent = formatTime(time);
    seek.value = time;
  }

  function renderFrame(stamp) {
    raf = null;
    const time = audio.currentTime;
    if (!current) {
      ctx.clearRect(0, 0, VIEW_WIDTH, base.CLIP_HEIGHT);
    } else if (!audio.seeking && (dirty || time !== lastFrameTime)) {
      const {data, theme, mode, timeline, times, smooth} = current;
      const clock = timeline.sample(time);
      const features = model.sampleFeatures(smooth, data.sampleInterval, time);
      const effective = model.parameters($("preset").value, settings, features);
      const layer = $("layers").value;
      const melodyFrame = layer === "knock" ? null : model.phaseFrame(effective, theme === "bright", clock.elapsed);
      const ages = knock.waveAges(times, time, mode, clock.previousCycle);
      render({mode, theme, melodyFrame, ages: layer === "melody" ? [] : ages});
      if (dirty || stamp - lastReadout >= 100) {
        report(features, effective, current, time, layer === "melody" ? 0 : ages.length);
        lastReadout = stamp;
      }
      lastFrameTime = time;
    }
    dirty = false;
    if (!audio.paused) schedule();
  }

  function schedule() {
    if (raf === null) raf = requestAnimationFrame(renderFrame);
  }

  function refresh() {
    dirty = true;
    schedule();
  }

  function syncInputs() {
    for (const input of inputs) {
      const key = input.dataset.setting;
      input.value = settings[key];
      input.nextElementSibling.value = settings[key] + (key === "smoothing" ? " ms" : "%");
    }
  }

  for (const input of inputs) {
    input.addEventListener("input", () => {
      const key = input.dataset.setting;
      settings[key] = Number(input.value);
      if (key.endsWith("Min")) {
        const other = key.slice(0, -3) + "Max";
        settings[other] = Math.max(settings[key], settings[other]);
      }
      if (key.endsWith("Max")) {
        const other = key.slice(0, -3) + "Min";
        settings[other] = Math.min(settings[key], settings[other]);
      }
      if (key === "smoothing" && current) {
        current.smooth = model.prepareFeatures(current.data, settings.smoothing, current.extracted);
      }
      syncInputs();
      refresh();
    });
  }

  play.addEventListener("click", async () => {
    if (!audio.paused) return audio.pause();
    const starting = current;
    try {
      await audio.play();
    } catch (error) {
      if (current === starting && error.name !== "AbortError") status.textContent = "再生できませんでした";
    }
  });

  for (const event of ["play", "pause", "seeked", "loadedmetadata", "timeupdate"]) {
    audio.addEventListener(event, () => {
      play.textContent = audio.paused ? "再生" : "一時停止";
      // RAF may be suspended in a background tab while native audio loops.
      if (event === "timeupdate" && current && document.hidden && !audio.seeking) {
        current.timeline.sample(audio.currentTime);
      }
      if (event !== "timeupdate" || audio.paused) refresh();
    });
  }
  audio.addEventListener("error", () => {
    if (current) status.textContent = "音源を読み込めませんでした";
  });
  seek.addEventListener("input", () => {
    if (!current) return;
    current.timeline.seek();
    audio.currentTime = Math.min(Number(seek.value), Number.isFinite(audio.duration) ? audio.duration : current.data.audioDuration);
    refresh();
  });
  track.addEventListener("change", selectTrack);
  $("preset").addEventListener("change", refresh);
  $("layers").addEventListener("change", refresh);
  $("reset").addEventListener("click", () => {
    Object.assign(settings, model.defaults);
    $("preset").value = "BASE";
    $("layers").value = "both";
    if (current) current.smooth = model.prepareFeatures(current.data, settings.smoothing, current.extracted);
    syncInputs();
    refresh();
  });
  $("save").addEventListener("click", () => {
    if (!current) return;
    const {data, smooth} = current;
    const time = audio.currentTime;
    const mode = $("preset").value;
    const features = model.sampleFeatures(smooth, data.sampleInterval, time);
    const review = {schemaVersion: 1, step: "03.3", design: "02 — Interference",
      track: data.trackId, audioSha256: data.audioSha256, currentTime: time, mode, layers: $("layers").value,
      settings: {...settings}, features, effective: model.parameters(mode, settings, features)};
    const url = URL.createObjectURL(new Blob([JSON.stringify(review, null, 2) + "\n"], {type: "application/json"}));
    const link = document.createElement("a");
    link.href = url;
    link.download = "seeen-melody-review-" + data.trackId + ".json";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  window.addEventListener("resize", resize);
  syncInputs();
  resize();
  selectTrack();
}(typeof window === "object" ? window : module.exports));
