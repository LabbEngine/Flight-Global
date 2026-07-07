# FlightGlobe — project contract

## Before you push

Nothing to add — every asset the app needs is already committed (textures, vendored libraries, data). Largest file is ~5 MB, well under GitHub's limits. If you ever want to regenerate or upgrade the textures, they came from https://www.solarsystemscope.com/textures/ (CC BY 4.0): `8k_earth_daymap.jpg` → `assets/textures/earth_day_8k.jpg`, `8k_earth_nightmap.jpg` → `assets/textures/earth_night_8k.jpg` (committed but not currently rendered — the globe is fully daylit; kept for a future night mode), `8k_earth_clouds.jpg` (downscaled to 4096×2048) → `assets/textures/earth_clouds_4k.jpg`.

## Push-identical contract

Everything created here is committed and byte-identical to what runs locally:

- Relative paths only — never absolute paths like `C:\Users\...` or `/home/...`.
- No build step, no generated artifacts. The committed repo **is** the whole app.
- Nothing required to run may sit in `.gitignore` (only OS junk, editor files, caches).
- LF line endings enforced via `.gitattributes` (`* text=auto eol=lf`).
- No Git LFS. Every single file stays under 50 MB; the whole repo well under 300 MB.

## Core constraints

- Pure frontend: HTML + CSS + JS + Three.js. No backend, no app logic in Python.
- Offline after clone: no CDNs for code, no API keys anywhere. Libraries are vendored in `/vendor`; textures/data are committed. **One intentional exception:** the deep-zoom detail layer (`js/tiles.js`) streams Esri World Imagery tiles when you zoom in close *and* are online. It is keyless (no billing, unlike Google Maps), and degrades silently to the base 8K globe when offline — so a fresh clone still runs and looks right with the network off; only the extra close-up satellite detail needs internet.
- Single 8K JPG Earth texture (8192×4096) — not 16K (GPU texture-size limits), not 2K (blurry).
- Runs with `python run.py` (a ~10-line static server + browser launch, nothing more).
- Timezones via the browser's `Intl` API with IANA zone names — no tz data files.
- UI is glass on dark — dark glass or lighter smoke glass, never white panels.
- The fleet is exactly four aircraft, chosen through the silhouette picker in the planner.

## Spirit

Personal hobby toy: prioritize looks and fun, skip tests, logging, and formal docs. A working simple thing beats a broken ambitious one.
