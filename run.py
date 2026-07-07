#!/usr/bin/env python3
"""Serves FocusAir on localhost and opens your browser. No app logic here —
the browser just refuses to load textures/JSON from file://, so we serve them."""
import os, threading, webbrowser
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler

os.chdir(os.path.dirname(os.path.abspath(__file__)))
for port in range(8003, 8014):
    try:
        server = ThreadingHTTPServer(("127.0.0.1", port), SimpleHTTPRequestHandler)
        break
    except OSError:
        continue
else:
    raise SystemExit("FocusAir: no free port in 8003-8013 — close another server and retry.")
threading.Timer(0.6, lambda: webbrowser.open(f"http://localhost:{port}")).start()
print(f"FocusAir → http://localhost:{port}   (Ctrl+C to stop)")
try:
    server.serve_forever()
except KeyboardInterrupt:
    print("\nBye!")
