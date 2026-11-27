"""Extract the unmodified STEP 01 RMS series from the verified STEP 03.3 ZIP."""

import argparse
import hashlib
import json
from pathlib import Path
from zipfile import ZipFile


APP = Path(__file__).resolve().parents[2] / "SEEEN_AUDIO_PLAYER"
DATA = APP / "melody-data/step04-rms.json"
TRACKS = ("bright-wide", "bright-narrow", "dark-wide", "dark-narrow")


def extract(archive):
    profiles, tracks = {}, {}
    with ZipFile(archive) as original:
        manifest = {row["filename"]: row["sha256"] for row in
                    json.loads(original.read("analysis/audio-manifest.json"))}
        for key in TRACKS:
            source = json.loads(original.read(f"analysis/{key}.json"))
            compact = json.loads((APP / "knock-data" / f"{key}.json").read_bytes())
            filename, sha = source["audioFile"], source["audioSha256"]
            audio = (APP / "audio" / filename).read_bytes()
            if (source["trackId"] != key or source["sampleInterval"] != 0.05
                    or source["audioDuration"] != 124.7
                    or any(source[k] != v for k, v in compact.items())
                    or hashlib.sha256(audio).hexdigest() != manifest[filename] or manifest[filename] != sha
                    or audio != original.read(f"audio/{filename}")):
                raise ValueError(f"Unexpected source analysis or audio for {key}")
            theme = key.split("-")[0]
            rms = source["melodyFeatures"]["rmsDbfs"]
            tenths = [round(value * 10) for value in rms]
            if len(rms) != 2494 or [value / 10 for value in tenths] != rms:
                raise ValueError(f"RMS cannot be packed losslessly for {key}")
            if profiles.setdefault(theme, tenths) != tenths:
                raise ValueError(f"Different RMS series within {theme}")
            tracks[key] = {"profile": theme, "audioFile": filename, "audioSha256": sha}
    return {"schemaVersion": 1, "sampleInterval": 0.05, "audioDuration": 124.7,
            "tracks": tracks, "rmsTenthsDbfs": profiles}


def serialized(extracted):
    return (json.dumps(extracted, separators=(",", ":")) + "\n").encode()


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("step033_zip", type=Path)
    parser.add_argument("--check", action="store_true", help="Compare with the tracked data")
    args = parser.parse_args()
    payload = serialized(extract(args.step033_zip))
    if args.check:
        if DATA.read_bytes() != payload:
            parser.error("tracked RMS data differs from the source")
    else:
        DATA.write_bytes(payload)
    print(f"{len(payload)} bytes, 4 audio hashes and 2 lossless RMS series verified")
