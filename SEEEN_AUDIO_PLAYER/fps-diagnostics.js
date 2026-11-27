(function () {
  "use strict";

  var variant = new URLSearchParams(window.location.search).get("fps");
  if (variant !== "1" && variant !== "baseline") return;
  if (variant === "baseline") window.SEEENUseReferenceRenderer = true;

  function installPanel() {
    var panel = document.createElement("details");
    panel.style.cssText = "position:fixed;z-index:1000;top:calc(env(safe-area-inset-top) + 4px);right:calc(env(safe-area-inset-right) + 4px);max-width:90vw;max-height:90vh;overflow:auto;background:#151515;color:#fff;padding:6px;font:12px monospace";
    var summary = document.createElement("summary");
    summary.textContent = "FPS — loading";
    panel.appendChild(summary);
    document.body.appendChild(panel);

    var data = Object.create(null);
    var capacity = 2048;
    var previousTime = null;
    var previousKey = "";
    var latestTrack = "", latestPhase, latestWaves;
    var timedStates = {playing: "playing", emitting: "start", collapsing: "stop", resetting: "switch"};
    var output = document.createElement("textarea");
    output.setAttribute("aria-label", "FPS measurement report");
    output.readOnly = true;
    output.rows = 8;
    output.style.cssText = "display:block;width:min(74vw,450px);font:inherit";
    var copy = document.createElement("button");
    copy.textContent = "Copy report";
    var reset = document.createElement("button");
    reset.textContent = "Reset";
    var versions = variant === "baseline" ? "STEP 06.2 (6d95111)" : "STEP 07.1";

    function resetInterval() {
      previousTime = null;
      previousKey = "";
    }

    function summarize(values, n) {
      if (!n) return "n/a";
      var sorted = values.slice(0, n).sort();
      var sum = 0, slow33 = 0, slow50 = 0;
      for (var i = 0; i < n; i += 1) {
        sum += sorted[i];
        if (sorted[i] > 33.3) slow33 += 1;
        if (sorted[i] > 50) slow50 += 1;
      }
      return {
        average: (sum / n).toFixed(2),
        median: ((sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2).toFixed(2),
        p95: sorted[Math.ceil(n * .95) - 1].toFixed(2),
        max: sorted[n - 1].toFixed(2),
        fps: sum > 0 ? (1000 * n / sum).toFixed(1) : "n/a",
        slow33: (100 * slow33 / n).toFixed(1),
        slow50: (100 * slow50 / n).toFixed(1)
      };
    }

    function refresh() {
      var label = "FPS " + versions + (latestTrack ?
        " · " + latestTrack + " · " + latestPhase + " · waves " + latestWaves : " · ready");
      if (summary.textContent !== label) summary.textContent = label;
      if (!panel.open) return;
      var lines = ["SEEEN " + versions, navigator.userAgent,
        "DPR " + devicePixelRatio + " · window " + innerWidth + "×" + innerHeight,
        "Visible rendered frames, last " + capacity + " samples per group",
        ""];
      Object.keys(data).sort().forEach(function (key) {
        var group = data[key];
        var intervals = summarize(group.intervals, Math.min(group.intervalCount, capacity));
        var draw = summarize(group.draw, Math.min(group.drawCount, capacity));
        lines.push(key + " · frames " + group.drawCount + " · peak waves " + group.peakWaves);
        if (intervals !== "n/a") {
          lines.push("  " + intervals.fps + " FPS · frame interval med/p95/max " + intervals.median + "/" +
            intervals.p95 + "/" + intervals.max + " ms · >33.3ms " + intervals.slow33 + "% · >50ms " + intervals.slow50 + "%");
        }
        lines.push("  render avg/med/p95/max " + draw.average + "/" + draw.median + "/" + draw.p95 + "/" + draw.max + " ms");
      });
      // Do not interrupt manual text selection on Safari.
      if (document.activeElement !== output) output.value = lines.join("\n");
    }

    function attach() {
      var renderer = window.SEEENParticleField.renderer;
      var render = renderer.render;
      renderer.render = function (settings) {
        var phase = timedStates[this.motionState];
        if (document.visibilityState !== "visible" || !phase) {
          resetInterval();
          return render.apply(this, arguments);
        }
        var start = performance.now();
        var result = render.apply(this, arguments);
        var elapsed = performance.now() - start;
        var track = this.theme + "-" + this.mode;
        var waves = settings && settings.waveAges ? settings.waveAges.length : 0;
        var key = track + " / " + phase + (phase === "playing" ? " / waves " + waves : "");
        var group = data[key];
        if (!group) {
          group = data[key] = {intervals: new Float64Array(capacity), draw: new Float64Array(capacity),
            intervalCount: 0, drawCount: 0, peakWaves: 0};
        }
        // Attribute the interval to the current wave count, but do not span
        // an operation boundary or a hidden/background interval.
        var sequence = track + " / " + phase;
        if (previousTime !== null && sequence === previousKey) {
          group.intervals[group.intervalCount % capacity] = start - previousTime;
          group.intervalCount += 1;
        }
        previousTime = start;
        previousKey = sequence;
        group.draw[group.drawCount % capacity] = elapsed;
        group.drawCount += 1;
        group.peakWaves = Math.max(group.peakWaves, waves);
        latestTrack = track;
        latestPhase = phase;
        latestWaves = waves;
        return result;
      };

      panel.appendChild(copy);
      panel.appendChild(reset);
      panel.appendChild(output);
      document.addEventListener("visibilitychange", resetInterval);
      window.addEventListener("pagehide", resetInterval);
      window.addEventListener("pageshow", resetInterval);
      panel.addEventListener("toggle", refresh);
      reset.addEventListener("click", function () {
        data = Object.create(null);
        latestTrack = "";
        output.blur();
        resetInterval();
        refresh();
      });
      copy.addEventListener("click", function () {
        output.blur();
        refresh();
        function selectReport() {
          output.focus();
          output.select();
          output.setSelectionRange(0, output.value.length);
          if (document.execCommand && document.execCommand("copy")) output.blur();
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(output.value).catch(selectReport);
        } else selectReport();
      });
      // The panel does not run its own animation loop or sort per frame.
      window.setInterval(function () {
        if (document.visibilityState === "visible") refresh();
      }, 1500);
      refresh();
    }

    if (variant === "baseline") {
      var script = document.createElement("script");
      script.src = "./fps-reference.js";
      script.onload = attach;
      script.onerror = function () { summary.textContent = "FPS — reference failed to load"; };
      document.head.appendChild(script);
    } else attach();
  }

  document.addEventListener("DOMContentLoaded", installPanel);
}());
