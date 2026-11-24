(function () {
  "use strict";

  var DESIGN_WIDTH = 667;
  var DESIGN_HEIGHT = 375;
  var CENTER_X = 200;
  var CENTER_Y = 210;
  var WIDE_RADIUS = 145;
  var NARROW_HALF = 98;
  var CENTER_RADIUS = 3.4;
  var WIDE_COUNT = 6500;
  var NARROW_COUNT = 9500;
  var GOLDEN_ANGLE = 2.39996323;
  var CLIP_X = 12;
  var CLIP_Y = 75;
  var CLIP_WIDTH = 376;
  var CLIP_HEIGHT = 287;
  var COLORS = {
    dark: "#EEEEEC",
    bright: "#101010"
  };

  function clamp(x) {
    return Math.max(0, Math.min(1, x));
  }

  function smooth(x) {
    x = clamp(x);
    return x * x * (3 - 2 * x);
  }

  function g(x, s) {
    return Math.exp(-x * x / (s * s));
  }

  function hash(i) {
    var value = Math.sin(i * 127.1 + 17.73) * 43758.5453;
    return value - Math.floor(value);
  }

  function makeWide(count) {
    var total = count || WIDE_COUNT;
    var points = new Array(total);
    var i;

    for (i = 0; i < total; i += 1) {
      var angle = i * GOLDEN_ANGLE;
      var radius = Math.sqrt((i + 0.5) / total);
      points[i] = {
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
        r: radius,
        j: hash(i)
      };
    }
    return points;
  }

  function wideAmplitude(point, time) {
    return (0.015 + 0.83 * Math.pow(0.5 + 0.5 * Math.cos(point.r * 13 - time * 3.5), 7)) *
      (1 - 0.77 * point.r * point.r) * (0.55 + 0.45 * point.j);
  }

  function wideDot(point, radius) {
    return 0.29 * Math.max(0.7, radius / 90) * (0.75 + 0.5 * point.j);
  }

  function makeNarrow(count) {
    var total = count || NARROW_COUNT;
    var points = new Array(total);
    var i;

    for (i = 0; i < total; i += 1) {
      var x = 2 * ((i * 0.754877666) % 1) - 1;
      var y = 2 * ((i * 0.569840291) % 1) - 1;
      points[i] = {
        x: x,
        y: y,
        r: Math.hypot(x, y),
        j: hash(i),
        d: [
          Math.hypot(x - 2, y),
          Math.hypot(x + 2, y),
          Math.hypot(x, y - 2),
          Math.hypot(x, y + 2)
        ]
      };
    }
    return points;
  }

  function narrowAmplitude(point, time) {
    var travel = (time * 0.66) % 3.1;
    var direct = g(point.r - travel, 0.06) * 0.9;
    var merged = 0;
    var blend = smooth((travel - 1.32) / 0.55);
    var i;

    for (i = 0; i < 4; i += 1) {
      var side = [point.x, -point.x, point.y, -point.y][i];
      var physical = g(point.d[i] - travel, 0.07) * smooth(side / 0.2) * 0.85;
      merged = Math.max(merged, physical);
    }

    var focus = Math.max(0, 2 - travel);
    var converge = g(point.r - focus, 0.075) * 0.78;
    var combined = Math.max(direct, merged);
    var value = (combined * (1 - blend) + converge * blend) *
      (1 - smooth((travel - 1.97) / 0.22));
    return (0.014 + 0.92 * Math.min(1, value)) * (0.65 + point.j * 0.35);
  }

  function narrowDot(point) {
    return 0.29 + 0.13 * point.j;
  }

  function now() {
    return window.performance && window.performance.now ? window.performance.now() : Date.now();
  }

  function ParticleField(canvas) {
    var started = now();
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.wide = makeWide(WIDE_COUNT);
    this.narrow = makeNarrow(NARROW_COUNT);
    this.mode = "wide";
    this.theme = "dark";
    this.time = 0;
    this.scale = 1;
    this.running = false;
    this.frame = 0;
    this.startedAt = 0;
    this.baseTime = 0;
    this.stats = {
      wideCount: this.wide.length,
      narrowCount: this.narrow.length,
      initializationMs: now() - started,
      lastRenderMs: 0,
      devicePixelRatio: 1
    };
    this.resize();
    this.canvas.dataset.wideCount = String(this.wide.length);
    this.canvas.dataset.narrowCount = String(this.narrow.length);
    this.canvas.dataset.initializationMs = this.stats.initializationMs.toFixed(3);
  }

  ParticleField.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var width = Math.round(DESIGN_WIDTH * dpr);
    var height = Math.round(DESIGN_HEIGHT * dpr);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
    this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.stats.devicePixelRatio = dpr;
  };

  ParticleField.prototype.setMode = function (mode) {
    if (mode !== "wide" && mode !== "narrow") {
      throw new Error("Particle Field mode must be wide or narrow");
    }
    this.mode = mode;
  };

  ParticleField.prototype.render = function (options) {
    var settings = options || {};
    var started = now();
    var mode = settings.mode || this.mode;
    var theme = settings.theme || this.theme;
    var time = Number.isFinite(settings.time) ? settings.time : this.time;
    var scale = Number.isFinite(settings.scale) ? settings.scale : this.scale;
    var narrow = mode === "narrow";
    var radius = narrow ? NARROW_HALF : WIDE_RADIUS;
    var points = narrow ? this.narrow : this.wide;
    var context = this.context;
    var i;

    this.setMode(mode);
    this.theme = theme === "bright" ? "bright" : "dark";
    this.time = time;
    this.scale = scale;
    this.resize();

    context.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    context.save();
    context.beginPath();
    context.rect(CLIP_X, CLIP_Y, CLIP_WIDTH, CLIP_HEIGHT);
    context.clip();
    context.fillStyle = COLORS[this.theme];

    if (scale > 0.001) {
      for (i = 0; i < points.length; i += 1) {
        var point = points[i];
        var amplitude = narrow ? narrowAmplitude(point, time) : wideAmplitude(point, time);
        context.globalAlpha = clamp(amplitude * scale);
        context.beginPath();
        context.arc(
          CENTER_X + point.x * radius * scale,
          CENTER_Y + point.y * radius * scale,
          narrow ? narrowDot(point) : wideDot(point, radius),
          0,
          Math.PI * 2
        );
        context.fill();
      }
    }

    context.globalAlpha = 1;
    context.beginPath();
    context.arc(CENTER_X, CENTER_Y, CENTER_RADIUS, 0, Math.PI * 2);
    context.fill();
    context.restore();
    this.stats.lastRenderMs = now() - started;
    this.canvas.dataset.mode = this.mode;
    this.canvas.dataset.theme = this.theme;
    this.canvas.dataset.time = String(this.time);
    this.canvas.dataset.devicePixelRatio = String(this.stats.devicePixelRatio);
    this.canvas.dataset.lastRenderMs = this.stats.lastRenderMs.toFixed(3);
    return this.stats.lastRenderMs;
  };

  ParticleField.prototype.start = function (options) {
    var self = this;
    var settings = options || {};

    this.stop();
    this.setMode(settings.mode || this.mode);
    if (settings.theme) {
      this.theme = settings.theme === "bright" ? "bright" : "dark";
    }
    this.baseTime = Number.isFinite(settings.time) ? settings.time : this.time;
    this.startedAt = now();
    this.running = true;

    function drawFrame(timestamp) {
      if (!self.running) return;
      self.render({
        mode: self.mode,
        theme: self.theme,
        time: self.baseTime + (timestamp - self.startedAt) / 1000,
        scale: self.scale
      });
      self.frame = requestAnimationFrame(drawFrame);
    }

    this.frame = requestAnimationFrame(drawFrame);
  };

  ParticleField.prototype.stop = function () {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
  };

  var canvas = document.getElementById("particle-field");
  if (!canvas) return;

  var renderer = new ParticleField(canvas);
  window.SEEENParticleField = {
    renderer: renderer,
    constants: {
      designWidth: DESIGN_WIDTH,
      designHeight: DESIGN_HEIGHT,
      centerX: CENTER_X,
      centerY: CENTER_Y,
      wideRadius: WIDE_RADIUS,
      narrowHalf: NARROW_HALF,
      centerRadius: CENTER_RADIUS,
      wideCount: WIDE_COUNT,
      narrowCount: NARROW_COUNT,
      goldenAngle: GOLDEN_ANGLE
    },
    formulas: {
      makeWide: makeWide,
      wideAmplitude: wideAmplitude,
      wideDot: wideDot,
      makeNarrow: makeNarrow,
      narrowAmplitude: narrowAmplitude,
      narrowDot: narrowDot
    }
  };

  function renderStaticPreview() {
    var parameters = new URLSearchParams(window.location.search);
    var mode = parameters.get("particle-preview");
    var theme = parameters.get("particle-theme") === "bright" ? "bright" : "dark";
    var requestedTime = Number(parameters.get("particle-time"));
    var time = Number.isFinite(requestedTime) ? requestedTime : 0;

    if (mode !== "wide" && mode !== "narrow") return;
    document.body.classList.add("particle-preview");
    document.body.classList.toggle("bright", theme === "bright");
    renderer.render({ mode: mode, theme: theme, time: time, scale: 1 });

    window.addEventListener("resize", function () {
      renderer.render({ mode: mode, theme: theme, time: time, scale: 1 });
    });
  }

  renderStaticPreview();
}());
