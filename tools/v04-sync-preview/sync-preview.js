(function () {
  "use strict";

  const byId = id => document.getElementById(id);
  const audio = byId("audio");
  const canvas = byId("particle-field");
  const seek = byId("seek");
  const select = byId("track");
  const play = byId("play");
  const renderer = window.SEEENParticleField.renderer;
  const timeline = window.SEEENSyncTimeline;
  const reviews = new Map();
  const names = ["play", "seek", "previous", "next", "offset", "correction", "verdict", "missing", "export", "notes"];
  const verdictNames = {ok: "一致", "false-positive": "誤検出", timing: "時刻ずれ", "echo-review": "反響要確認"};
  const three = seconds => seconds.toFixed(3);
  const boundMs = value => Math.min(500, Math.max(-500, Math.round(Number(value) || 0)));
  let source;
  let review;
  let mode = "wide";
  let theme = "bright";
  let selected = -1;
  let events = [];
  let rows = [];
  let adjusted = new Map();
  let controller;
  let blobUrl;
  let frame = 0;
  let snapshot;
  let activeRows = [];
  let lastReport = 0;
  let lookupTotal = 0;
  let renderTotal = 0;
  let samples = 0;
  let renderedSamples = 0;

  function enabled(value) {
    for (const name of names) byId(name).disabled = !value;
  }

  function stopClock() {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  }

  function refreshClock() {
    if (!frame && source && !audio.paused && !document.hidden) frame = requestAnimationFrame(tick);
  }

  function tick() {
    frame = 0;
    if (!audio.seeking) draw(false);
    refreshClock();
  }

  function mark(time, cssClass, title) {
    const node = document.createElement("i");
    node.className = cssClass;
    node.style.left = (100 * time / source.audioDuration) + "%";
    node.title = title;
    byId("marks").append(node);
  }

  function rebuildTimeline() {
    events = timeline.adjustedEvents(source.knockEvents, review.offset, review.corrections);
    adjusted = new Map(events.map(event => [event.id, event.time]));
    byId("marks").replaceChildren();
    for (const [id, hit] of source.knockEvents.entries()) {
      const time = adjusted.get(id);
      mark(time, "", "直接音 " + three(time) + " 秒");
      for (const echo of hit.echoes) mark(echo.time, "echo", "反響候補 " + three(echo.time) + " 秒");
      rows[id].time.textContent = three(time);
      rows[id].verdict.textContent = verdictNames[review.verdicts.get(id)] || "未確認";
    }
    showSelection();
    draw(true);
  }

  function jump(time) {
    if (!source) return;
    audio.currentTime = Math.min(source.audioDuration, Math.max(0, time));
    draw(true);
  }

  function selectEvent(id, listenAt) {
    selected = id;
    showSelection();
    rows[id].row.scrollIntoView({block: "nearest"});
    if (listenAt !== undefined) jump(listenAt - .25);
  }

  function showSelection() {
    rows.forEach(({row}, id) => row.classList.toggle("selected", id === selected));
    byId("selection").textContent = selected < 0 ? "候補を選択" : "候補 " + (selected + 1);
    byId("correction").disabled = selected < 0;
    byId("verdict").disabled = selected < 0;
    byId("correction").value = review.corrections.get(selected) || 0;
    byId("verdict").value = review.verdicts.get(selected) || "";
    byId("previous").disabled = selected === 0;
    byId("next").disabled = selected === rows.length - 1;
  }

  function timeButton(text, action) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = text;
    button.onclick = action;
    return button;
  }

  function buildRows() {
    const body = byId("events");
    body.replaceChildren();
    rows = source.knockEvents.map((hit, id) => {
      const row = body.insertRow();
      row.insertCell().textContent = id + 1;
      row.insertCell().append(timeButton(three(hit.time), () => selectEvent(id, hit.time)));
      const time = row.insertCell();
      const echoCell = row.insertCell();
      for (const echo of hit.echoes) {
        echoCell.append(timeButton(three(echo.time) + " / +" + Math.round(echo.delay * 1000) + " ms",
          () => selectEvent(id, echo.time)));
      }
      if (!hit.echoes.length) echoCell.textContent = "—";
      return {row, time, verdict: row.insertCell()};
    });
  }

  function refreshNotes() {
    byId("notes").value = review.notes;
    byId("missing-list").textContent = review.missing.length ?
      "検出漏れ候補 (秒) · " + review.missing.map(three).join(" / ") : "";
  }

  function releaseSource() {
    stopClock();
    source = null;
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = null;
    selected = -1;
    snapshot = null;
    activeRows = [];
    rows = [];
    enabled(false);
    byId("events").replaceChildren();
    byId("marks").replaceChildren();
    byId("selection").textContent = "候補を選択";
    byId("missing-list").textContent = "";
    byId("notes").value = "";
    byId("performance").textContent = "";
    play.textContent = "再生";
    lookupTotal = renderTotal = samples = renderedSamples = 0;
    lastReport = performance.now();
    draw(true);
  }

  async function load() {
    if (controller) controller.abort();
    const task = new AbortController();
    controller = task;
    const trackId = select.value;
    [theme, mode] = trackId.split("-");
    byId("screen").dataset.theme = theme;
    releaseSource();
    byId("status").textContent = "音源と解析データをSHA-256で照合中";
    try {
      if (!window.crypto || !window.crypto.subtle) throw new Error("ZIPを展開し、READMEのlocalhost手順で開いてください。");
      const response = await fetch("analysis/" + trackId + ".json", {signal: task.signal});
      if (!response.ok) throw new Error("解析JSONを読み込めません。");
      const data = await response.json();
      const audioName = trackId.replace("-", "_") + "_loop_125s_test.m4a";
      if (data.schemaVersion !== 1 || data.trackId !== trackId || data.knockEvents.length !== 35 ||
        data.audioFile !== audioName || data.audioDuration !== 124.7) throw new Error("STEP 01の解析データと一致しません。");
      const media = await fetch("audio/" + audioName, {signal: task.signal});
      if (!media.ok) throw new Error("音源を読み込めません。");
      const bytes = await media.arrayBuffer();
      const digest = await crypto.subtle.digest("SHA-256", bytes);
      const sha = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
      if (sha !== data.audioSha256) throw new Error("音源のSHA-256が一致しません。");
      if (task.signal.aborted) return;
      source = data;
      if (!reviews.has(trackId)) reviews.set(trackId, {
        sha, offset: 0, corrections: new Map(), verdicts: new Map(), missing: [], notes: ""
      });
      review = reviews.get(trackId);
      byId("offset").value = review.offset;
      audio.loop = byId("loop").checked;
      blobUrl = URL.createObjectURL(new Blob([bytes], {type: "audio/mp4"}));
      audio.src = blobUrl;
      buildRows();
      refreshNotes();
      enabled(true);
      rebuildTimeline();
      byId("status").textContent = "SHA-256一致 · 直接ノック候補 35件";
    } catch (error) {
      if (!task.signal.aborted) byId("status").textContent = error.message;
    }
  }

  function draw(force) {
    const t = source ? audio.currentTime : 0;
    if (!force && snapshot === t) return;
    snapshot = t;
    const started = performance.now();
    const waves = source ? timeline.activeWaves(events, t, mode) : [];
    lookupTotal += performance.now() - started;
    samples++;
    if (force || waves.length || activeRows.length) {
      renderTotal += renderer.render({mode, theme, scale: waves.length ? 1 : 0,
        time: waves.length ? waves[0].age : 0, waveAges: waves.map(wave => wave.age)});
      renderedSamples++;
    }
    canvas.dataset.eventIds = waves.map(wave => wave.id + 1).join(",");
    canvas.dataset.playhead = String(t);
    for (const id of activeRows) rows[id].row.classList.remove("active");
    activeRows = waves.map(wave => wave.id);
    for (const id of activeRows) rows[id].row.classList.add("active");
    seek.value = t;
    byId("time").textContent = three(t) + " / " + three(source ? source.audioDuration : 124.7) + " 秒";
    byId("wave").textContent = waves.length
      ? waves.map(wave => "候補 " + (wave.id + 1) + " · 経過 " + three(wave.age) + " 秒").join(" / ")
      : "発生中の波なし";
    const now = performance.now();
    if (now - lastReport > 750 && source) {
      byId("performance").textContent = "探索 " + (lookupTotal / samples).toFixed(3) +
        " ms/更新 · Canvas " + (renderTotal / Math.max(1, renderedSamples)).toFixed(2) + " ms/描画";
      lastReport = now;
      lookupTotal = renderTotal = samples = renderedSamples = 0;
    }
  }

  select.onchange = load;
  play.onclick = async () => {
    if (!source) return;
    const track = source;
    if (!audio.paused) audio.pause();
    else {
      try { await audio.play(); }
      catch (error) { if (source === track) byId("status").textContent = "再生できません · " + error.message; }
    }
  };
  byId("loop").onchange = event => { audio.loop = event.target.checked; };
  seek.oninput = () => jump(Number(seek.value));
  byId("previous").onclick = () => {
    const id = selected < 0 ? timeline.upperBound(events, audio.currentTime) - 1 : selected - 1;
    const target = selected < 0 ? events[id]?.id : id;
    if (target !== undefined && target >= 0) selectEvent(target, source.knockEvents[target].time);
  };
  byId("next").onclick = () => {
    const id = selected < 0 ? events[timeline.upperBound(events, audio.currentTime)]?.id : selected + 1;
    if (id !== undefined && id < rows.length) selectEvent(id, source.knockEvents[id].time);
  };
  byId("offset").onchange = event => {
    review.offset = boundMs(event.target.value);
    event.target.value = review.offset;
    rebuildTimeline();
  };
  byId("correction").onchange = event => {
    const value = boundMs(event.target.value);
    if (value) review.corrections.set(selected, value);
    else review.corrections.delete(selected);
    rebuildTimeline();
  };
  byId("verdict").onchange = event => {
    if (event.target.value) review.verdicts.set(selected, event.target.value);
    else review.verdicts.delete(selected);
    rebuildTimeline();
  };
  byId("notes").oninput = event => { review.notes = event.target.value; };
  byId("missing").onclick = () => {
    const time = Number(three(audio.currentTime));
    if (!review.missing.includes(time)) review.missing.push(time);
    refreshNotes();
  };
  byId("export").onclick = () => {
    const results = [...reviews].map(([trackId, item]) => ({
      trackId, audioSha256: item.sha, offsetMs: item.offset,
      corrections: [...item.corrections].map(([id, ms]) => ({candidate: id + 1, ms})),
      verdicts: [...item.verdicts].map(([id, verdict]) => ({candidate: id + 1, verdict})),
      missingTimes: item.missing, notes: item.notes
    }));
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([JSON.stringify({schemaVersion: 1, results}, null, 2)],
      {type: "application/json"}));
    link.download = "SEEEN_V04_sync_review.json";
    link.click();
    setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  };

  audio.addEventListener("playing", () => {
    if (!source) return;
    play.textContent = "一時停止";
    byId("status").textContent = "再生中 · SHA-256照合済み";
    refreshClock();
  });
  audio.addEventListener("waiting", () => {
    if (source && !audio.paused) byId("status").textContent = "バッファリング中";
  });
  for (const type of ["pause", "ended"]) audio.addEventListener(type, () => {
    stopClock();
    play.textContent = "再生";
    if (source && audio.paused) {
      byId("status").textContent = type === "ended" ? "再生終了" : "一時停止中";
      draw(false);
    }
  });
  audio.addEventListener("seeked", () => { if (source) draw(true); });
  audio.addEventListener("error", () => {
    if (source && audio.error) byId("status").textContent = "音源を再生できません · " + audio.error.message;
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopClock();
    else { draw(true); refreshClock(); }
  });
  window.addEventListener("resize", () => draw(true));
  load();
}());
