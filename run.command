#!/bin/bash
# FocusAir launcher for macOS — double-click this file to start the app.
# It finds Python 3 for you, so you never have to care about "python" vs "python3".
cd "$(dirname "$0")" || exit 1

if python3 --version >/dev/null 2>&1; then
  PY=python3
elif python --version >/dev/null 2>&1; then
  PY=python
else
  echo "FocusAir needs Python 3, which isn't installed on this Mac yet."
  echo
  echo "Install it, then double-click this file again:"
  echo "  1. Open the Terminal app."
  echo "  2. Run:  xcode-select --install"
  echo "  3. Click Install and wait for it to finish (a few minutes)."
  echo
  echo "(Or download Python from https://www.python.org/downloads/ instead.)"
  echo
  read -n 1 -s -r -p "Press any key to close this window..."
  exit 1
fi

echo "Starting FocusAir with $PY — your browser will open in a moment."
echo "Leave this window open while you fly; close it or press Ctrl+C to stop."
exec "$PY" run.py
