"""Package the committed STEP 04 app and the untouched STEP 01 recovery data."""

import argparse
from pathlib import Path
import subprocess
from zipfile import ZIP_DEFLATED, ZipFile


HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
BASE = "9dac3c1b658eebdee82a3d5ab05fdc5efdabd1e3"


def git(*args):
    return subprocess.check_output(["git", *args], cwd=REPO)


def package(target, previous, preview):
    head = git("rev-parse", "HEAD").decode().strip()
    subprocess.run(["python3", str(HERE / "prepare-step04.py"), str(preview), "--check"], check=True)
    with ZipFile(previous) as base, ZipFile(preview) as accepted:
        if base.read("development/commit.txt").decode().strip() != BASE:
            raise ValueError("Expected the STEP 02.1 release archive")
        runtime = [name for name in base.namelist() if name.startswith("app/")]
        runtime.extend(["app/melody-sync.js", "app/melody-data/step04-rms.json"])
        analysis = {name: accepted.read(name.replace("development/step01/", "analysis/"))
                    for name in base.namelist() if name.startswith("development/step01/")}
        if any(base.read(name) != payload for name, payload in analysis.items()):
            raise ValueError("Original analysis differs between STEP 02.1 and STEP 03.3")
        contents = {name: git("show", head + ":SEEEN_AUDIO_PLAYER/" + name.removeprefix("app/"))
                    for name in runtime}
        for name in runtime:
            if name.startswith(("app/audio/", "app/knock-data/")) and contents[name] != base.read(name):
                raise ValueError(f"Committed media and knock assets must match STEP 02.1: {name}")
        rms = "melody-data/step04-rms.json"
        if contents["app/" + rms] != (REPO / "SEEEN_AUDIO_PLAYER" / rms).read_bytes():
            raise ValueError("Committed RMS data differs from the checked source")

    with ZipFile(target, "x", ZIP_DEFLATED) as archive:
        for name, payload in {**contents, **analysis}.items():
            archive.writestr(name, payload)
        archive.writestr("development/commit.txt", head + "\n")
        archive.writestr("README.md", git("show", head + ":tools/v04-audio/STEP04.md"))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("step021_zip", type=Path)
    parser.add_argument("step033_zip", type=Path)
    args = parser.parse_args()
    if args.output.resolve().is_relative_to(REPO):
        parser.error("store the private package outside the repository")
    package(args.output, args.step021_zip, args.step033_zip)
