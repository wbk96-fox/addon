#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Lokalny serwer repozytorium wtyczek PL dla NuvioTV.

Różnice względem `python3 -m http.server`:
  * /health — sprawdzenie życia (aplikacja i przeglądarka), bez 404 w logach,
  * poprawne typy MIME (.json → application/json; .js → application/javascript),
  * nagłówki CORS i Cache-Control: no-store (manifest zawsze świeży),
  * czytelne logi po polsku.

Użycie:
  python3 server.py [port]        # domyślnie 8000, katalog = repozytorium
  python3 server.py 8000 --dir /inny/katalog
"""
import argparse
import os
import sys
from datetime import datetime
from http.server import HTTPServer, SimpleHTTPRequestHandler

KATALOG = os.path.dirname(os.path.abspath(__file__))

MIME = {
    ".json": "application/json; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".svg": "image/svg+xml",
}


class Handler(SimpleHTTPRequestHandler):
    directory_override = KATALOG

    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=Handler.directory_override, **kwargs)

    def guess_type(self, path):
        ext = os.path.splitext(str(path))[1].lower()
        return MIME.get(ext) or super().guess_type(path)

    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "User-Agent, Accept, If-None-Match")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path.split("?")[0] in ("/health", "/healthz"):
            body = '{"ok":true,"status":"SERWER OK","repo":"Polskie Źródła PL","czas":"%s"}' % datetime.now().isoformat(timespec="seconds")
            data = body.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            self.log_message('HEALTH 200')
            return
        super().do_GET()

    def log_message(self, fmt, *args):
        sys.stdout.write("[%s] %s\n" % (datetime.now().strftime("%H:%M:%S"), fmt % args))
        sys.stdout.flush()


def main():
    global KATALOG
    ap = argparse.ArgumentParser(description="Serwer repozytorium wtyczek PL")
    ap.add_argument("port", nargs="?", type=int, default=8000)
    ap.add_argument("--dir", default=None, help="katalog repozytorium (domyślnie: katalog skryptu)")
    args = ap.parse_args()

    if args.dir:
        KATALOG = os.path.abspath(args.dir)
    Handler.directory_override = KATALOG

    addr = ("", args.port)
    try:
        httpd = HTTPServer(addr, Handler)
    except OSError as e:
        print("BŁĄD: nie można nasłuchiwać na porcie %s: %s" % (args.port, e))
        print("Spróbuj innego portu, np.: python3 server.py 8080")
        sys.exit(1)

    # Wypisz lokalne adresy, żeby łatwo dodać repozytorium w aplikacji.
    ipy = None
    try:
        import socket
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ipy = s.getsockname()[0]
        s.close()
    except OSError:
        pass

    print("Serwer repozytorium PL działa.")
    print("  Lokalnie:   http://127.0.0.1:%d  (zdrowie: /health)" % args.port)
    if ipy:
        print("  W sieci:    http://%s:%d   <- ten adres wpisz w aplikacji NuvioTV" % (ipy, args.port))
    print("  Katalog:    %s" % KATALOG)
    print("Zatrzymanie: Ctrl+C")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\nZatrzymano serwer.")


if __name__ == "__main__":
    main()
