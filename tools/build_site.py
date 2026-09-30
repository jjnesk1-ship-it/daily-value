"""Build Daily Value as an installable web app for GitHub Pages.

Writes _site/: the page as a full HTML document with the app manifest, icons and
service worker added, plus js/ and data/. The claude.ai artifact keeps using
index.html as it is; everything the installed app adds lives in pwa/.

Usage:
  python tools/build_site.py            build _site/
  python tools/build_site.py --publish  build, then commit _site/ to the gh-pages branch
                                        (then run: git push origin gh-pages)
"""

import hashlib
import html
import json
import os
import re
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_site")
PWA = os.path.join(ROOT, "pwa")

# The same small reset the artifact host adds (see tools/dev_server.py), plus what an
# installable app needs: the manifest, icons, theme colors and home-screen settings.
# viewport-fit=cover lets the app run edge to edge, so the root keeps clear of the
# notch and home indicator on every side.
HEAD = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="description" content="Track food, nutrients and weight with USDA and brand-name food data.">
<meta name="theme-color" media="(prefers-color-scheme: light)" content="#f3f4f1">
<meta name="theme-color" media="(prefers-color-scheme: dark)" content="#0c0e0d">
<link rel="manifest" href="manifest.webmanifest">
<link rel="icon" type="image/png" sizes="192x192" href="icons/icon-192.png">
<link rel="apple-touch-icon" sizes="180x180" href="icons/apple-touch-icon.png">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Daily Value">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<style>:root{color-scheme:light;padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)}body{margin:0;font:14px system-ui,sans-serif;background:#fafaf8}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
"""

APP_SCRIPT = '<script src="js/app.js"></script>'
# Settings, email accounts and install support, loaded before the app first draws.
PWA_SCRIPTS = ["js/config.js", "js/account.js", "js/pwa.js"]
# Stored when the app is installed; the other data files are stored the first time they're used.
DATA_AT_INSTALL = ["data/foods.txt", "data/b/meta.json"]
# Written with LF line endings whatever the checkout uses, so the same commit always builds the same bytes.
TEXT_TYPES = {".html", ".js", ".json", ".webmanifest", ".txt", ".css", ".csv", ".md"}
ZXING_URL = re.compile(r"https://cdn\.jsdelivr\.net/npm/@zxing/[^'\"\s]+")
CDN_SCRIPT = re.compile(r'<script crossorigin="anonymous" src="(https://[^"]+)"')
CDN_STYLE = re.compile(r'<link rel="stylesheet" crossorigin="anonymous" href="(https://[^"]+)"')


def git(*args, env=None, check=True):
    r = subprocess.run(["git", *args], cwd=ROOT, env=env, capture_output=True, text=True)
    if check and r.returncode:
        sys.exit("git " + " ".join(args) + " failed:\n" + r.stderr)
    return r.stdout.strip()


def tracked(*paths):
    """Files git tracks under these paths, so stray, ignored or half-built files never get published."""
    return sorted(p for p in git("ls-files", "-z", "--", *paths).split("\0") if p)


def put(src, dest, data=None):
    """Copy src (relative to the project) to dest (relative to _site/), or write data; text gets LF endings."""
    if data is None:
        with open(os.path.join(ROOT, src), "rb") as f:
            data = f.read()
    if os.path.splitext(dest)[1] in TEXT_TYPES:
        data = data.replace(b"\r\n", b"\n")
    path = os.path.join(OUT, dest)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)


def sha256(dest):
    with open(os.path.join(OUT, dest), "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def version(paths, hashes):
    return hashlib.sha256("".join(p + hashes[p] for p in paths).encode("utf-8")).hexdigest()[:12]


def build():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    data_files = tracked("data")
    js_files = tracked("js")
    if "data/foods.txt" not in data_files or "js/app.js" not in js_files:
        sys.exit("js/ and data/ need to be committed before building")
    for p in data_files + js_files:
        put(p, p)
    icons = []
    for p in tracked("pwa/icons"):
        icons.append("icons/" + os.path.basename(p))
        put(p, icons[-1])
    for dest in PWA_SCRIPTS:
        put("pwa/" + os.path.basename(dest), dest)
    put("pwa/manifest.webmanifest", "manifest.webmanifest")

    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        page = f.read().replace("\r\n", "\n")
    if page.count(APP_SCRIPT) != 1:
        sys.exit("index.html must load js/app.js exactly once")
    page = page.replace(APP_SCRIPT, "".join('<script src="%s"></script>\n' % f for f in PWA_SCRIPTS) + APP_SCRIPT)
    # Load CDN files with CORS, so the service worker can check and store real responses (not opaque ones).
    for old, new in (
        ('<script src="https://cdn.jsdelivr.net/', '<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/'),
        ('<link rel="stylesheet" href="https://fonts.googleapis.com/', '<link rel="stylesheet" crossorigin="anonymous" href="https://fonts.googleapis.com/'),
    ):
        if old not in page:
            sys.exit("index.html no longer has " + old)
        page = page.replace(old, new)
    put(None, "index.html", (HEAD + page.rstrip() + "\n</body>\n</html>\n").encode("utf-8"))

    # Files from other sites for the worker to store at install: the page's scripts (required, since Preact
    # draws everything), its font stylesheet, and the ZXing barcode reader js/branded.js loads when needed.
    cdn = [[html.unescape(u), True] for u in CDN_SCRIPT.findall(page)]
    cdn += [[html.unescape(u), False] for u in CDN_STYLE.findall(page)]
    with open(os.path.join(ROOT, "js", "branded.js"), encoding="utf-8") as f:
        cdn += [[u, False] for u in sorted(set(ZXING_URL.findall(f.read())))]
    if not cdn or not cdn[0][1]:
        sys.exit("couldn't find the page's library scripts in index.html")

    app_files = ["index.html", "manifest.webmanifest"] + sorted(PWA_SCRIPTS + js_files) + icons
    hashes = {p: sha256(p) for p in app_files + data_files}
    with open(os.path.join(PWA, "sw.js"), encoding="utf-8") as f:
        sw = f.read()
    for name, value in (
        ("__APP_VERSION__", version(app_files, hashes)),
        ("__DATA_VERSION__", version(data_files, hashes)),
        ("__HASHES__", json.dumps({p: h[:16] for p, h in hashes.items()}, separators=(",", ":"))),
        ("__APP_FILES__", json.dumps(app_files)),
        ("__DATA_FILES__", json.dumps(DATA_AT_INSTALL)),
        ("__CDN_FILES__", json.dumps(cdn)),
    ):
        if name not in sw:
            sys.exit("pwa/sw.js is missing " + name)
        sw = sw.replace(name, value)
    put(None, "sw.js", sw.encode("utf-8"))
    # Serve every file as is (no Jekyll processing on GitHub Pages).
    put(None, ".nojekyll", b"")
    size = sum(os.path.getsize(os.path.join(dp, n)) for dp, _, ns in os.walk(OUT) for n in ns)
    print(f"Built _site/: {len(app_files)} app files, {len(data_files)} data files, {len(cdn)} CDN files, {size / 1e6:.1f} MB")


def is_ancestor(a, b):
    return subprocess.run(["git", "merge-base", "--is-ancestor", a, b], cwd=ROOT, capture_output=True).returncode == 0


def pages_parent():
    """The commit to build on: the newer of the local and remote gh-pages, so the push fast-forwards."""
    git("fetch", "-q", "origin", "gh-pages", check=False)  # fine when there's no remote branch yet
    local = git("rev-parse", "--verify", "-q", "refs/heads/gh-pages^{commit}", check=False)
    remote = git("rev-parse", "--verify", "-q", "refs/remotes/origin/gh-pages^{commit}", check=False)
    if not local or not remote:
        return local or remote
    if is_ancestor(local, remote):
        return remote
    if is_ancestor(remote, local):
        return local
    sys.exit("Your gh-pages branch and origin/gh-pages have diverged; sort that out before publishing.")


def publish():
    """Commit _site/ as the next gh-pages commit, without touching the working branch or its index."""
    index = git("rev-parse", "--git-path", "pages-index")  # inside .git, and right in linked worktrees too
    env = dict(os.environ, GIT_INDEX_FILE=index if os.path.isabs(index) else os.path.join(ROOT, index))
    git("--work-tree", OUT, "add", "-A", ".", env=env)
    tree = git("write-tree", env=env)
    parent = pages_parent()
    if parent and git("rev-parse", parent + "^{tree}") == tree:
        git("update-ref", "refs/heads/gh-pages", parent)
        print("gh-pages already has this build.")
        return
    args = ["commit-tree", tree, "-m", "Build site from " + git("rev-parse", "--short", "HEAD")]
    if parent:
        args += ["-p", parent]
    commit = git(*args)
    git("update-ref", "refs/heads/gh-pages", commit)
    print("Committed the build to gh-pages as " + commit[:7] + ". Push it with: git push origin gh-pages")


if __name__ == "__main__":
    build()
    if "--publish" in sys.argv[1:]:
        publish()
