"""Verify original audio and prepare the compact playback datasets for STEP 02."""

import argparse
import json
from pathlib import Path
import shutil

from analyze import DURATION, FILES, TRACKS, digest, read_inputs


def prepare(source_zip, analysis, app):
    originals = read_inputs(source_zip)
    verified = {}
    for track in TRACKS:
        raw, manifest = originals[track]
        from_analysis = (analysis / "audio" / FILES[track]).read_bytes()
        data = json.loads((analysis / f"{track}.json").read_bytes())
        if raw != from_analysis or data["audioSha256"] != digest(raw):
            raise ValueError(f"Original/STEP 01 SHA-256 mismatch: {track}")
        identity = (data["schemaVersion"], data["trackId"], data["audioFile"], data["audioDuration"])
        if identity != (1, track, FILES[track], DURATION):
            raise ValueError(f"Invalid STEP 01 identity: {track}")
        hits = data["knockEvents"]
        times = [hit["time"] for hit in hits]
        if len(times) != 35 or times != sorted(set(times)) or not all(0 <= t < DURATION for t in times):
            raise ValueError(f"Invalid direct event times: {track}")
        if sum(len(hit["echoes"]) for hit in hits) != (27 if track.endswith("narrow") else 0):
            raise ValueError(f"Invalid reflection candidate count: {track}")
        # Keep full STEP 01 JSON in the private recovery package. No melody
        # arrays are loaded by the app in this step.
        keys = ("schemaVersion", "trackId", "audioFile", "audioSha256", "audioDuration", "knockEvents")
        verified[track] = raw, manifest, {key: data[key] for key in keys}

    (app / "audio").mkdir(exist_ok=True)
    (app / "knock-data").mkdir(exist_ok=True)
    for track, (raw, manifest, compact) in verified.items():
        (app / "audio" / FILES[track]).write_bytes(raw)
        (app / "knock-data" / f"{track}.json").write_text(
            json.dumps(compact, ensure_ascii=False, separators=(",", ":")) + "\n",
            encoding="utf-8",
        )
        print(track, manifest["bytes"], manifest["sha256"])


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("source_zip", type=Path)
    parser.add_argument("analysis", type=Path)
    parser.add_argument("app", type=Path)
    args = parser.parse_args()
    prepare(args.source_zip, args.analysis, args.app)
