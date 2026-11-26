"""Package STEP 02 for private testing, including recovery data outside the web root."""

import argparse
import hashlib
import json
from pathlib import Path
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile


REPO = Path(__file__).resolve().parents[2]
APP = REPO / "SEEEN_AUDIO_PLAYER"
APP_FILES = (
    "index.html", "style.css", "knock-sync.js", "particle-field.js", "player.js", "field.js",
    "service-worker.js", "manifest.json", "BarlowCondensed-SemiBold.ttf", "Barlow-OFL.txt",
    "icons/apple-touch-icon.png", "icons/icon-180.png", "icons/icon-192.png", "icons/icon-512.png",
    "audio/ui-switch.wav",
)


def package(archive_path, analysis, input_zip):
    head = subprocess.check_output(["git", "-C", str(REPO), "rev-parse", "HEAD"], text=True).strip()
    with ZipFile(input_zip) as original:
        manifest = original.read("manifest.json")
        recovery = []
        runtime = list(APP_FILES)
        for row in json.loads(manifest):
            filename = row["filename"]
            key = filename.split("_loop_")[0].replace("_", "-")
            raw = (APP / "audio" / filename).read_bytes()
            if raw != original.read(filename) or hashlib.sha256(raw).hexdigest() != row["sha256"]:
                raise ValueError(f"Audio verification failed: {filename}")
            full = analysis / f"{key}.json"
            metadata = json.loads(full.read_bytes())
            compact = json.loads((APP / "knock-data" / f"{key}.json").read_bytes())
            if metadata["audioSha256"] != row["sha256"] or any(metadata[k] != v for k, v in compact.items()):
                raise ValueError(f"STEP 01 analysis verification failed: {key}")
            runtime.extend((f"audio/{filename}", f"knock-data/{key}.json"))
            recovery.append(full)
    with ZipFile(archive_path, "x", compression=ZIP_DEFLATED) as archive:
        for name in runtime:
            archive.write(APP / name, "app/" + name)
        for file in recovery:
            archive.write(file, "development/step01/" + file.name)
        archive.writestr("development/step01/audio-manifest.json", manifest)
        archive.writestr("development/commit.txt", head + "\n")
        archive.write(Path(__file__).with_name("STEP02.md"), "README.md")
    print(archive_path)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("analysis_output", type=Path)
    parser.add_argument("source_zip", type=Path)
    options = parser.parse_args()
    if options.archive.resolve().is_relative_to(REPO):
        parser.error("store the private package outside the repository")
    package(options.archive, options.analysis_output, options.source_zip)
