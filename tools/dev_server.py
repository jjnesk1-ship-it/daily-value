"""Local preview for Daily Value.

Serves the project folder and wraps index.html in the same minimal skeleton the
artifact host adds at publish time (doctype, charset, viewport, small reset).

Usage: python tools/dev_server.py [port]
"""

import http.server
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HEAD = (
    '<!doctype html><html lang="en"><head><meta charset="utf-8">'
    '<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">'
    "<style>:root{color-scheme:light;padding-top:env(safe-area-inset-top,0px);"
    "padding-bottom:env(safe-area-inset-bottom,0px)}body{margin:0;font:14px system-ui,sans-serif;"
    "background:#fafaf8}img{max-width:100%}[hidden]{display:none!important}</style></head><body>"
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=ROOT, **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        path = self.path.split("?")[0].split("#")[0]
        if path in ("/", "/index.html"):
            with open(os.path.join(ROOT, "index.html"), encoding="utf-8") as f:
                body = (HEAD + f.read() + "</body></html>").encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
