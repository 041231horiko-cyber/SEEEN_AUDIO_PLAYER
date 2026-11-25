// Attribute-driven visual prototype. The audio player owns playback.
(function () {
  "use strict";
  if (document.body.classList.contains("particle-preview")) return;
  var state = document.getElementById("playback-state");
  var rings = document.getElementById("rings");
  var layers = [];
  var reduced = matchMedia("(prefers-reduced-motion: reduce)");
  var elapsed = 0, last = 0, frame = 0, track = "";
  for (var i = 0; i < 12; i++) {
    var circle = document.createElementNS(rings.namespaceURI, "circle");
    circle.setAttribute("fill", "none");
    circle.setAttribute("stroke", "currentColor");
    rings.appendChild(circle);
    layers.push(circle);
  }
  // Two emissions per phrase; the follower has 850 ms to travel before impact.
  var narrowDelays = [0, 650, 2500, 3150];
  var wideWaveCount = 8;
  var wideTravelMs = 9500 / 1.2;
  var wideOffsets = [0, .025, -.018, .012, -.022, .018, -.014, .008];
  var media = document.getElementById("audio-player");
  var dot = rings.nextElementSibling;
  var fadeStart = 1;
  function cueFrame() {
    var progress = media.duration > 0 && Number.isFinite(media.duration) ? media.currentTime / media.duration : 0;
    rings.style.opacity = fadeStart * Math.max(0, 1 - 2 * progress);
    dot.style.opacity = progress >= .5 ? 1 : .45;
    if (!document.hidden) frame = requestAnimationFrame(cueFrame);
  }
  // On a concentric circle every point samples the same radial gradient stop.
  function falloff(x, stops) {
    for (var k = 1; k < stops.length; k++) {
      if (x <= stops[k][0]) {
        var a = stops[k - 1], b = stops[k];
        return a[1] + (b[1] - a[1]) * (x - a[0]) / (b[0] - a[0]);
      }
    }
    return stops[stops.length - 1][1];
  }
  var wideStops = [[0,1],[.42,.93],[.72,.52],[.9,.12],[1,0]];
  var echoStops = [[0,0],[.25,.12],[.65,.58],[1,1]];
  function draw() {
    var narrow = track.indexOf("narrow") >= 0;
    layers.forEach(function (circle, i) {
      var radius, opacity, echo = false;
      if (narrow) {
        // Each pulse has two SVG nodes. Its echo starts only at impact.
        var period = 5000;
        var pulse = Math.floor(i / 2);
        var age = pulse < narrowDelays.length ? (elapsed - narrowDelays[pulse]) % period : -1;
        echo = i % 2 === 1;
        var travel = echo ? (age - 1500) / 1900 : age / 1500;
        var visible = travel >= 0 && travel < 1;
        radius = visible ? 3 + 58 * (echo ? 1 - travel : travel) : 0;
        opacity = visible ? (echo ? .58 * (1 - travel * .44) : (.92 - .32 * travel) * Math.min(1, travel * 18)) : 0;
      } else {
        // A delayed layer stays at the center until its first emission.
        var phase = i < wideWaveCount ? Math.max(0, elapsed / wideTravelMs - (i + wideOffsets[i]) / wideWaveCount) % 1 : 0;
        radius = 128.7 * phase;
        opacity = .98 * (1 - phase) * (1 - .2 * phase) * Math.min(1, phase * 45);
      }
      if (echo && opacity > 0) {
        // Dim the return stroke where it crosses an incident stroke.
        for (var j = 0; j < narrowDelays.length; j++) {
          var incidentAge = (elapsed - narrowDelays[j]) % 5000;
          if (incidentAge >= 0 && incidentAge < 1500) {
            var separation = Math.abs(radius - (3 + 58 * incidentAge / 1500));
            opacity *= .35 + .65 * Math.min(1, separation / 1.5);
          }
        }
      }
      if (!narrow) opacity *= falloff(radius / 128.7, wideStops);
      else if (echo) opacity *= falloff(radius / 61, echoStops);
      circle.setAttribute("r", radius.toFixed(2));
      circle.setAttribute("stroke-opacity", opacity.toFixed(3));
      circle.setAttribute("stroke-width", echo ? ".34" : ".53");
    });
  }
  function tick(time) {
    if (!last) last = time;
    if (time-last >= 32) { elapsed += time-last; last = time; draw(); }
    frame = requestAnimationFrame(tick);
  }
  function sync() {
    var selected = document.querySelector('[data-track][aria-pressed="true"]');
    var next = selected ? selected.dataset.track : "";
    cancelAnimationFrame(frame);
    if (next) {
      rings.style.opacity = 1;
      dot.style.opacity = 1;
      elapsed = 0;
      last = 0;
      track = next;
      return;
    }
    if (state.dataset.state === "counting") {
      if (!document.hidden) frame = requestAnimationFrame(cueFrame);
      return;
    }
    rings.style.opacity = 1;
    dot.style.opacity = 1;
    if (next !== track || !track) {
      elapsed = 0;
      track = next;
      var narrow = track.indexOf("narrow") >= 0;
      document.getElementById("wave-frame").classList.toggle("wide", !narrow);
    }

    last = 0;
    if (reduced.matches && track && !elapsed) elapsed = 2300;
    draw();
    if (!document.hidden && !reduced.matches && state.dataset.state === "playing") {
      frame = requestAnimationFrame(tick);
    }
  }
  var observer = new MutationObserver(sync);
  observer.observe(state, { attributes:true, attributeFilter:["data-state"] });
  observer.observe(document.querySelector(".selector"), {subtree:true, attributes:true, attributeFilter:["aria-pressed"]});
  document.addEventListener("fieldselection", function () {
    fadeStart = rings.style.opacity === "" ? 1 : Number(rings.style.opacity);
    elapsed = 0;
    sync();
  });
  reduced.addListener(sync);
  document.addEventListener("visibilitychange",sync);
  sync();
}());
