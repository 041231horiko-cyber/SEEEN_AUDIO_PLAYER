// Measure Canvas draw inputs without a browser or audio output device.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function captureRenderer(directory, recordDots = true) {
  let dots;
  const canvas = {dataset: {}, getContext: () => ({
    setTransform(){}, clearRect(){ dots = []; }, save(){}, beginPath(){}, rect(){}, clip(){},
    arc: recordDots ? function (x, y, radius) {
      dots.push([x, y, radius, this.globalAlpha]);
    } : () => {},
    fill(){}, restore(){}
  })};
  const context = {document: {getElementById: () => canvas}, performance, devicePixelRatio: 1};
  context.window = context;
  for (const name of ["timeline.js", "preview-renderer.js"]) {
    vm.runInNewContext(fs.readFileSync(path.join(directory, name), "utf8"), context, {filename: name});
  }
  const renderer = context.SEEENParticleField.renderer;
  return options => {
    const ms = renderer.render(options);
    return recordDots ? dots.slice(0, -1) : ms; // Omit the constant opaque center dot.
  };
}

if (require.main === module) {
  const draw = captureRenderer(process.argv[2]);
  const profile = {diffusionMs: 380, returnMs: 1800, boundaryPercent: 70};
  const thresholds = [380, 650, 1000, 1450, 1800, 2050];
  for (const ms of thresholds) {
    const values = [0, 50, 100].map(decayPercent => {
      const dots = draw({mode: "narrow", theme: "dark", scale: 1, waveAges: [ms / 1000],
        narrowProfile: {...profile, decayPercent}});
      return {
        mean: Number((dots.reduce((sum, dot) => sum + dot[3], 0) / dots.length).toFixed(6)),
        peak: Number(Math.max(...dots.map(dot => dot[3])).toFixed(6))
      };
    });
    console.log(ms, JSON.stringify(values));
  }
}

module.exports = {captureRenderer};
