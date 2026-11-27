"""Prepare or publish only the SEEEN V04 app to its dedicated Pages repository."""

import argparse
import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import subprocess
import tempfile

REPO = Path(__file__).resolve().parents[2]
DESTINATION = "https://github.com/041231horiko-cyber/SEEEN_AUDIO_PLAYER_V04_PREVIEW.git"
PREFIX = "Deploy SEEEN V04 "
V04_BASE = "8395f21eb0fcaf8b093f311e00e05f9dfd3ef2e9"


def git(*args, cwd=REPO):
    return subprocess.check_output(["git", *args], cwd=cwd)


def replace_once(source, old, new):
    if source.count(old) != 1:
        raise ValueError(f"Unexpected deployment template: {old}")
    return source.replace(old, new, 1)


def digest(payload):
    return hashlib.sha256(payload).hexdigest()


def source_files(revision):
    def read(name):
        return git("show", revision + ":SEEEN_AUDIO_PLAYER/" + name)

    worker = read("service-worker.js").decode()
    paths = []
    for name in ("APP_ASSETS", "AUDIO_ASSETS"):
        declaration = re.search(r"var " + name + r" = (\[[\s\S]*?\]);", worker)
        paths.extend(json.loads(declaration[1]))
    if len(paths) != len(set(paths)) or "./" not in paths or "./index.html" not in paths:
        raise ValueError("Unexpected Service Worker URL list")
    for asset in paths:
        path = PurePosixPath(asset)
        if not asset.startswith("./") or ".." in path.parts or (asset != "./" and
                not re.fullmatch(r"[\w/-]+\.(?:html|css|js|ttf|json|png|m4a|wav)", asset[2:])):
            raise ValueError(f"Unexpected deployment asset: {asset}")
    files = {name[2:]: read(name[2:]) for name in paths if name != "./"}
    files.update({name: read(name) for name in ["Barlow-OFL.txt", "service-worker.js"]})
    files[".nojekyll"] = b""
    return files, paths


INTEGRITY = """
// Generated for this immutable release. Reject CDN responses from another release.
var RELEASE_SHA256 = %s;
async function releaseResponse(response, url) {
  var key = new URL(url, SCOPE);
  key.search = "";
  key.hash = "";
  var expected = key.href.startsWith(SCOPE) && RELEASE_SHA256["./" + key.href.slice(SCOPE.length)];
  if (response.status !== 200 || !expected) throw new Error("Missing release asset: " + key.pathname);
  var bytes = await response.clone().arrayBuffer();
  var hash = await self.crypto.subtle.digest("SHA-256", bytes);
  var actual = Array.from(new Uint8Array(hash), function (byte) {
    return byte.toString(16).padStart(2, "0");
  }).join("");
  if (actual !== expected) throw new Error("Release asset mismatch: " + key.pathname);
  return response;
}
"""


def build(revision):
    files, paths = source_files(revision)
    page = files["index.html"].decode()
    page = replace_once(page, '<meta charset="utf-8">',
                        '<meta charset="utf-8">\n    <meta name="robots" content="noindex, nofollow, noarchive">')
    page = re.sub(r'(name="apple-mobile-web-app-title" content=")[^"]+',
                  r'\g<1>SEEEN V04', page, count=1)
    files["index.html"] = page.encode()
    manifest = json.loads(files["manifest.json"])
    manifest.update({"id": "./", "start_url": "./", "scope": "./",
                     "name": "SEEEN V04 Preview", "short_name": "SEEEN V04"})
    files["manifest.json"] = (json.dumps(manifest, indent=2, ensure_ascii=False) + "\n").encode()

    # Name the cache from the generated content, so publishing a previous
    # revision reuses only a byte-identical release, even across rollbacks.
    fingerprint = {name: digest(payload) for name, payload in sorted(files.items())}
    fingerprint["integrityTemplate"] = digest(INTEGRITY.encode())
    cache = "seeen-v04-preview-" + digest(json.dumps(fingerprint).encode())[:24] + ":"
    for name in ("player.js", "service-worker.js"):
        new, count = re.subn(r'"seeen-v04-[a-z0-9.-]+:"', json.dumps(cache), files[name].decode())
        if count != 1:
            raise ValueError(f"Unexpected cache declaration: {name}")
        files[name] = new.encode()
    hashes = {asset: digest(files[asset[2:] or "index.html"]) for asset in paths}
    worker = files["service-worker.js"].decode()
    worker = replace_once(worker, "\nfunction mediaResponse", INTEGRITY % json.dumps(hashes) + "\nfunction mediaResponse")
    worker = replace_once(worker, "  await cache.put(url,", "  await releaseResponse(response, url);\n  await cache.put(url,")
    worker = replace_once(worker, "  return mediaResponse(response, cacheKey.url);",
                          "  await releaseResponse(response, cacheKey.url);\n  return mediaResponse(response, cacheKey.url);")
    worker = replace_once(worker, "  return fetch(request);",
                          "  return fetch(request).then(function (response) { return releaseResponse(response, request.url); });")
    worker = replace_once(worker, "        return cached || fetch(event.request);",
                          "        return cached || fetch(event.request).then(function (response) {\n"
                          "          return releaseResponse(response, event.request.url);\n        });")
    files["service-worker.js"] = worker.encode()
    return files, cache


def write_files(folder, files):
    for name, payload in files.items():
        path = folder / name
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(payload)


def publish(revision, files):
    with tempfile.TemporaryDirectory(prefix="seeen-v04-pages-") as temp:
        checkout = Path(temp)
        git("init", "--quiet", "--initial-branch=main", cwd=checkout)
        git("remote", "add", "origin", DESTINATION, cwd=checkout)
        refs = git("ls-remote", "--heads", "origin", cwd=checkout)
        if refs:
            if not any(line.endswith(b"\trefs/heads/main") for line in refs.splitlines()):
                raise ValueError("Preview repository exists but has no main branch")
            git("fetch", "--no-tags", "origin", "refs/heads/main", cwd=checkout)
            previous = set(git("ls-tree", "-r", "--name-only", "FETCH_HEAD", cwd=checkout).decode().splitlines())
            if (not git("log", "-1", "--format=%s", "FETCH_HEAD", cwd=checkout).decode().startswith(PREFIX)
                    or ".nojekyll" not in previous):
                raise ValueError("Preview main does not contain a prior SEEEN deployment. Use an empty repository.")
            git("switch", "--quiet", "-c", "main", "FETCH_HEAD", cwd=checkout)
            for name in previous - files.keys():
                (checkout / name).unlink()
        write_files(checkout, files)
        git("add", "--all", cwd=checkout)
        if not git("diff", "--cached", "--name-only", cwd=checkout):
            print("Preview main already contains this release")
            return
        git("-c", "user.name=SEEEN V04 Preview",
            "-c", "user.email=285568847+041231horiko-cyber@users.noreply.github.com",
            "commit", "--quiet", "-m", PREFIX + revision, cwd=checkout)
        git("push", "origin", "HEAD:refs/heads/main", cwd=checkout)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("revision", help="V04 development branch or commit to publish")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--output", type=Path, help="write the site to a new empty directory")
    action.add_argument("--publish", action="store_true", help="push the release to the separate preview repo only")
    args = parser.parse_args()
    revision = git("rev-parse", "--verify", args.revision + "^{commit}").decode().strip()
    if subprocess.run(["git", "merge-base", "--is-ancestor", V04_BASE, revision], cwd=REPO).returncode:
        parser.error("revision must descend from the verified V04 STEP 04 commit")
    files, cache = build(revision)
    if args.publish:
        publish(revision, files)
    else:
        output = args.output.resolve()
        if output == REPO or REPO in output.parents or (output.exists() and any(output.iterdir())):
            parser.error("use a new empty directory outside the source repository")
        output.mkdir(parents=True, exist_ok=True)
        write_files(output, files)
    print(f"{revision} · {len(files)} files · {cache}")


if __name__ == "__main__":
    main()
