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
import json
import os
import shutil
import subprocess
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "_site")
PWA = os.path.join(ROOT, "pwa")

# The same small reset the artifact host adds (see tools/dev_server.py), plus what an
# installable app needs: the manifest, icons, theme colors and home-screen settings.
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
<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif;background:#fafaf8}img{max-width:100%}[hidden]{display:none!important}</style>
</head>
<body>
"""

APP_SCRIPT = '<script src="js/app.js"></script>'
PWA_SCRIPT = '<script src="js/pwa.js"></script>'
# Stored when the app is installed; the other data files are stored the first time they're used.
DATA_AT_INSTALL = ["data/foods.txt", "data/b/meta.json"]


def files_under(base, sub):
    out = []
    for dirpath, _, names in os.walk(os.path.join(base, sub)):
        for n in names:
            out.append(os.path.relpath(os.path.join(dirpath, n), base).replace(os.sep, "/"))
    return sorted(out)


def digest(base, paths):
    h = hashlib.sha256()
    for p in paths:
        h.update(p.encode("utf-8") + b"\0")
        with open(os.path.join(base, p), "rb") as f:
            h.update(f.read())
    return h.hexdigest()[:12]


def build():
    if os.path.isdir(OUT):
        shutil.rmtree(OUT)
    os.makedirs(OUT)
    shutil.copytree(os.path.join(ROOT, "js"), os.path.join(OUT, "js"))
    shutil.copytree(os.path.join(ROOT, "data"), os.path.join(OUT, "data"))
    shutil.copytree(os.path.join(PWA, "icons"), os.path.join(OUT, "icons"))
    shutil.copyfile(os.path.join(PWA, "pwa.js"), os.path.join(OUT, "js", "pwa.js"))
    shutil.copyfile(os.path.join(PWA, "manifest.webmanifest"), os.path.join(OUT, "manifest.webmanifest"))

    with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
        page = f.read()
    if page.count(APP_SCRIPT) != 1:
        sys.exit("index.html must load js/app.js exactly once")
    # pwa.js sets DV.pwa before the app first draws.
    page = page.replace(APP_SCRIPT, PWA_SCRIPT + "\n" + APP_SCRIPT)
    # Load CDN files with CORS, so the service worker can check and store real responses (not opaque ones).
    for old, new in (
        ('<script src="https://cdn.jsdelivr.net/', '<script crossorigin="anonymous" src="https://cdn.jsdelivr.net/'),
        ('<link rel="stylesheet" href="https://fonts.googleapis.com/', '<link rel="stylesheet" crossorigin="anonymous" href="https://fonts.googleapis.com/'),
    ):
        if old not in page:
            sys.exit("index.html no longer has " + old)
        page = page.replace(old, new)
    with open(os.path.join(OUT, "index.html"), "w", encoding="utf-8", newline="\n") as f:
        f.write(HEAD + page.rstrip() + "\n</body>\n</html>\n")

    app_files = ["index.html", "manifest.webmanifest"] + files_under(OUT, "js") + files_under(OUT, "icons")
    data_files = files_under(OUT, "data")
    with open(os.path.join(PWA, "sw.js"), encoding="utf-8") as f:
        sw = f.read()
    sw = (
        sw.replace("__APP_VERSION__", digest(OUT, app_files))
        .replace("__DATA_VERSION__", digest(OUT, data_files))
        .replace("__APP_FILES__", json.dumps(app_files))
        .replace("__DATA_FILES__", json.dumps(DATA_AT_INSTALL))
    )
    with open(os.path.join(OUT, "sw.js"), "w", encoding="utf-8", newline="\n") as f:
        f.write(sw)
    # Serve every file as is (no Jekyll processing on GitHub Pages).
    open(os.path.join(OUT, ".nojekyll"), "w").close()
    size = sum(os.path.getsize(os.path.join(OUT, p)) for p in files_under(OUT, ""))
    print(f"Built _site/: {len(app_files)} app files, {len(data_files)} data files, {size / 1e6:.1f} MB")


def git(*args, env=None, check=True):
    r = subprocess.run(["git", *args], cwd=ROOT, env=env, capture_output=True, text=True)
    if check and r.returncode:
        sys.exit("git " + " ".join(args) + " failed:\n" + r.stderr)
    return r.stdout.strip()


def publish():
    """Commit _site/ as the next gh-pages commit, without touching the working branch."""
    env = dict(os.environ, GIT_INDEX_FILE=os.path.join(ROOT, ".git", "pages-index"))
    git("--work-tree", OUT, "add", "-A", ".", env=env)
    tree = git("write-tree", env=env)
    parent = git("rev-parse", "--verify", "-q", "refs/heads/gh-pages^{commit}", check=False)
    if parent and git("rev-parse", parent + "^{tree}") == tree:
        print("gh-pages already has this build.")
        return
    source = git("rev-parse", "--short", "HEAD")
    args = ["commit-tree", tree, "-m", "Build site from " + source]
    if parent:
        args += ["-p", parent]
    commit = git(*args)
    git("update-ref", "refs/heads/gh-pages", commit)
    print("Committed the build to gh-pages as " + commit[:7] + ". Push it with: git push origin gh-pages")


if __name__ == "__main__":
    build()
    if "--publish" in sys.argv[1:]:
        publish()
