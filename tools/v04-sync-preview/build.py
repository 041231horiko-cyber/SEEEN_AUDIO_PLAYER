"""Package a private STEP 01.1 preview using analysis output from STEP 01."""

import argparse
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BASE = "2eebb2a2263cd61861ea3229aba00f9fdfaeb916"
ANALYSIS = "f58a7442fee5f6d84f7c0e28ef70bb85ba7025f9"
TRACKS = ("bright-wide", "bright-narrow", "dark-wide", "dark-narrow")


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError("Baseline renderer no longer matches the preview adapter")
    return source.replace(old, new, 1)


def preview_renderer():
    source = subprocess.check_output(
        ["git", "-C", str(REPO), "show", BASE + ":SEEEN_AUDIO_PLAYER/particle-field.js"],
        text=True,
    )
    source = replace_once(
        source,
        '  if (!renderStaticPreview()) bindParticleMotion();',
        '  // STEP 01.1 owns the only animation loop.',
    )
    source = replace_once(source, '  function wideAmplitude(point, time) {',
        '''  // Keep the V03 raised cosine and radial shading, using only its central
  // lobe. An unbounded phase would otherwise spawn more periodic rings.
  function singleWideAmplitude(point, timePhase) {
    var phase = point.phase - timePhase;
    var pulse = Math.abs(phase) < Math.PI ?
      0.83 * Math.pow(0.5 + 0.5 * Math.cos(phase), 7) : 0;
    return (0.015 + pulse) * point.edge * point.shade;
  }

  function wideAmplitude(point, time) {''')
    source = replace_once(source,
        'function narrowAmplitudePrepared(point, travel, blend, focus, fade) {',
        '''function narrowAmplitudePrepared(point, travel, blend, focus, fade, reflectionGain) {''')
    source = replace_once(source, '''    var combined = Math.max(direct, merged);
    var value = (combined * (1 - blend) + converge * blend) * fade;''',
        '''    var gain = reflectionGain === undefined ? 1 : reflectionGain;
    var combined = Math.max(direct, merged * gain);
    var value = (combined * (1 - blend) + converge * gain * blend) * fade;''')
    source = replace_once(source, '  ParticleField.prototype.render = function (options) {', '''  // Rebuild reflection distances only when the boundary changes. The original
  // points still supply every draw coordinate, radius and occlusion check.
  ParticleField.prototype.previewBoundary = function (ratio) {
    if (this.previewBoundaryRatio === ratio) return this.previewBoundaryPoints;
    this.previewBoundaryRatio = ratio;
    this.previewBoundaryPoints = this.narrow.map(function (point) {
      var x = point.x / ratio;
      var y = point.y / ratio;
      return {
        r: Math.hypot(x, y),
        d: [Math.hypot(x - 2, y), Math.hypot(x + 2, y), Math.hypot(x, y - 2), Math.hypot(x, y + 2)],
        wall0: smooth(x / 0.2),
        wall1: smooth(-x / 0.2),
        wall2: smooth(y / 0.2),
        wall3: smooth(-y / 0.2),
        boundaryMask: 1 - smooth((Math.max(Math.abs(x), Math.abs(y)) - 1) / 0.08),
        gain: point.gain
      };
    });
    return this.previewBoundaryPoints;
  };

  ParticleField.prototype.render = function (options) {''')
    source = replace_once(source, '    var coveredScale;\n    var i;', '''    var coveredScale;
    var profile = narrow && settings.narrowProfile;
    var boundary = profile ? this.previewBoundary(profile.boundaryPercent / 100) : null;
    var waves = (settings.waveAges || [time]).map(function (age) {
      if (!narrow) return age * 3.5;
      var travel = profile ? window.SEEENSyncTimeline.narrowTravel(age, profile) : age * 0.66;
      var fade = 1 - smooth((travel - 1.97) / 0.22);
      return [
        travel, smooth((travel - 1.32) / 0.55), Math.max(0, 2 - travel),
        fade, profile ? 1 - (profile.decayPercent / 100) * smooth((travel - 1) / 1.19) : 1
      ];
    });
    var i;''')
    source = replace_once(source, '''        var amplitude = narrow ? narrowAmplitudePrepared(
          point, narrowTravel, narrowBlend, narrowFocus, narrowFade
        ) : wideAmplitudePrepared(point, wideTimePhase);''', '''        var amplitude = 0;
        var sampled = boundary ? boundary[i] : point;
        for (var waveIndex = 0; waveIndex < waves.length; waveIndex += 1) {
          var wave = waves[waveIndex];
          var level = narrow ? narrowAmplitudePrepared(
            sampled, wave[0], wave[1], wave[2], wave[3], wave[4]
          ) : singleWideAmplitude(point, wave);
          if (boundary) {
            var floor = 0.014 * point.gain;
            level = floor * wave[3] + (level - floor) * sampled.boundaryMask;
          }
          amplitude = Math.max(amplitude, level);
        }''')
    source = replace_once(source, '''    var wideTimePhase;
    var wideDotScale;
    var narrowTravel;
    var narrowBlend;
    var narrowFocus;
    var narrowFade;''', '''    var wideDotScale = 0.29 * Math.max(0.7, radius / 90);''')
    begin = source.index('    if (narrow) {\n      narrowTravel = ')
    end = source.index('    this.setMode(mode);', begin)
    return source[:begin] + source[end:]


def inputs(folder):
    data = {}
    for key in TRACKS:
        path = folder / f"{key}.json"
        raw = path.read_bytes()
        track = json.loads(raw)
        audio_name = key.replace("-", "_") + "_loop_125s_test.m4a"
        events = track["knockEvents"]
        times = [e["time"] for e in events]
        if (track["schemaVersion"] != 1 or track["trackId"] != key or
            track["audioDuration"] != 124.7 or track["audioFile"] != audio_name or
            len(times) != 35 or times != sorted(set(times)) or not all(0 <= t < 124.7 for t in times)):
            raise ValueError(f"Invalid STEP 01 dataset: {key}")
        echoes = [echo for event in events for echo in event["echoes"]]
        if len(echoes) != (27 if key.endswith("narrow") else 0) or any(
            not .460 <= echo["delay"] <= .585 for echo in echoes
        ):
            raise ValueError(f"Invalid STEP 01 echo data: {key}")
        audio = folder / "audio" / audio_name
        if hashlib.sha256(audio.read_bytes()).hexdigest() != track["audioSha256"]:
            raise ValueError(f"STEP 01 audio SHA-256 mismatch: {key}")
        data[key] = (path, audio)
    return data


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("analysis_output", type=Path)
    parser.add_argument("output", type=Path, help="new private package directory outside Git")
    args = parser.parse_args()
    out = args.output.resolve()
    zip_path = out.with_suffix(".zip")
    if out.is_relative_to(REPO) or zip_path.is_relative_to(REPO):
        parser.error("keep audio and derived data outside the Git checkout")
    if out.exists() or zip_path.exists():
        parser.error("the output directory and archive must be new")
    data = inputs(args.analysis_output)
    renderer = preview_renderer()
    out.mkdir(parents=True)
    (out / "audio").mkdir()
    (out / "analysis").mkdir()
    for name in ("sync-preview.html", "sync-preview.js", "timeline.js", "README.md"):
        shutil.copyfile(HERE / name, out / name)
    (out / "preview-renderer.js").write_text(renderer, encoding="utf-8")
    for path, audio in data.values():
        shutil.copyfile(path, out / "analysis" / path.name)
        shutil.copyfile(audio, out / "audio" / audio.name)
    with ZipFile(zip_path, "x", compression=ZIP_DEFLATED) as archive:
        for path in sorted(out.rglob("*")):
            if path.is_file():
                archive.write(path, arcname=path.relative_to(out))
    print(zip_path)


if __name__ == "__main__":
    main()
