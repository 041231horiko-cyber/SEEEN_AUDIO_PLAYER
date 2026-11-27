"use strict";
(function () {
  const renderer = SEEENParticleField.renderer;
  const melody = SEEENMelodySync;
  const kernels = window.benchKernels;
  const mock = location.search.includes("mock=1");
  const samples = 90;
  const result = document.getElementById("result");
  const context = renderer.context;
  let checksum = 0;

  function measure(action, count = samples, warmup = 30) {
    const values = [];
    for (let i = -warmup; i < count; i++) {
      const start = performance.now();
      action((i + count) % count);
      const elapsed = performance.now() - start;
      if (i >= 0) values.push(elapsed);
    }
    values.sort((a,b) => a-b);
    const round = n => +n.toFixed(3);
    return {mean: round(values.reduce((a,b) => a+b, 0)/count),
      median: round((values[Math.floor((count-1)/2)] + values[Math.ceil((count-1)/2)])/2),
      p95: round(values[Math.ceil(count*.95)-1]), max: round(values[count-1]), count};
  }
  function flushPixels() {
    if (!mock) checksum += context.getImageData(0, 0, 1, 1).data[3];
  }

  const render = {}, breakdown = {}, transitions = {};
  for (const mode of ["wide", "narrow"]) {
    const points = renderer[mode];
    const frames = Array.from({length:samples}, (_, i) => melody.phaseFrame(-26 + Math.sin(i/16)*8, i % 2 === 0, i/60));
    for (let count = 0; count <= 2; count++) {
      const settings = frames.map((melodyFrame, i) => ({mode, scale: 1, theme: i % 2 === 0 ? "bright" : "dark",
        melodyFrame, waveAges: Array.from({length: count}, (_, j) => .18 + (i % 45)/70 + j*1.23)}));
      render[mode + count] = measure(i => {
        renderer.render(settings[i]);
        flushPixels();
      });
    }
    if (mock) {
      const prepared = frames.map((_, i) => [kernels.prepareWave(.18 + i/120, mode, []),
        kernels.prepareWave(1.42 + i/120, mode, [])]);
      const narrow = mode === "narrow";
      breakdown[mode + " melody alpha"] = measure(i => {
        const frame = frames[i];
        if (kernels.fastMelody) {
          const basis = renderer.melodyBasis[mode][frame.f];
          const sin1 = Math.sin(frame.firstPhase), cos1 = Math.cos(frame.firstPhase);
          const sin2 = Math.sin(frame.secondPhase), cos2 = Math.cos(frame.secondPhase);
          for (let p = 0; p < points.length; p++) {
            checksum += kernels.fastMelody(points[p], frame, basis, p, sin1, cos1, sin2, cos2);
          }
        } else {
          for (const point of points) checksum += melody.alpha(point, frame);
        }
      });
      const oneWave = prepared.map(([wave]) => [wave]);
      for (const [label, waves] of [["one knock", oneWave], ["two knocks and MAX", prepared]]) {
        breakdown[mode + " " + label] = measure(i => {
          for (let p = 0; p < points.length; p++) {
            checksum += kernels.synchronizedAmplitude(points[p], narrow ? renderer.reflection[p] : null, waves[i]);
          }
        });
      }
      if (narrow) breakdown["narrow reflection kernel only (active boundary)"] = measure(i => {
        const wave = prepared[i][0];
        for (const point of renderer.reflection) {
          if (point.boundaryMask !== 0) checksum += kernels.reflection(point, wave[0], wave[5]);
        }
      });
    }
    // Replay the unchanged drawing commands with fixed, precomputed alpha.
    // This isolates Canvas submission and flush; it is not a subtraction.
    const radius = mode === "wide" ? 145 : 98;
    breakdown[mode + " Canvas command replay"] = measure(() => {
      context.clearRect(0,0,667,375);
      context.save();
      context.beginPath();
      context.rect(12,75,376,287);
      context.clip();
      context.fillStyle = "#101010";
      for (const point of points) {
        context.globalAlpha = point.j * .25;
        context.beginPath();
        context.arc(200+point.x*radius, 210+point.y*radius,
          mode === "wide" ? .29*(145/90)*point.dot : point.dot, 0, Math.PI*2);
        context.fill();
      }
      context.globalAlpha = 1;
      context.beginPath();
      context.arc(200,210,3.4,0,Math.PI*2);
      context.fill();
      context.restore();
      flushPixels();
    });

    // Run genuine emission/collapse callbacks with fixed 60 Hz timestamps.
    let next, transitionStart, frameId = 0;
    window.requestAnimationFrame = callback => { next = callback; return ++frameId; };
    window.cancelAnimationFrame = () => { next = null; };
    for (const [operation, length] of [["start", 288], ["stop", 420]]) {
      const framesPerRun = Math.ceil(length / (1000/60));
      transitions[mode + " " + operation] = measure(i => {
        if (i % framesPerRun === 0 || !next) {
          renderer.stop();
          next = null;
          if (operation === "start") renderer.emitFromPoint({mode, theme: "bright"});
          else {
            renderer.render({mode, theme: "bright", scale: 1, melodyFrame: frames[0], waveAges: [.4]});
            renderer.collapseToPoint({mode, theme: "bright", scale: 1});
          }
          transitionStart = performance.now();
        }
        const callback = next;
        next = null;
        callback(transitionStart + (i % framesPerRun + 1) * (1000/60));
        flushPixels();
      }, framesPerRun * 4, 0);
      renderer.stop();
    }
  }
  // Explicit render-owned allocations, by source inspection. This excludes
  // caller objects, the audio clocks, browser internals and JIT temporaries.
  const renderAllocations = {snapshotPerRender: 1, preparedListPerSynchronizedRender: Number(!renderer.preparedWaves),
    recordPerNarrowWave: Number(!renderer.preparedWaves), mapCallbackPerSynchronizedRender: Number(!renderer.preparedWaves),
    melodyBasisBytes: renderer.melodyBasis ? (renderer.wide.length + renderer.narrow.length) * 4 * 2 * 8 : 0};
  result.textContent = JSON.stringify({dpr: renderer.renderDpr, render, breakdown, transitions, renderAllocations, checksum});
}());
