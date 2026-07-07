# FlyCool 🌍✈️

**A beautiful interactive 3D globe you can plan and fly imaginary flights on** — spin the Earth, pick a destination and an origin, board with a real boarding pass, and watch a little aircraft trace the great circle across the planet. It all runs in your browser on your own computer.

---

## ▶ Run it (about 30 seconds)

**You need two things, both free:**

- **Python 3** — already on macOS and most Linux. Check with `python3 --version`.
- **Git** — check with `git --version`.

(No Python or Git? See [Installing Python & Git](#installing-python--git) at the bottom.)

**Then copy-paste this into your terminal:**

```bash
git clone https://github.com/LabbEngine/Flight-Global.git
cd Flight-Global
python run.py
```

> 💡 On macOS/Linux, if `python` isn't found, just use **`python3 run.py`**.

That's it. Your browser opens automatically at **http://localhost:8003** and the globe appears. To stop it, press **`Ctrl + C`** in the terminal.

**There is nothing else to install** — no `npm install`, no build step, no dependencies to download. The repository *is* the whole app. (`run.py` is a tiny ~10-line static file server; it exists only because browsers refuse to load textures and data straight from `file://` URLs, so the files have to be served over `localhost`.)

---

## 🛫 Take your first flight

Once the globe is up, try this — you can do the whole thing with the keyboard:

1. Start typing a **destination**, e.g. `Tokyo`, and press **Enter**.
2. Type an **origin**, e.g. `Stockholm`, and press **Enter**. The camera glides in and the route draws itself.
3. Press **Enter** again to **Board**, and once more to grab a **random seat and go** — or click *Board flight* and pick your own seat.
4. Watch the flight from the **Top**, **Trip**, or **Behind** camera (in Behind view, drag to look around the plane; click *Behind* again to recenter).

Or just spin the globe and enjoy it — drag to rotate, scroll to zoom, double-click to fly somewhere.

---

## 📸 Screenshots

*(Drop your own captures into a `docs/` folder and uncomment these.)*

<!-- ![The globe](docs/screenshot-globe.png) -->
<!-- ![A flight from Stockholm to Tokyo](docs/screenshot-flight.png) -->

---

## ✨ Features

- **A bright, crisp Earth** — 8K satellite texture, fully daylit so the map is always readable, with drifting clouds, an atmospheric rim glow, and a procedural star field. Zoom in and an unsharp-mask detail layer sharpens the terrain; during a flight the whole map dims so the route pops.
- **Free-flight camera** — full trackball rotation in every direction (straight over the poles), inertia, deep zoom, double-click to fly anywhere, a live compass, and gentle auto-rotate when idle.
- **Smart search** — instant autocomplete over ~3,900 cities, ~1,200 airports, famous landmarks, and raw coordinates (`59.33, 18.07` works). Pick a destination, then an origin, and the route **calculates itself**.
- **Great-circle routes** — the true shortest path over the sphere, drawn as a clean two-tone arc that traces itself in 3 seconds, with a pulse ripple when it reaches the city.
- **Board your flight** — a boarding pass with real airport call signs (Stockholm → **ARN**, Tokyo → **HND**), a seat map, and a pomodoro-style flight length (1 / 5 / 15 / 25 / 45 min). Board and you get a *Now boarding* sequence, then takeoff, a live dashboard (status, countdown, altitude, both arrival clocks), a jet-engine sound with a volume slider, and big cities labelled on the map as you cross them.
- **A four-plane fleet** — 787-9 Dreamliner, 777-300ER, A350-900, A330-900neo, with distinct silhouettes and stats. Fuel stops are added automatically if a plane can't make it in one hop.
- **Find me** — flies to your real location via the browser's geolocation, and starts there on each load.
- **Deep-zoom detail** — zoom down to a city and, if you're online, real satellite tiles stream in so you can explore the ground.
- **Offline-first** — the whole app runs with no internet after cloning (see [Offline](#-offline)).

---

## ⌨ Controls & shortcuts

| Input | Action |
| --- | --- |
| Drag | Rotate the globe |
| Scroll / pinch | Zoom in and out |
| Double-click | Fly to that spot |
| Right-click | Pin an arbitrary spot as origin/destination |
| Type + `Enter` | Pick a place, then keep pressing `Enter` to calculate → board → go |
| `/` | Focus the search box |
| `↑ ↓` | Move through search results |
| `+` / `-` | Zoom in / out |
| Arrow keys | Nudge the camera |
| `h` | Fly to my location |
| `n` | Point north up (or click the compass) |
| `c` | Calculate flight / board it |
| `f` | Fullscreen |
| `Esc` | Close menus · cancel boarding · exit a flight |

---

## 🛠 Troubleshooting

- **`python: command not found`** → use **`python3 run.py`** instead (or install Python — see below).
- **The browser didn't open** → open the address printed in the terminal yourself (usually http://localhost:8003).
- **"Address already in use" / port busy** → `run.py` automatically tries ports 8003–8013 and prints the one it used. Open that address.
- **Blank page or nothing loads** → make sure you ran `python run.py` *from inside the project folder*. Opening `index.html` directly by double-clicking it will **not** work — browsers block loading the textures and data from `file://`, which is exactly why the little server exists.
- **"Find me" does nothing** → your browser asks for location permission once; if you deny it, the app just falls back to a default view. That's fine.
- **The close-up satellite detail is missing** → that layer needs an internet connection; everything else works offline.

---

## 🌐 Offline

After cloning, FlyCool runs with **no internet at all**. Three.js and GSAP are vendored in `/vendor`, the Earth textures live in `/assets/textures`, the place and aircraft data in `/data`, and timezones come from the browser's built-in database. Sound is generated in-browser. The single online extra is the deep-zoom satellite detail (Esri World Imagery tiles); with the network off it simply isn't there and the base globe shows instead.

---

## 🔧 How it works

**The globe** is a Three.js sphere with a custom GLSL shader over the 8K daylight texture: evenly daylit, with a sun-driven water glint, an altitude-scaled unsharp mask that sharpens terrain as you zoom, and a brightness uniform the flight sim tweens to dim the world in flight. A second sphere carries the clouds (they fade away below ~1,000 km so they never smear the ground); a third renders the atmospheric rim glow.

**Search** reads `data/places.json` (curated from GeoNames and OurAirports) into memory and scores matches by prefix, word boundary, IATA code, and population — all client-side.

**Routes** are great circles: both endpoints become unit vectors and the path is their spherical interpolation, lifted above the surface. Distance is the haversine formula; flight time is distance over cruise speed plus a taxi/climb allowance; fuel stops are picked from large airports near the direct track when a leg would exceed a plane's range.

**Time zones** use the browser's `Intl.DateTimeFormat` with IANA zone names — DST-correct and offline, since the timezone database ships with every browser.

---

## 📝 Editing the data

Aircraft live in `data/aircraft.json` and places in `data/places.json` — both are plain JSON you can edit to add your own planes, cities, or landmarks. A place needs `name`, `lat`, `lng`, and an IANA `tz` (like `Europe/Stockholm`). Refresh the page to see changes.

---

## 📦 Installing Python & Git

- **Python 3** — check with `python3 --version`.
  - **macOS:** `brew install python3`, or download from [python.org](https://www.python.org/downloads/).
  - **Windows:** download from [python.org](https://www.python.org/downloads/) and tick **"Add Python to PATH"** during install.
  - **Linux:** `sudo apt install python3` (Debian/Ubuntu) or your distro's package manager.
- **Git** — check with `git --version`. Get it from [git-scm.com](https://git-scm.com/downloads), or `brew install git` / `sudo apt install git`.

You don't even strictly need Git — you can hit **"Download ZIP"** on the GitHub page, unzip it, `cd` into the folder, and run `python run.py`.

---

## 🙏 Credits

- Earth textures by [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0), based on NASA Blue Marble / Black Marble imagery.
- Deep-zoom imagery tiles: Esri World Imagery (© Esri, Maxar, Earthstar Geographics).
- Place data from [GeoNames](https://www.geonames.org/) (CC BY 4.0); airports from [OurAirports](https://ourairports.com/data/) (public domain).
- Rendered with [Three.js](https://threejs.org/), animated with [GSAP](https://gsap.com/).
