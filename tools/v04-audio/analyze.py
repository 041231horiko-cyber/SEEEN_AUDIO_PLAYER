"""Offline analysis of the four SEEEN V04 mixes. See README.md."""

import argparse
import csv
from dataclasses import dataclass
import gzip
import hashlib
import json
from pathlib import Path
import shutil
import subprocess
from zipfile import ZipFile

import numpy as np
from scipy import ndimage, signal


RATE = 12000
HOP = 60
DT = HOP / RATE
FFT = 512
DURATION = 124.7
TRACKS = ("bright-wide", "bright-narrow", "dark-wide", "dark-narrow")
FILES = {key: key.replace("-", "_") + "_loop_125s_test.m4a" for key in TRACKS}
INPUT_LIMIT = 8_000_000


def command(*args, data):
    return subprocess.run(args, input=data, stdout=subprocess.PIPE, check=True).stdout


def digest(data):
    return hashlib.sha256(data).hexdigest()


def read_inputs(path):
    with ZipFile(path) as archive:
        expected = {"manifest.json", *FILES.values()}
        if len(archive.namelist()) != len(expected) or set(archive.namelist()) != expected:
            raise ValueError("Unexpected or duplicate ZIP members")
        if any(info.file_size > INPUT_LIMIT for info in archive.infolist()):
            raise ValueError("ZIP member exceeds size limit")
        manifest = json.loads(archive.read("manifest.json"))
        records = {row["filename"]: row for row in manifest}
        if len(manifest) != len(FILES) or set(records) != set(FILES.values()):
            raise ValueError("Manifest does not describe the four expected files")
        inputs = {}
        for key, name in FILES.items():
            raw = archive.read(name)
            row = records[name]
            if digest(raw) != row["sha256"] or len(raw) != row["bytes"]:
                raise ValueError(f"Manifest integrity check failed: {name}")
            inputs[key] = (raw, row)
    return inputs


@dataclass
class Track:
    key: str
    source: dict
    audio: np.ndarray
    boundary: dict
    magnitude: np.ndarray
    features: dict


def rms(x, axis=None):
    return np.sqrt(np.mean(np.square(x), axis=axis))


def decode(key, path, row):
    meta = json.loads(command("ffprobe", "-v", "error", "-show_streams",
                              "-show_format", "-of", "json", str(path), data=None))
    if len(meta["streams"]) != 1:
        raise ValueError(f"Expected exactly one audio stream: {path.name}")
    stream = meta["streams"][0]
    duration = float(stream["duration"])
    actual = (stream["codec_name"], int(stream["sample_rate"]), stream["channels"])
    recorded = (row["codec"], row["sample_rate"], row["channels"])
    if actual != recorded or actual != ("aac", 48000, 2) or (
        abs(duration - row["duration_seconds"]) > 0.001 or abs(duration - DURATION) > 0.001
    ):
        raise ValueError(f"Audio format or duration mismatch: {path.name}")
    pcm = command("ffmpeg", "-v", "error", "-i", str(path), "-map", "0:a:0",
                  "-f", "f32le", "-", data=None)
    full = np.frombuffer(pcm, dtype="<f4").reshape(-1, 2)
    expected = round(duration * actual[1])
    if not expected <= len(full) < expected + 1024:
        raise ValueError(f"Unexpected decoded sample count: {path.name}")
    x = full[:expected]  # Container timeline ends before optional AAC packet padding.
    jump = x[0] - x[-1]
    edge = np.concatenate((x[:4800], x[-4800:]))
    boundary = {
        "decodedPaddingSamples": len(full) - expected,
        "startRms100ms": float(rms(x[:4800])),
        "endRms100ms": float(rms(x[-4800:])),
        "sampleJumpLeftRight": jump.tolist(),
        "nearBoundaryAdjacentDifferenceP99": float(np.percentile(np.abs(np.diff(edge.reshape(2, -1, 2), axis=1)), 99)),
    }
    audio = signal.resample_poly(x, 1, 4, axis=0)
    freq, _, stft = signal.stft(audio.T, RATE, nperseg=FFT, noverlap=FFT - HOP)
    mag = np.sqrt(np.mean(np.abs(stft) ** 2, axis=0)).astype(np.float32)
    features = onset_features(mag, freq)
    return Track(key, row, audio, boundary, mag, features)


BANDS = ((40, 125), (125, 300), (300, 750), (750, 1800), (1800, 3900), (3900, 6001))
FRAME_RATE = 20
FREQ = np.fft.rfftfreq(FFT, 1 / RATE)


def band_rms(mag, freq):
    return np.array([rms(mag[(freq >= lo) & (freq < hi)], axis=0) for lo, hi in BANDS])


def local_floor(values, seconds=0.48):
    return ndimage.percentile_filter(values, 45, size=(1, 2 * round(seconds / DT / 2) + 1), mode="nearest")


def onset_features(mag, freq):
    # A frequency maximum suppresses small pitch drift before the positive difference.
    log_mag = np.log1p(mag * 1400)
    prev = ndimage.maximum_filter1d(log_mag, 3, axis=0)
    flux = np.maximum(log_mag[:, 2:] - prev[:, :-2], 0)
    flux = np.pad(flux, ((0, 0), (2, 0)))
    band_flux = np.array([np.mean(flux[(freq >= lo) & (freq < hi)], axis=0) for lo, hi in BANDS])
    bands = band_rms(mag, freq)
    rise = np.maximum(np.log((bands + 1e-5) / (local_floor(bands) + 1e-5)), 0)
    return {"flux": band_flux, "rise": rise, "bands": bands}


def load_tracks(zip_path, out):
    inputs = read_inputs(zip_path)
    out.mkdir(parents=True, exist_ok=False)
    audio_dir = out / "audio"
    audio_dir.mkdir()
    tracks = {}
    for key, (raw, row) in inputs.items():
        path = audio_dir / FILES[key]
        path.write_bytes(raw)
        tracks[key] = decode(key, path, row)
    return tracks


def correlation(a, b):
    return float(np.dot(a.ravel(), b.ravel()) / (np.linalg.norm(a) * np.linalg.norm(b) + 1e-15))


def peak_near(values, center, before, after):
    start = max(0, center - before)
    end = min(len(values), center + after + 1)
    return start + int(np.argmax(values[start:end]))


def relative_rise(flux, peak):
    peak = int(peak)
    start = max(0, peak - 5)
    for i in range(peak - 1, start - 1, -1):
        if flux[i] < 0.30 * flux[peak]:
            return i + 1
    return start


def detect(tracks):
    flux = {key: track.features["flux"].mean(axis=0) for key, track in tracks.items()}
    # Scan each mix independently before comparing. 100 ms does not merge the
    # later NARROW attacks into the first peak during the candidate scan.
    peaks = {key: signal.find_peaks(x, distance=20, prominence=0.015)[0] for key, x in flux.items()}
    residuals = [tracks[f"{color}-narrow"].audio - tracks[f"{color}-wide"].audio
                 for color in ("bright", "dark")]
    res_rms = [rms(x.reshape(-1, HOP, 2), axis=(1, 2)) for x in residuals]
    mix_rms = {key: rms(t.audio.reshape(-1, HOP, 2), axis=(1, 2)) for key, t in tracks.items()}
    events = {key: [] for key in tracks}
    audit = []
    wide_key = "dark-wide"  # Used to screen the event family, with per-mix cross-checks below.
    for p in peaks[wide_key]:
        if flux[wide_key][p] < 0.065:
            continue
        near = {key: peak_near(x, p, 3, 3) for key, x in flux.items()}
        values = {key: float(flux[key][i]) for key, i in near.items()}
        band_votes = [int(np.count_nonzero(tracks[key].features["rise"][:, i:i+8].max(axis=1) > 0.35))
                      for key, i in near.items()]
        # Relative to preceding audio. No fixed absolute peak amplitude test alone.
        floor = [float(np.median(x[max(0, p-40):max(1, p-6)])) for x in res_rms]
        attack = [float(np.max(x[max(0, p-1):p+9])) for x in res_rms]
        ratios = [a/(f+1e-5) for a, f in zip(attack, floor)]
        lo, hi = max(0, (p-1)*HOP), (p+9)*HOP
        corr = correlation(residuals[0][lo:hi], residuals[1][lo:hi])
        # The BRIGHT melody can obscure its WIDE onset. In those windows
        # require a much larger relative rise in both difference signals.
        bright_evidence = values["bright-wide"] >= 0.039 or (
            values["bright-wide"] >= 0.020 and min(ratios) >= 6 and corr >= .95
        )
        hit = (values["dark-wide"] >= 0.083 and bright_evidence and
               min(values[key] for key in tracks if key.endswith("-narrow")) >= 0.070 and
               min(ratios) >= 1.45 and corr >= 0.69 and sum(band_votes) >= 8)
        audit.append({"time": round(p*DT, 3), "accepted": hit, "flux": values,
                      "bandVotes": band_votes, "residualRmsRatio": ratios, "residualCorrelation": corr})
        if not hit:
            continue
        agreement = 1 - min(1, (max(near.values()) - min(near.values())) / 6)
        confidence = min(.97, .58 + .17*corr + .12*agreement + .1*min(min(ratios)/4, 1))
        for key, i in near.items():
            events[key].append({
                "time": round(relative_rise(flux[key], i) * DT, 3),
                "fluxPeakTime": round(i*DT, 3),
                "strength": float(np.max(mix_rms[key][max(0, i-1):i+9])),
                "confidence": round(confidence, 2),
                "echoes": [],
            })

    for key, sequence in events.items():
        max_strength = max(x["strength"] for x in sequence)
        for event in sequence:
            event["strength"] = round(event["strength"]/max_strength, 3)
    return events, audit, flux, residuals, peaks


def annotate_echoes(events, flux, residuals):
    for index, color in enumerate(("bright", "dark")):
        key = f"{color}-narrow"
        peer = "dark-narrow" if color == "bright" else "bright-narrow"
        for direct in events[key]:
            p = round(direct["fluxPeakTime"] / DT)
            narrow = flux[key]
            wide = flux[f"{color}-wide"]
            # A recurring delayed attack in the NARROW mixes. Earlier/smaller
            # tails remain unclassified rather than being issued as triggers.
            lo, hi = p+round(.42/DT), p+round(.70/DT)+1
            k = lo + int(np.argmax(narrow[lo:hi]))
            q = peak_near(flux[peer], k, 3, 3)
            wide_peak = max(wide[k-3:k+4])
            a, b = (k-1)*HOP, (k+8)*HOP
            corr = correlation(residuals[index][a:b], residuals[1-index][a:b])
            if (narrow[k] >= max(.041, wide_peak*1.6) and flux[peer][q] >= .041 and corr >= .76):
                start = relative_rise(narrow, k)
                direct["echoes"].append({
                    "time": round(start*DT, 3),
                    "delay": round(start*DT-direct["time"], 3),
                    "relativeFlux": round(float(narrow[k]/narrow[p]), 3),
                    "confidence": "candidate",
                })


def melody(tracks, events):
    result = {}
    metrics = {}
    for color in ("bright", "dark"):
        wide, narrow = [tracks[f"{color}-{mode}"] for mode in ("wide", "narrow")]
        # Horizontal median favors sustained components. Taking the lower
        # magnitude of each pair attenuates mode-specific transients.
        mixed = np.minimum(wide.magnitude, narrow.magnitude)
        harmonic = ndimage.median_filter(mixed, size=(1, 25), mode="nearest")
        vertical = ndimage.median_filter(mixed, size=(13, 1), mode="nearest")
        proxy = mixed * (harmonic**2 / (harmonic**2 + vertical**2 + 1e-18))
        frames = np.arange(round(DURATION*FRAME_RATE)) * round(1/(FRAME_RATE*DT))
        t = frames * DT
        proxy = np.minimum(proxy, harmonic*1.6)[:, frames]
        passing = np.ones(len(frames), dtype=bool)
        for hit in events[wide.key]:
            passing &= (t < hit["time"]-.045) | (t > hit["time"]+.155)
        for hit in events[narrow.key]:
            for echo in hit["echoes"]:
                passing &= (t < echo["time"]-.040) | (t > echo["time"]+.130)
        proxy[:, ~passing] = np.array([np.interp(t[~passing], t[passing], row[passing]) for row in proxy])
        proxy = ndimage.gaussian_filter1d(proxy, 1.0, axis=1, mode="nearest")
        power = proxy**2
        power[FREQ < 40] = 0
        energy = power.sum(axis=0)
        # Hann-window STFT has power sum ~0.75 * waveform mean square.
        db = np.maximum(-100, 10*np.log10(energy/.75 + 1e-12))
        centroid = (FREQ @ power)/(energy + 1e-18)
        dominant_bin = power.argmax(axis=0)
        dominant_hz = FREQ[dominant_bin]
        peak_fraction = power.max(axis=0)/(energy+1e-18)
        bands_db = [np.maximum(-100, 10*np.log10(power[(FREQ >= lo) & (FREQ < hi)].sum(axis=0)/.75 + 1e-12))
                    for lo, hi in BANDS]
        band_db = np.array(bands_db)
        change = np.mean(np.abs(np.diff(np.maximum(band_db, -85), prepend=band_db[:, :1], axis=1)), axis=0)
        valid = db > -75
        dominant_valid = valid & (peak_fraction >= .12)
        result[color] = {
            "method": "same-color-pair-harmonic-proxy",
            "fundamentalHz": None,
            "rmsDbfs": np.round(db.astype(np.float64), 1).tolist(),
            "dominantHz": [round(float(v), 1) if ok else None for v, ok in zip(dominant_hz, dominant_valid)],
            "centroidHz": [round(float(v)) if ok else None for v, ok in zip(centroid, valid)],
            "bandEdgesHz": [list(band) for band in BANDS],
            "bandEnergyDbfs": np.round(band_db.astype(np.float64), 1).tolist(),
            "changeDbPerFrame": np.round(change.astype(np.float64), 2).tolist(),
            "interpolatedRanges": mask_ranges(~passing),
        }
        stable = np.repeat(passing, round(1/(FRAME_RATE*DT))*HOP)
        metrics[color] = {
            "waveCorrelationOutsideMaskedWindows": correlation(wide.audio[stable], narrow.audio[stable]),
            "interpolatedFraction": float((~passing).mean()),
            "dominantHzCoverage": float(dominant_valid.mean()),
            "outsideMaskBandCorrelations": [
                correlation(stats[0]-stats[0].mean(), stats[1]-stats[1].mean())
                for stats in zip(*[np.log1p(tr.features["bands"][:, frames[passing]]*1e5) for tr in (wide, narrow)])
            ],
            "proxyStartEndDbfs": [float(db[0]), float(db[-1])],
        }
    return result, metrics


def mask_ranges(mask):
    transitions = np.flatnonzero(np.diff(np.pad(mask.astype(np.int8), 1)))
    return transitions.reshape(-1, 2).tolist()


def make_plots(out, track, events, features, flux):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt

    fig, axes = plt.subplots(4, 1, figsize=(15, 10), sharex=True, layout="constrained")
    fig.suptitle(f"SEEEN V04  |  {track.key.upper()}  |  offline analysis")
    block = track.audio.reshape(-1, 600, 2)
    t = np.arange(len(block))/FRAME_RATE
    axes[0].fill_between(t, block.min(axis=(1, 2)), block.max(axis=(1, 2)),
                         color="#4e7595", alpha=.8, label="50 ms stereo min/max")
    axes[0].plot(np.arange(len(flux))*DT, flux, color="#615787", lw=.6, label="mean positive flux")
    axes[0].set_ylabel("Amplitude / flux")
    axes[0].legend(loc="upper right", fontsize="small")
    reduced = track.magnitude[:, :-1].reshape(len(FREQ), -1, 10).max(axis=-1)
    axes[1].imshow(20*np.log10(reduced[2:] + 1e-7), aspect="auto", origin="lower",
                   extent=(0, DURATION, FREQ[2], FREQ[-1]), cmap="magma", vmin=-85, vmax=-20)
    axes[1].set_yscale("log")
    axes[1].set_ylabel("Mix spectrogram (Hz)")
    axes[2].plot(t, features["rmsDbfs"], color="#287169")
    axes[2].set_ylabel("Melody proxy (dBFS)")
    for a, b in features["interpolatedRanges"]:
        axes[2].axvspan(a/FRAME_RATE, b/FRAME_RATE, alpha=.20, color="#cd8d48", lw=0)
    axes[3].scatter(t, [np.nan if v is None else v for v in features["dominantHz"]],
                    s=3, color="#4e7595", label="dominant bin")
    axes[3].plot(t, [np.nan if v is None else v for v in features["centroidHz"]],
                 lw=.75, color="#715586", label="centroid")
    axes[3].set_yscale("log")
    axes[3].set_ylabel("Melody proxy (Hz)")
    axes[3].legend(loc="upper right", fontsize="small")
    axes[3].set_xlabel("Source time (s)")
    for hit in events:
        for ax in axes[:2]:
            ax.axvline(hit["time"], color="#218c81", lw=.7, alpha=.75)
            for echo in hit["echoes"]:
                ax.axvline(echo["time"], color="#cc802d", ls=":", lw=.85)
    axes[-1].set_xlim(0, DURATION)
    fig.savefig(out / f"{track.key}.png", dpi=125, metadata={"Title": track.key})
    plt.close(fig)


def make_transient_plots(out, tracks, events, residuals):
    import matplotlib.pyplot as plt

    count = len(events["dark-wide"])
    fig, axes = plt.subplots((count+6)//7, 7, figsize=(18, 11), sharex=True,
                             layout="constrained", squeeze=False)
    fig.suptitle("Event audit | WIDE & NARROW spectral flux, normalized per onset")
    for ax, hit in zip(axes.flat, events["dark-wide"]):
        p = round(hit["fluxPeakTime"]/DT)
        idx = np.arange(p-24, p+221)
        for key, color in (("bright-wide", "#486f8c"), ("dark-wide", "#6086a4"),
                           ("bright-narrow", "#a65034"), ("dark-narrow", "#c88642")):
            f = tracks[key].features["flux"].mean(axis=0)
            ax.plot((idx-p)*DT, f[idx]/max(f[p-3:p+4]), color=color, lw=.65, label=key)
        ax.axvline(0, lw=.6, color="black")
        ax.set_title(f"{hit['time']:.3f} s", fontsize=8)
    for ax in list(axes.flat)[len(events["dark-wide"]):]:
        ax.axis("off")
    for ax in axes[-1]:
        ax.set_xlabel("Offset (s)")
    axes[0, 0].legend(fontsize=5)
    fig.savefig(out / "transients.png", dpi=120)
    plt.close(fig)

    fig, axes = plt.subplots(2, 1, figsize=(12, 6), sharex=True, layout="constrained")
    for i, color in enumerate(("bright", "dark")):
        for key in (f"{color}-wide", f"{color}-narrow"):
            track = tracks[key]
            joined = np.concatenate((track.audio[-RATE:], track.audio[:RATE]))
            axes[i].plot(np.arange(-RATE, RATE)/RATE, joined[:, 0], lw=.6, label=key)
        joined = np.concatenate((residuals[i][-RATE:], residuals[i][:RATE]))
        axes[i].plot(np.arange(-RATE, RATE)/RATE, joined[:, 0], lw=.6, label="NARROW − WIDE")
        axes[i].axvline(0, color="black", lw=.7)
        axes[i].legend()
        axes[i].set_ylabel("Left sample")
    axes[-1].set_xlabel("Seconds from loop boundary")
    fig.savefig(out / "loop-boundary.png", dpi=125)
    plt.close(fig)


def compare(tracks, events, residuals, metrics, peaks, flux):
    groups = list(zip(*events.values()))
    offsets = np.ptp([[e["time"] for e in g] for g in groups], axis=1)
    unmatched = {}
    for key, sequence in events.items():
        # Keep the strongest excluded onsets outside the whole direct/echo
        # neighborhood for listening review, including possible isolated hits.
        remaining = [
            p for p in peaks[key]
            if all(not e["time"]-.11 <= p*DT <= e["time"]+1 for e in sequence)
        ]
        unmatched[key] = [
            {"time": round(float(p*DT), 3), "flux": round(float(flux[key][p]), 3)}
            for p in sorted(remaining, key=lambda p: -flux[key][p])[:15]
        ]
    return {
        "matchedGroups": len(groups),
        "maxOnsetSpreadSeconds": round(float(max(offsets)), 3),
        "medianOnsetSpreadSeconds": round(float(np.median(offsets)), 3),
        "residualCorrelationAcrossColors": correlation(*residuals),
        "boundaryResidualRms": {
            color: {
                "endLast100ms": float(rms(res[-1200:])),
                "startFirst100ms": float(rms(res[:1200])),
                "start400To800ms": float(rms(res[4800:9600])),
            }
            for color, res in zip(("bright", "dark"), residuals)
        },
        "strongExcludedCandidates": unmatched,
        "melodyDiagnostics": metrics,
        "tracks": {key: {"directCount": len(seq), "echoCandidates": sum(len(e["echoes"]) for e in seq),
                         "firstDirect": seq[0]["time"], "lastDirect": seq[-1]["time"],
                         "wrapInterval": round(DURATION-seq[-1]["time"]+seq[0]["time"], 3),
                         "containerAndManifest": tracks[key].source,
                         "boundary": tracks[key].boundary}
                   for key, seq in events.items()},
    }


def compact_json(data):
    return json.dumps(data, ensure_ascii=False, allow_nan=False, separators=(",", ":")).encode()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("zip_path", type=Path)
    parser.add_argument("output", type=Path, help="new output directory outside the app and Git checkout")
    args = parser.parse_args()
    repo = Path(__file__).resolve().parents[2]
    out = args.output.resolve()
    if out.is_relative_to(repo):
        parser.error("use an output directory outside the Git checkout")
    tracks = load_tracks(args.zip_path, out)
    events, audit, flux, residuals, peaks = detect(tracks)
    annotate_echoes(events, flux, residuals)
    features, metrics = melody(tracks, events)
    comparison = compare(tracks, events, residuals, metrics, peaks, flux)
    payloads = {}
    for key, track in tracks.items():
        proxy = features[key.split("-")[0]]
        data = {
            "schemaVersion": 1, "trackId": key, "audioDuration": DURATION,
            "audioSha256": track.source["sha256"], "audioFile": FILES[key],
            "sampleInterval": 1/FRAME_RATE, "knockEvents": events[key], "melodyFeatures": proxy,
        }
        payload = compact_json(data)
        (out / f"{key}.json").write_bytes(payload)
        payloads[key] = data
        comparison["tracks"][key]["jsonBytes"] = len(payload)
        comparison["tracks"][key]["gzipBytes"] = len(gzip.compress(payload, mtime=0))
        make_plots(out, track, events[key], proxy, flux[key])
    (out / "comparison.json").write_text(json.dumps(comparison, indent=2, allow_nan=False)+"\n")
    (out / "detector-audit.json").write_text(json.dumps(audit, indent=2, allow_nan=False)+"\n")
    with (out / "knock-events.csv").open("w", newline="") as file:
        writer = csv.writer(file)
        writer.writerow(["trackId", "kind", "time", "directTime", "delay", "strength", "confidence"])
        for key, sequence in events.items():
            for e in sequence:
                writer.writerow([key, "direct", e["time"], e["time"], 0, e["strength"], e["confidence"]])
                for echo in e["echoes"]:
                    writer.writerow([key, "echo_candidate", echo["time"], e["time"], echo["delay"], "",
                                     echo["confidence"]])
    make_transient_plots(out, tracks, events, residuals)
    review = {
        key: {field: p[field] for field in ("audioSha256", "audioFile", "knockEvents")}
        | {"excludedOnsets": comparison["strongExcludedCandidates"][key]}
        for key, p in payloads.items()
    }
    template = Path(__file__).with_name("review.html").read_text()
    (out / "review.html").write_text(template.replace("/*__REVIEW_DATA__*/ {}", compact_json(review).decode()))
    shutil.copyfile(Path(__file__).with_name("README.md"), out / "README.md")
    print(f"{out}: {comparison['matchedGroups']} matched groups, {sum(row['jsonBytes'] for row in comparison['tracks'].values())} JSON bytes")


if __name__ == "__main__":
    main()
