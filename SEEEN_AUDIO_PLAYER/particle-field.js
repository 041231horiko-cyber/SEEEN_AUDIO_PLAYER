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
  // Ease only the WIDE knock wave's spatial expansion. Its audio-clock age,
  // lifetime and opacity envelope remain linear and unchanged.
  var WIDE_EXPANSION_EASING_STRENGTH = 0.5;
  var STOP_MS = 420;
  // Adopted Reset emission phase: 32% of 900 ms.
  var EMISSION_MS = 288;
  var RESET_MS = 900;
  // Keep a completed Reset moving through short source/decode gaps, but do not
  // let the visual run indefinitely when playback cannot begin.
  var POST_RESET_PLAYBACK_GRACE_MS = 1200;
  var GOLDEN_ANGLE = 2.39996323;
  var CLIP_X = 12;
  var CLIP_Y = 75;
  var CLIP_WIDTH = 376;
  var CLIP_HEIGHT = 287;
  // Below this scale every particle is hidden beneath the opaque center point,
  // including a one-pixel antialiasing margin. Skip invisible overdraw.
  var PARTICLE_COVERED_SCALE = 0.012;
  var OCCLUSION_EPSILON = 0.01;
  var NARROW_FIELD_COVERED_SCALE =
    (CENTER_RADIUS - 0.42 - OCCLUSION_EPSILON) / (NARROW_HALF * Math.SQRT2);
  var COLORS = {
    dark: "#EEEEEC",
    bright: "#101010"
  };
  var PALETTES = {
    dark: {
      background: "#080808",
      panel: "#1B1B1B",
      inactive: "#303030",
      primary: "#EEEEEC",
      muted: "#AAAAAA",
      yes: "#65C98A",
      no: "#E66B6B"
    },
    bright: {
      background: "#F2F2F0",
      panel: "#E3E3E1",
      inactive: "#D1D1CF",
      primary: "#101010",
      muted: "#666666",
      yes: "#238548",
      no: "#C43C3C"
    }
  };
  var PALETTE_KEYS = ["background", "panel", "inactive", "primary", "muted", "yes", "no"];
  var knock = window.SEEENKnockSync;
  var melody = window.SEEENMelodySync;
  var EMPTY_WAVES = Object.freeze([]);

  function clamp(x) {
    return Math.max(0, Math.min(1, x));
  }

  function smooth(x) {
    x = clamp(x);
    return x * x * (3 - 2 * x);
  }

  function resetPhase(q) {
    q = clamp(q);
    return {
      scale: q < 0.32 ? 1 - smooth(q / 0.32) : q < 0.68 ? 0 : smooth((q - 0.68) / 0.32),
      blend: smooth((q - 0.32) / 0.36),
      newState: q >= 0.5,
      emit: q >= 0.68
    };
  }

  function colorChannels(color) {
    var value;
    var matches;
    if (color.charAt(0) === "#") {
      value = parseInt(color.slice(1), 16);
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }
    matches = color.match(/[\d.]+/g);
    return matches ? [Number(matches[0]), Number(matches[1]), Number(matches[2])] : [0, 0, 0];
  }

  function mix(a, b, amount) {
    var from = colorChannels(a);
    var to = colorChannels(b);
    return "rgb(" + from.map(function (channel, index) {
      return Math.round(channel * (1 - amount) + to[index] * amount);
    }).join(",") + ")";
  }

  function mixPalette(from, to, amount) {
    var palette = {};
    PALETTE_KEYS.forEach(function (key) {
      palette[key] = mix(from[key], to[key], amount);
    });
    return palette;
  }

  function createPaletteMixer(from, to) {
    var mixer = { palette: {} };
    PALETTE_KEYS.forEach(function (key) {
      mixer[key] = {
        from: colorChannels(from[key]),
        to: colorChannels(to[key])
      };
    });
    return mixer;
  }

  function mixPreparedPalette(mixer, amount) {
    var inverse = 1 - amount;
    PALETTE_KEYS.forEach(function (key) {
      var channels = mixer[key];
      mixer.palette[key] = "rgb(" +
        Math.round(channels.from[0] * inverse + channels.to[0] * amount) + "," +
        Math.round(channels.from[1] * inverse + channels.to[1] * amount) + "," +
        Math.round(channels.from[2] * inverse + channels.to[2] * amount) + ")";
    });
    return mixer.palette;
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
        j: hash(i),
        phase: radius * 13,
        edge: 1 - 0.77 * radius * radius
      };
      points[i].shade = 0.55 + 0.45 * points[i].j;
      points[i].dot = 0.75 + 0.5 * points[i].j;
    }
    return points;
  }

  function wideAmplitudePrepared(point, timePhase) {
    return (0.015 + 0.83 * Math.pow(0.5 + 0.5 * Math.cos(point.phase - timePhase), 7)) *
      point.edge * point.shade;
  }

  function wideAmplitude(point, time) {
    return (0.015 + 0.83 * Math.pow(0.5 + 0.5 * Math.cos(point.r * 13 - time * 3.5), 7)) *
      (1 - 0.77 * point.r * point.r) * (0.55 + 0.45 * point.j);
  }

  function singleWideAmplitude(point, timePhase) {
    var phase = point.phase - timePhase;
    var pulse = Math.abs(phase) < Math.PI ?
      0.83 * Math.pow(0.5 + 0.5 * Math.cos(phase), 7) : 0;
    return (0.015 + pulse) * point.edge * point.shade;
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
        ],
        wall0: smooth(x / 0.2),
        wall1: smooth(-x / 0.2),
        wall2: smooth(y / 0.2),
        wall3: smooth(-y / 0.2)
      };
      points[i].gain = 0.65 + points[i].j * 0.35;
      points[i].dot = 0.29 + 0.13 * points[i].j;
      points[i].coveredUntilScale = points[i].r > 0 ?
        (CENTER_RADIUS - points[i].dot - OCCLUSION_EPSILON) / (NARROW_HALF * points[i].r) :
        Infinity;
    }
    return points;
  }

  function narrowAmplitudePrepared(point, travel, blend, focus, fade, reflectionGain, compression) {
    var direct = g(point.r - travel, 0.06) * 0.9;
    var press = compression > 0 && point.cushion;
    var merged = Math.max(0, g(point.d[0] - travel, press ? 0.07 * (1 - compression * press[0]) : 0.07) * point.wall0 * 0.85);
    merged = Math.max(merged, g(point.d[1] - travel, press ? 0.07 * (1 - compression * press[1]) : 0.07) * point.wall1 * 0.85);
    merged = Math.max(merged, g(point.d[2] - travel, press ? 0.07 * (1 - compression * press[2]) : 0.07) * point.wall2 * 0.85);
    merged = Math.max(merged, g(point.d[3] - travel, press ? 0.07 * (1 - compression * press[3]) : 0.07) * point.wall3 * 0.85);
    var converge = g(point.r - focus, 0.075) * 0.78;
    var gain = reflectionGain === undefined ? 1 : reflectionGain;
    var combined = Math.max(direct, merged * gain);
    var value = (combined * (1 - blend) + converge * gain * blend) * fade;
    return (0.014 + 0.92 * Math.min(1, value)) * point.gain;
  }

  function narrowAmplitude(point, time) {
    var travel = (time * 0.66) % 3.1;
    var direct = g(point.r - travel, 0.06) * 0.9;
    var merged = Math.max(0, g(point.d[0] - travel, 0.07) * smooth(point.x / 0.2) * 0.85);
    merged = Math.max(merged, g(point.d[1] - travel, 0.07) * smooth(-point.x / 0.2) * 0.85);
    merged = Math.max(merged, g(point.d[2] - travel, 0.07) * smooth(point.y / 0.2) * 0.85);
    merged = Math.max(merged, g(point.d[3] - travel, 0.07) * smooth(-point.y / 0.2) * 0.85);
    var blend = smooth((travel - 1.32) / 0.55);
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

  // Keep the fixed draw coordinates and sizes. Only distances used by the
  // reflection formula are remapped to the approved boundary once.
  function reflectionGeometry(points) {
    var ratio = knock.narrow.boundaryPercent / 100;
    return points.map(function (point) {
      var x = point.x / ratio;
      var y = point.y / ratio;
      var outside = Math.max(Math.abs(x), Math.abs(y));
      return {
        r: Math.hypot(x, y),
        d: [Math.hypot(x - 2, y), Math.hypot(x + 2, y), Math.hypot(x, y - 2), Math.hypot(x, y + 2)],
        wall0: smooth(x / 0.2),
        wall1: smooth(-x / 0.2),
        wall2: smooth(y / 0.2),
        wall3: smooth(-y / 0.2),
        cushion: outside <= 1 ? [
          smooth((x - 0.82) / 0.18), smooth((-x - 0.82) / 0.18),
          smooth((y - 0.82) / 0.18), smooth((-y - 0.82) / 0.18)
        ] : null,
        boundaryMask: 1 - smooth((outside - 1) / 0.08),
        gain: point.gain
      };
    });
  }

  function prepareWave(age, mode) {
    if (mode === "wide") return wideExpansionPhase(age, WIDE_EXPANSION_EASING_STRENGTH);
    var travel = knock.narrowTravel(age);
    return [
      travel, smooth((travel - 1.32) / 0.55), Math.max(0, 2 - travel),
      1 - smooth((travel - 1.97) / 0.22),
      1 - (knock.narrow.decayPercent / 100) * smooth((travel - 1) / 1.19),
      knock.cushionCompression(age)
    ];
  }

  function wideExpansionPhase(age, strength) {
    var amount = Math.max(0, Math.min(1, strength));
    if (amount === 0) return age * 3.5;
    var maxPhase = 13 + Math.PI;
    var duration = maxPhase / 3.5;
    var p = Math.max(0, Math.min(1, age / duration));
    var linear = p;
    var eased = linear + amount * (1 - Math.pow(1 - p, 3) - linear);
    return maxPhase * eased;
  }

  function synchronizedAmplitude(point, sampled, waves) {
    var amplitude = 0;
    var floor = sampled ? 0.014 * point.gain : 0;
    for (var i = 0; i < waves.length; i += 1) {
      var wave = waves[i];
      var level;
      if (!sampled) {
        level = singleWideAmplitude(point, wave);
      } else if (sampled.boundaryMask === 0) {
        level = floor * wave[3];
      } else {
        level = narrowAmplitudePrepared(sampled, wave[0], wave[1], wave[2], wave[3], wave[4], wave[5]);
        level = floor * wave[3] + (level - floor) * sampled.boundaryMask;
      }
      amplitude = Math.max(amplitude, level);
    }
    return amplitude;
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
    this.wide.forEach(function (point) { melody.preparePoint(point, false); });
    this.narrow.forEach(function (point) { melody.preparePoint(point, true); });
    this.reflection = reflectionGeometry(this.narrow);
    this.lastRender = null;
    this.mode = "wide";
    this.theme = "dark";
    this.palette = PALETTES.dark;
    this.lightBlend = 0;
    this.color = COLORS.dark;
    this.time = 0;
    this.scale = 1;
    this.running = false;
    this.motionState = "point";
    this.resetVisualTrack = "";
    this.renderDpr = 0;
    this.frame = 0;
    this.lastFrameAt = 0;
    this.stats = {
      wideCount: this.wide.length,
      narrowCount: this.narrow.length,
      initializationMs: now() - started,
      lastRenderMs: 0,
      devicePixelRatio: 1,
      loopStarts: 0,
      loopFrames: 0
    };
    this.resize();
    this.canvas.dataset.wideCount = String(this.wide.length);
    this.canvas.dataset.narrowCount = String(this.narrow.length);
    this.canvas.dataset.initializationMs = this.stats.initializationMs.toFixed(3);
    this.canvas.dataset.running = "false";
    this.canvas.dataset.motionState = this.motionState;
    this.canvas.dataset.loopStarts = "0";
    this.canvas.dataset.loopFrames = "0";
  }

  ParticleField.prototype.resize = function () {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var width = Math.round(DESIGN_WIDTH * dpr);
    var height = Math.round(DESIGN_HEIGHT * dpr);

    if (this.canvas.width !== width || this.canvas.height !== height || this.renderDpr !== dpr) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.context.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.renderDpr = dpr;
    }
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
    var color = settings.color;
    var time = Number.isFinite(settings.time) ? settings.time : this.time;
    var scale = Number.isFinite(settings.scale) ? settings.scale : this.scale;
    var narrow = mode === "narrow";
    var radius = narrow ? NARROW_HALF : WIDE_RADIUS;
    var points = narrow ? this.narrow : this.wide;
    var context = this.context;
    var wideTimePhase;
    var wideDotScale;
    var narrowTravel;
    var narrowBlend;
    var narrowFocus;
    var narrowFade;
    var coveredScale;
    var waveAges = settings.waveAges;
    var melodyFrame = settings.melodyFrame;
    var waves = waveAges && waveAges.map(function (age) { return prepareWave(age, mode); });
    var fieldOpacity = settings.fieldOpacity === undefined ? 1 : settings.fieldOpacity;
    var i;

    if (narrow) {
      narrowTravel = (time * 0.66) % 3.1;
      narrowBlend = smooth((narrowTravel - 1.32) / 0.55);
      narrowFocus = Math.max(0, 2 - narrowTravel);
      narrowFade = 1 - smooth((narrowTravel - 1.97) / 0.22);
    } else {
      wideTimePhase = time * 3.5;
      wideDotScale = 0.29 * Math.max(0.7, radius / 90);
    }

    this.setMode(mode);
    this.theme = theme === "bright" ? "bright" : "dark";
    this.color = color || COLORS[this.theme];
    this.time = time;
    this.scale = scale;
    this.lastRender = {mode: mode, theme: theme, color: this.color, time: time, scale: scale,
      waveAges: waveAges, melodyFrame: melodyFrame, fieldOpacity: fieldOpacity};
    this.resize();

    context.clearRect(0, 0, DESIGN_WIDTH, DESIGN_HEIGHT);
    context.save();
    context.beginPath();
    context.rect(CLIP_X, CLIP_Y, CLIP_WIDTH, CLIP_HEIGHT);
    context.clip();
    context.fillStyle = this.color;

    coveredScale = narrow ? NARROW_FIELD_COVERED_SCALE : PARTICLE_COVERED_SCALE;
    if (scale > coveredScale && fieldOpacity > 0 && (melodyFrame || !waves || waves.length)) {
      for (i = 0; i < points.length; i += 1) {
        var point = points[i];
        if (narrow && scale <= point.coveredUntilScale) continue;
        var amplitude = waves ? synchronizedAmplitude(point, narrow ? this.reflection[i] : null, waves) : narrow ? narrowAmplitudePrepared(
          point, narrowTravel, narrowBlend, narrowFocus, narrowFade
        ) : wideAmplitudePrepared(point, wideTimePhase);
        if (melodyFrame) amplitude = Math.max(amplitude, melody.alpha(point, melodyFrame));
        context.globalAlpha = clamp(amplitude * scale * fieldOpacity);
        context.beginPath();
        context.arc(
          CENTER_X + point.x * radius * scale,
          CENTER_Y + point.y * radius * scale,
          narrow ? point.dot : wideDotScale * point.dot,
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
    this.canvas.dataset.scale = String(this.scale);
    this.canvas.dataset.devicePixelRatio = String(this.stats.devicePixelRatio);
    this.canvas.dataset.lastRenderMs = this.stats.lastRenderMs.toFixed(3);
    return this.stats.lastRenderMs;
  };

  ParticleField.prototype.start = function (options) {
    var self = this;
    var settings = options || {};

    if (this.running) return false;
    this.setMode(settings.mode || this.mode);
    if (settings.theme) {
      this.theme = settings.theme === "bright" ? "bright" : "dark";
    }
    this.time = Number.isFinite(settings.time) ? settings.time : this.time;
    this.scale = Number.isFinite(settings.scale) ? settings.scale : this.scale;
    this.running = true;
    this.motionState = "playing";
    this.stats.loopStarts += 1;
    this.canvas.dataset.running = "true";
    this.canvas.dataset.motionState = this.motionState;
    this.canvas.dataset.loopStarts = String(this.stats.loopStarts);

    var media = document.getElementById("audio-player");
    function drawFrame() {
      if (!self.running) return;
      self.frame = requestAnimationFrame(drawFrame);
      if (media.seeking) return;
      var ages = knock.clock.sample(media);
      var melodyFrame = melody.clock.sample(media);
      // Hold through a media stall or while waiting for the selected source.
      if ((ages !== null || melodyFrame) && (!self.lastRender || self.lastRender.waveAges !== (ages || EMPTY_WAVES) ||
          self.lastRender.melodyFrame !== melodyFrame || self.lastRender.scale !== 1 || self.lastRender.fieldOpacity !== 1)) {
        self.stats.loopFrames += 1;
        self.canvas.dataset.loopFrames = String(self.stats.loopFrames);
        self.render({mode: self.mode, theme: self.theme, time: media.currentTime, scale: 1,
          waveAges: ages || EMPTY_WAVES, melodyFrame: melodyFrame});
      }
    }

    this.frame = requestAnimationFrame(drawFrame);
    return true;
  };

  ParticleField.prototype.stop = function () {
    this.running = false;
    cancelAnimationFrame(this.frame);
    this.frame = 0;
    this.lastFrameAt = 0;
    this.canvas.dataset.running = "false";
  };

  function applyThemePalette(palette, lightBlend) {
    var body = document.body;
    PALETTE_KEYS.forEach(function (key) {
      body.style.setProperty("--" + key, palette[key]);
    });
    body.style.setProperty("--ios-bright-opacity", String(lightBlend));
  }

  function finishTheme(theme) {
    var body = document.body;
    body.classList.toggle("bright", theme === "bright");
    body.classList.remove("resetting", "theme-changing");
    PALETTE_KEYS.forEach(function (key) {
      body.style.removeProperty("--" + key);
    });
    body.style.removeProperty("--ios-bright-opacity");
  }

  function setResetVisualTrack(track) {
    var selected = document.querySelector('[data-track="' + track + '"]');
    var nowPlaying = document.getElementById("now-playing");
    Array.prototype.forEach.call(document.querySelectorAll("[data-track]"), function (button) {
      button.classList.toggle("reset-visual-selected", button === selected);
    });
    if (selected && nowPlaying) {
      nowPlaying.value = selected.textContent;
      nowPlaying.textContent = selected.textContent;
    }
  }

  function clearResetVisualTrack() {
    Array.prototype.forEach.call(document.querySelectorAll("[data-track]"), function (button) {
      button.classList.remove("reset-visual-selected");
    });
  }

  function applyImmediateTheme(theme) {
    finishTheme(theme);
  }

  ParticleField.prototype.showPoint = function (options) {
    var settings = options || {};
    this.stop();
    this.time = Number.isFinite(settings.time) ? settings.time : this.time;
    this.render({
      mode: settings.mode || this.mode,
      theme: settings.theme || this.theme,
      time: this.time,
      scale: 0
    });
    this.motionState = "point";
    this.canvas.dataset.motionState = this.motionState;
  };

  ParticleField.prototype.emitFromPoint = function (options) {
    var self = this;
    var settings = options || {};
    var duration = Number.isFinite(settings.duration) ? settings.duration : EMISSION_MS;
    var startScale = Number.isFinite(settings.startScale) ? settings.startScale : 0;
    var startedAt = now();

    this.stop();
    this.setMode(settings.mode || this.mode);
    if (settings.theme) {
      this.theme = settings.theme === "bright" ? "bright" : "dark";
    }
    this.time = 0;
    this.scale = startScale;
    this.running = true;
    this.motionState = "emitting";
    this.stats.loopStarts += 1;
    this.canvas.dataset.running = "true";
    this.canvas.dataset.motionState = this.motionState;
    this.canvas.dataset.transitionDuration = String(duration);
    this.canvas.dataset.loopStarts = String(this.stats.loopStarts);

    function drawEmissionFrame(timestamp) {
      var progress;
      if (!self.running || self.motionState !== "emitting") return;
      progress = clamp((timestamp - startedAt) / duration);
      self.scale = startScale + (1 - startScale) * smooth(progress);
      self.time = progress * duration * 0.001;
      self.stats.loopFrames += 1;
      self.canvas.dataset.loopFrames = String(self.stats.loopFrames);
      self.render({
        mode: self.mode,
        theme: self.theme,
        time: self.time,
        scale: self.scale,
        // The operation flare returns to the point before the real knock stream.
        fieldOpacity: 1 - smooth((progress - .68) / .32)
      });

      if (progress >= 1) {
        self.running = false;
        self.frame = 0;
        self.lastFrameAt = 0;
        self.start({
          mode: self.mode,
          theme: self.theme,
          time: self.time,
          scale: 1,
          lastFrameAt: timestamp
        });
        return;
      }
      self.frame = requestAnimationFrame(drawEmissionFrame);
    }

    this.frame = requestAnimationFrame(drawEmissionFrame);
  };

  ParticleField.prototype.resetToTrack = function (options) {
    var self = this;
    var settings = options || {};
    var duration = Number.isFinite(settings.duration) ? settings.duration : RESET_MS;
    var fromMode = settings.fromMode || this.mode;
    var toMode = settings.toMode || this.mode;
    var fromTheme = settings.fromTheme === "bright" ? "bright" : "dark";
    var toTheme = settings.toTheme === "bright" ? "bright" : "dark";
    var fromPalette = settings.fromPalette || this.palette || PALETTES[fromTheme];
    var toPalette = PALETTES[toTheme];
    var fromLightBlend = Number.isFinite(settings.fromLightBlend) ? settings.fromLightBlend : this.lightBlend;
    var toLightBlend = toTheme === "bright" ? 1 : 0;
    var fromScale = Number.isFinite(settings.scale) ? settings.scale : this.scale;
    var oldTime = Number.isFinite(settings.time) ? settings.time : this.time;
    var outgoing = this.lastRender;
    var fromTrack = settings.fromTrack || this.resetVisualTrack;
    var toTrack = settings.toTrack || fromTrack;
    var themeChanges = Math.abs(fromLightBlend - toLightBlend) > 0.0001;
    var paletteMixer = themeChanges ? createPaletteMixer(fromPalette, toPalette) : null;
    var startedAt = 0;
    var showingNewState = false;

    this.stop();
    this.running = true;
    this.motionState = "resetting";
    this.resetVisualTrack = fromTrack;
    this.stats.loopStarts += 1;
    this.canvas.dataset.running = "true";
    this.canvas.dataset.motionState = this.motionState;
    this.canvas.dataset.transitionDuration = String(duration);
    this.canvas.dataset.loopStarts = String(this.stats.loopStarts);
    document.body.classList.add("resetting");
    document.body.classList.remove("theme-changing");
    setResetVisualTrack(fromTrack);
    if (themeChanges) applyThemePalette(fromPalette, fromLightBlend);
    startedAt = now();

    function getResetElapsed(timestamp) {
      return Math.max(timestamp - startedAt, 0);
    }

    function drawResetFrame(timestamp) {
      var elapsed;
      var progress;
      var phase;
      var mode;
      var theme;
      var scale;
      var renderTime;
      var palette;
      var lightBlend;
      var playbackActive;

      if (!self.running || self.motionState !== "resetting") return;
      elapsed = getResetElapsed(timestamp);
      progress = clamp(elapsed / duration);
      phase = resetPhase(progress);
      mode = phase.newState ? toMode : fromMode;
      theme = phase.newState ? toTheme : fromTheme;
      scale = progress < 0.32 ? fromScale * (1 - smooth(progress / 0.32)) : phase.scale;
      renderTime = phase.emit ? (progress - 0.68) * duration * 0.001 : oldTime + elapsed * 0.001;
      palette = themeChanges ? mixPreparedPalette(paletteMixer, phase.blend) : toPalette;
      lightBlend = fromLightBlend * (1 - phase.blend) + toLightBlend * phase.blend;
      playbackActive = !settings.isPlaybackActive || settings.isPlaybackActive();
      if (phase.emit && !playbackActive) scale = 0;

      if (phase.newState !== showingNewState) {
        showingNewState = phase.newState;
        self.resetVisualTrack = showingNewState ? toTrack : fromTrack;
        setResetVisualTrack(self.resetVisualTrack);
        document.body.classList.toggle("bright", showingNewState ? toTheme === "bright" : fromTheme === "bright");
      }

      self.palette = palette;
      self.lightBlend = lightBlend;
      if (themeChanges) applyThemePalette(palette, lightBlend);
      self.stats.loopFrames += 1;
      self.canvas.dataset.loopFrames = String(self.stats.loopFrames);
      self.render({
        mode: mode,
        theme: theme,
        color: palette.primary,
        time: renderTime,
        scale: scale,
        waveAges: progress < .32 && outgoing ? outgoing.waveAges : undefined,
        fieldOpacity: phase.emit ? 1 - smooth((progress - .90) / .10) :
          progress < .32 && outgoing ? outgoing.fieldOpacity : 1
      });

      if (progress >= 1) {
        self.running = false;
        self.frame = 0;
        self.lastFrameAt = 0;
        self.mode = toMode;
        self.theme = toTheme;
        self.palette = toPalette;
        self.lightBlend = toLightBlend;
        self.time = 0.32 * duration * 0.001;
        self.scale = 1;
        self.resetVisualTrack = toTrack;
        setResetVisualTrack(toTrack);
        finishTheme(toTheme);
        clearResetVisualTrack();
        if (settings.isPlaying && settings.isPlaying()) {
          self.start({ mode: toMode, theme: toTheme, time: self.time, scale: 1, lastFrameAt: timestamp });
        } else if (settings.isPlaybackActive && settings.isPlaybackActive()) {
          self.start({ mode: toMode, theme: toTheme, time: self.time, scale: 1, lastFrameAt: timestamp });
          if (settings.onAwaitingPlayback) settings.onAwaitingPlayback();
        } else {
          self.showPoint({ mode: toMode, theme: toTheme, time: self.time });
        }
        return;
      }
      self.frame = requestAnimationFrame(drawResetFrame);
    }

    this.frame = requestAnimationFrame(drawResetFrame);
  };

  ParticleField.prototype.collapseToPoint = function (options) {
    var self = this;
    var settings = options || {};
    var duration = Number.isFinite(settings.duration) ? settings.duration : STOP_MS;
    var fixedTime = Number.isFinite(settings.time) ? settings.time : this.time;
    var startScale = Number.isFinite(settings.scale) ? settings.scale : this.scale;
    var outgoing = this.lastRender;
    var startedAt = now();

    this.stop();
    this.setMode(settings.mode || this.mode);
    if (settings.theme) {
      this.theme = settings.theme === "bright" ? "bright" : "dark";
    }
    this.time = fixedTime;
    this.scale = startScale;
    this.running = true;
    this.motionState = "collapsing";
    this.stats.loopStarts += 1;
    this.canvas.dataset.running = "true";
    this.canvas.dataset.motionState = this.motionState;
    this.canvas.dataset.transitionDuration = String(duration);
    this.canvas.dataset.loopStarts = String(this.stats.loopStarts);

    function drawCollapseFrame(timestamp) {
      var progress;
      if (!self.running || self.motionState !== "collapsing") return;
      progress = clamp((timestamp - startedAt) / duration);
      self.scale = startScale * (1 - smooth(progress));
      self.stats.loopFrames += 1;
      self.canvas.dataset.loopFrames = String(self.stats.loopFrames);
      self.render({
        mode: self.mode,
        theme: self.theme,
        time: fixedTime,
        scale: self.scale,
        waveAges: outgoing && outgoing.waveAges,
        melodyFrame: outgoing && outgoing.melodyFrame,
        fieldOpacity: outgoing ? outgoing.fieldOpacity : 1
      });

      if (progress >= 1) {
        self.running = false;
        self.frame = 0;
        self.lastFrameAt = 0;
        self.motionState = "point";
        self.canvas.dataset.running = "false";
        self.canvas.dataset.motionState = self.motionState;
        return;
      }
      self.frame = requestAnimationFrame(drawCollapseFrame);
    }

    this.frame = requestAnimationFrame(drawCollapseFrame);
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
      goldenAngle: GOLDEN_ANGLE,
      stopMs: STOP_MS,
      emissionMs: EMISSION_MS,
      resetMs: RESET_MS,
      postResetPlaybackGraceMs: POST_RESET_PLAYBACK_GRACE_MS,
      wideExpansionEasingStrength: WIDE_EXPANSION_EASING_STRENGTH
    },
    formulas: {
      makeWide: makeWide,
      wideAmplitude: wideAmplitude,
      wideDot: wideDot,
      makeNarrow: makeNarrow,
      narrowAmplitude: narrowAmplitude,
      narrowDot: narrowDot,
      resetPhase: resetPhase,
      wideExpansionPhase: wideExpansionPhase,
      mix: mix
    }
  };

  function renderStaticPreview() {
    var parameters = new URLSearchParams(window.location.search);
    var mode = parameters.get("particle-preview");
    var theme = parameters.get("particle-theme") === "bright" ? "bright" : "dark";
    var requestedTime = Number(parameters.get("particle-time"));
    var time = Number.isFinite(requestedTime) ? requestedTime : 0;

    if (mode !== "wide" && mode !== "narrow") return false;
    document.body.classList.add("particle-preview");
    document.body.classList.toggle("bright", theme === "bright");
    renderer.render({ mode: mode, theme: theme, time: time, scale: 1 });

    window.addEventListener("resize", function () {
      renderer.render({ mode: mode, theme: theme, time: time, scale: 1 });
    });
    return true;
  }

  function bindParticleMotion() {
    var state = document.getElementById("playback-state");
    var selector = document.querySelector(".selector");
    var activeTrack = "";
    var cueStartedTrack = "";
    var previousPlaybackState = state.dataset.state;
    var awaitingPlaybackAfterReset = false;
    var awaitingPlaybackTimer = 0;

    function clearAwaitingPlaybackAfterReset() {
      awaitingPlaybackAfterReset = false;
      if (awaitingPlaybackTimer) {
        window.clearTimeout(awaitingPlaybackTimer);
        awaitingPlaybackTimer = 0;
      }
    }

    function continueThroughShortBuffering() {
      clearAwaitingPlaybackAfterReset();
      awaitingPlaybackAfterReset = true;
      awaitingPlaybackTimer = window.setTimeout(function () {
        var currentState = state.dataset.state;
        awaitingPlaybackTimer = 0;
        if (!awaitingPlaybackAfterReset) return;
        awaitingPlaybackAfterReset = false;
        if ((currentState === "counting" || currentState === "loading") && renderer.motionState === "playing") {
          renderer.collapseToPoint({
            mode: renderer.mode,
            theme: renderer.theme,
            time: renderer.time,
            scale: renderer.scale,
            duration: STOP_MS
          });
        }
      }, POST_RESET_PLAYBACK_GRACE_MS);
    }

    function syncParticleMotion() {
      var selected = document.querySelector('[data-track][aria-pressed="true"]');
      var track = selected ? selected.dataset.track : "";
      var mode = track.indexOf("narrow") >= 0 ? "narrow" : track.indexOf("wide") >= 0 ? "wide" : "";
      var theme = track.indexOf("bright") === 0 ? "bright" : "dark";
      var changed = track !== activeTrack;
      var playbackState = state.dataset.state;
      var hadTrack = Boolean(activeTrack);

      document.body.classList.toggle("particle-active", Boolean(mode));

      if (!mode) {
        clearAwaitingPlaybackAfterReset();
        renderer.stop();
        activeTrack = track;
        previousPlaybackState = playbackState;
        return;
      }

      if (changed) {
        clearAwaitingPlaybackAfterReset();
        if (hadTrack) {
          if (renderer.lastRender && renderer.lastRender.melodyFrame) {
            renderer.render(Object.assign({}, renderer.lastRender, {melodyFrame: null}));
          }
          if (playbackState === "counting" && cueStartedTrack !== track) {
            // Keep the current field moving while the cue source starts. The
            // Reset begins on switchcueplaying, so freezing here only exposes
            // audio setup latency as a visible hitch.
            document.body.classList.add("resetting");
            renderer.resetVisualTrack = renderer.resetVisualTrack || activeTrack;
            setResetVisualTrack(renderer.resetVisualTrack);
            previousPlaybackState = playbackState;
            return;
          }
          renderer.resetToTrack({
            duration: RESET_MS,
            fromTrack: renderer.resetVisualTrack || activeTrack,
            toTrack: track,
            fromMode: renderer.mode,
            toMode: mode,
            fromTheme: renderer.theme,
            toTheme: theme,
            fromPalette: renderer.palette,
            fromLightBlend: renderer.lightBlend,
            time: renderer.time,
            scale: renderer.scale,
            isPlaybackActive: function () {
              var current = state.dataset.state;
              return current === "counting" || current === "loading" || current === "playing";
            },
            isPlaying: function () {
              return state.dataset.state === "playing";
            },
            onAwaitingPlayback: continueThroughShortBuffering
          });
          cueStartedTrack = "";
          activeTrack = track;
          previousPlaybackState = playbackState;
          return;
        }
        renderer.stop();
        renderer.time = 0;
        renderer.palette = PALETTES[theme];
        renderer.lightBlend = theme === "bright" ? 1 : 0;
        renderer.resetVisualTrack = track;
        applyImmediateTheme(theme);
        if (playbackState !== "playing") {
          renderer.showPoint({ mode: mode, theme: theme, time: 0 });
        } else {
          renderer.scale = 1;
          renderer.render({ mode: mode, theme: theme, time: 0, scale: 1 });
          renderer.motionState = "frozen";
          renderer.canvas.dataset.motionState = renderer.motionState;
        }
      }
      activeTrack = track;

      if (renderer.motionState === "resetting") {
        previousPlaybackState = playbackState;
        return;
      }

      if (renderer.theme !== theme) {
        renderer.render({ mode: mode, theme: theme, time: renderer.time, scale: 1 });
      }

      if (document.hidden) {
        clearAwaitingPlaybackAfterReset();
        renderer.stop();
        if (playbackState === "paused" || playbackState === "idle") {
          renderer.showPoint({ mode: mode, theme: theme, time: renderer.time });
        }
        previousPlaybackState = playbackState;
        return;
      }

      if (awaitingPlaybackAfterReset) {
        if (playbackState === "playing") {
          clearAwaitingPlaybackAfterReset();
        } else if (playbackState === "counting" || playbackState === "loading") {
          previousPlaybackState = playbackState;
          return;
        } else {
          clearAwaitingPlaybackAfterReset();
        }
      }

      if (playbackState === "playing") {
        if (previousPlaybackState === "paused" || renderer.motionState === "point" || renderer.motionState === "collapsing") {
          renderer.emitFromPoint({
            mode: mode,
            theme: theme,
            duration: EMISSION_MS,
            startScale: renderer.motionState === "point" ? 0 : renderer.scale
          });
        } else if (renderer.motionState === "emitting") {
          if (!renderer.running) {
            renderer.emitFromPoint({
              mode: mode,
              theme: theme,
              duration: EMISSION_MS,
              startScale: renderer.scale
            });
          }
        } else {
          renderer.start({ mode: mode, theme: theme, time: renderer.time, scale: 1 });
        }
      } else if (playbackState === "paused" || playbackState === "idle") {
        if (previousPlaybackState === "playing" || renderer.motionState === "playing" || renderer.motionState === "emitting") {
          renderer.collapseToPoint({ mode: mode, theme: theme, time: renderer.time, scale: renderer.scale, duration: STOP_MS });
        } else if (renderer.motionState !== "collapsing" && renderer.motionState !== "point" && previousPlaybackState !== "counting") {
          renderer.showPoint({ mode: mode, theme: theme, time: renderer.time });
        }
      } else if (playbackState === "error") {
        if (renderer.motionState === "playing" || renderer.motionState === "emitting") {
          renderer.collapseToPoint({ mode: mode, theme: theme, time: renderer.time, scale: renderer.scale, duration: STOP_MS });
        } else if (renderer.motionState !== "collapsing" && renderer.motionState !== "point") {
          renderer.showPoint({ mode: mode, theme: theme, time: renderer.time });
        }
      } else {
        if (playbackState === "loading" && renderer.running &&
            (renderer.motionState === "emitting" || renderer.motionState === "playing")) {
          // A waiting/stalled event must not stop the operation flare.
          // If a real wave is active the media clock itself stays still.
          previousPlaybackState = playbackState;
          return;
        }
        renderer.stop();
        if (previousPlaybackState === "paused" || renderer.motionState === "collapsing" || renderer.motionState === "point") {
          renderer.time = 0;
          renderer.showPoint({ mode: mode, theme: theme, time: 0 });
        } else if (renderer.motionState === "playing") {
          renderer.motionState = "frozen";
          renderer.canvas.dataset.motionState = renderer.motionState;
        }
      }
      previousPlaybackState = playbackState;
    }

    var observer = new MutationObserver(syncParticleMotion);
    observer.observe(state, { attributes: true, attributeFilter: ["data-state"] });
    observer.observe(selector, { subtree: true, attributes: true, attributeFilter: ["aria-pressed"] });
    document.addEventListener("fieldselection", syncParticleMotion);
    document.addEventListener("switchcueplaying", function (event) {
      cueStartedTrack = event.detail && event.detail.track ? event.detail.track : "";
      syncParticleMotion();
    });
    document.addEventListener("visibilitychange", syncParticleMotion);
    window.addEventListener("resize", function () {
      if (!document.body.classList.contains("particle-active")) return;
      if (renderer.lastRender) renderer.render(renderer.lastRender);
    });
    syncParticleMotion();
  }

  if (!renderStaticPreview()) bindParticleMotion();
}());
