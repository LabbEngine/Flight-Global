# FocusAir

A browser-based 3D flight visualiser and planner. Spin a live satellite globe, plan a great-circle route with connecting stops, walk the terminal to your seat, and fly it from a live map view or a fully modelled first-person cabin. It is pure front end — HTML, CSS, and JavaScript with Three.js and GSAP.

## Overview

FocusAir renders the Earth as high-resolution satellite imagery (Esri World Imagery) draped live over a sphere, with drifting clouds, an atmospheric rim, and a procedural star field. Ground you've already seen is cached in the browser so it loads instantly on your next visit. From there you plan a trip between any two points, control its real-time length and number of connecting airports, and watch it play out — locked on whatever place you've picked until you drag away yourself.

Boarding hands you a boarding pass and a fuselage-shaped seat map, then drops you into a 2D top-down airport: walk from baggage claim through check-in, security, and your gate to the exact seat you picked, in the boarding group your membership tier earns you. It's optional (off by default, one HUD button), and it also plays as a pitstop at every connecting airport on a multi-leg trip. Skip it any time and the flight departs.

In the air, a first-person cabin lets you sit in your seat, look out an enlarged window at the sky, or check the seat-back screen for live flight data. A frequent-flyer tier system (Silver, Gold, Platinum, Premium) advances as you complete flights and determines how early you board. Connecting flights get their own **Leg** camera and a **Landed** status at each stop, alongside the whole-trip view.

There is no build step and no backend. The repository is the whole application.

## Requirements

- Python 3 (any recent 3.x; used only to serve static files)
- A modern desktop browser with WebGL 2
- An internet connection, for the live satellite map tiles (see [Offline behaviour](#offline-behaviour))

## Getting started

FocusAir is a set of static files served locally by Python 3. There is no Git, no build step, and nothing to install — Python 3 is the only requirement, and recent versions of macOS already include it.

### 1. Download the app

1. Open the repository on GitHub: <https://github.com/LabbEngine/Flight-Global>.
2. Click the green **Code** button, then **Download ZIP**.
3. Unzip the file. This produces a folder named `Flight-Global-main`; move it to your Desktop.

### 2. Start it — the easy way (no terminal)

Open the folder and double-click the launcher for your system:

- **macOS:** double-click **`run.command`**. The first time, macOS may block it because the file came from the internet — if so, **right-click `run.command`, choose *Open*, then click *Open* again**. You only do this once.
- **Windows:** double-click **`run.bat`**.

A small window opens and your browser launches at <http://localhost:8003>. Leave that window open while you fly; close it (or press `Ctrl+C`) to stop.

The launcher finds Python 3 for you, so you never have to know whether it is called `python` or `python3`.

### 3. Or start it from a terminal

Prefer the terminal, or the launcher was blocked? Open one inside the folder:

- **macOS:** right-click the folder in Finder and choose *New Terminal at Folder*, or run `cd ~/Desktop/Flight-Global-main`.
- **Windows:** open the folder in File Explorer, type `cmd` in the address bar, and press Enter.
- **Linux:** right-click inside the folder and choose *Open Terminal*, or `cd` into it.

Then start the server:

```bash
python3 run.py
```

On Windows, use `python run.py` (or `py run.py`). Your browser opens at <http://localhost:8003>; stop the server with `Ctrl+C`.

> **Getting `command not found`?** Python 3 isn't installed yet. On macOS, the built-in command is `python3`, never `python`, so `python run.py` will always fail — use `python3`.
> - **macOS:** run `xcode-select --install`, click *Install*, wait for it to finish, then try again. This installs Apple's command-line tools, which include Python 3.
> - **Windows / Linux:** install Python 3 from <https://www.python.org/downloads/>; on Windows, tick *Add Python to PATH* during setup.

`run.py` is a small static file server; it exists only because browsers refuse to load the textures and JSON data over `file://`, so the files must be served over `localhost`. Nothing else is installed: Three.js and GSAP are vendored under `vendor/`, and all textures and data are committed.

### Alternative: clone with Git

```bash
git clone https://github.com/LabbEngine/Flight-Global.git
cd Flight-Global
python3 run.py
```

## Features

- **Live satellite globe** — the entire sphere is draped in real Esri World Imagery, not a single baked texture: a wide coverage layer keeps the whole visible globe live at any zoom, and a high-resolution patch streams in around wherever you're looking as you get closer, down to individual fields and buildings. A service worker caches every tile you've loaded in the browser, so ground you've already seen redraws instantly on a later visit instead of re-fetching.
- **Interactive globe** — quaternion trackball camera with inertia, unrestricted rotation over the poles, altitude-scaled zoom, a compass, and idle auto-rotation that stops the moment you pick an origin or destination, so your selection stays centred until you drag away yourself.
- **Capitals** — every world capital is marked on the globe while browsing and can be clicked to set it as the destination.
- **Search** — prefix, word-boundary, IATA, and population-ranked autocomplete over roughly 3,900 cities, 1,200 airports, and a set of landmarks, plus raw coordinates.
- **Trip planner** — set the total real-time trip length, the number of connecting airports (zero to three), and the wait time at each; the route is re-planned through intermediate airports chosen along the great circle.
- **Great-circle routes** — shortest-path arcs drawn as a two-tone tube, with automatic fuel stops added when a leg exceeds the aircraft's range. In flight the aircraft cruises low and close to the ground, and you can zoom in tight on it to watch the real map pass underneath.
- **Four aircraft** — 787-9, 777-300ER, A350-900, and A330-900neo, each with its own range, cruise speed, and capacity.
- **Boarding** — a boarding pass with real airport codes and a seat map drawn inside a plane-fuselage silhouette (nose cone, aisle, row numbers), with a tier-aware boarding order.
- **2D airport minigame** — optional, off by default (toggle it with the gamepad button, top right). When it's on, pressing Board drops you into a top-down airport: walk from baggage claim through check-in, security, and the gate to the exact seat and boarding group you picked, or skip straight to the flight. On a connecting itinerary it also plays as a pitstop at every stop along the way, departing from that airport for the next leg.
- **Live flight dashboard** — status, countdown, altitude, and both arrival clocks, with Top, Trip, Behind, and Cabin cameras. Connecting flights add a **Leg** camera that frames the leg you're on now (with a "Leg 2/3 · X → Y" readout), and the aircraft parks out of sight with a **Landed** status during each layover.
- **First-person cabin** — a modelled three-by-three, 30-row interior with textured seats, overhead bins, enlarged oval windows onto a shader sky, and seat-back in-flight-entertainment displays. The screen ahead of your seat shows live flight data; the rest show an entertainment home screen. Drag to look around, tap **Window view** to swing straight toward your window, and return to the map with one button.
- **Membership** — Silver, Gold, Platinum, and Premium tiers that advance with flights flown and grant earlier boarding, both in the queue animation and in the airport minigame.
- **Timezones** — departure and arrival shown in both zones via the browser's Intl API, with correct daylight-saving handling.

## Controls

| Input | Action |
| --- | --- |
| Drag | Rotate the globe |
| Scroll or pinch | Zoom |
| Double-click | Fly to a point |
| Click a capital | Set it as the destination |
| Right-click | Pin an arbitrary point |
| `/` | Focus search |
| Arrow keys | Nudge the camera |
| `n` | Point north up |
| `h` | Fly to your location |
| `c` | Calculate a flight, or board it |
| `f` | Fullscreen |
| `Esc` | Close menus, cancel boarding, exit a flight |

During a flight, switch between the Top, Trip, Leg (connecting flights only), Behind, and Cabin cameras from the dashboard. In the cabin, dragging looks around (grab-style, so dragging left looks right); **Window view** turns to face your window, and "Earth view" returns to the globe.

In the airport minigame: `WASD` to walk, `E` to interact or auto-run the current task, `G` for autopilot (walks and does everything for you), `Tab` to show or hide your boarding pass. The gamepad button in the top-right HUD turns the minigame on or off for every future boarding; it's off by default.

## Project structure

```
index.html           markup and HUD
airport.html          2D top-down airport minigame (runs in its own iframe)
sw.js                 service worker: caches map tiles and app files locally
run.py                static file server and browser launch
run.command           double-click launcher (macOS)
run.bat               double-click launcher (Windows)
css/style.css         styling
js/
  main.js             boot, application state, render loop
  globe.js            backdrop sphere, clouds, atmosphere, stars
  tiles.js            the satellite globe surface (streamed Esri tiles)
  controls.js         quaternion trackball camera
  route.js            great-circle geometry and the in-flight comet
  flight.js           distance, duration, timezones, stops, breaks
  sim.js              boarding, airport minigame, flight timeline, dashboard, cameras
  cabin.js            first-person cabin scene
  capitals.js         clickable capital markers
  membership.js       frequent-flyer tiers
  search.js           place search and ranking
  ui.js               planner, panels, HUD, keyboard
  pins.js, audio.js, citylabels.js, fx.js, geo.js
data/                 places.json, aircraft.json
assets/textures/      cloud texture (Earth day/night textures are committed but unused — see below)
vendor/               Three.js and GSAP
```

## How it works

The globe itself is a plain sphere; what you see draped over it is a live tile layer (`js/tiles.js`) streaming Esri World Imagery satellite tiles, in two tiers at once — a coarse grid sized to always cover the whole visible cap, and a finer patch around wherever the camera is looking that gets sharper the closer you zoom, down to roughly 40 km altitude. A one-time whole-world base layer is kept resident the entire session, so there's always full coverage under the finer tiles instead of blank gaps while panning. A separate cloud shell and a fresnel atmosphere sit above it.

A service worker (`sw.js`) caches every map tile and app file the browser fetches. Tiles are cache-first and never expire — ground you've already seen loads instantly and works offline; the app's own files are network-first, so you always get the latest version when online, falling back to the cache if you're not.

The cabin and the airport minigame are each an independent scene with their own renderer/canvas. The cabin is Three.js, built almost entirely from instanced meshes so that 180 seats, the windows, and the seat-back displays cost only a handful of draw calls; the sky outside the windows is a fractal-noise cloud shader. The airport minigame (`airport.html`) is a 2D canvas top-down sim that runs in an iframe, sharing the exact same 30-row, 3-3 seat map as the rest of the app — the seat and membership tier you picked when boarding are passed in directly, so the seat you board to in the minigame is the same one on your boarding pass.

Routing interpolates the two endpoints on the sphere, samples the great circle, and lifts the path above the surface. Distance is the haversine formula. Connecting airports (the planner's "breaks") are the nearest airports to points spaced evenly along the track. The flight plays on a real-time schedule: each leg runs for its share of the trip length, pausing at each connecting airport — either as a timed layover, or, with the airport minigame turned on, as a pitstop you play through before the next leg departs.

Timezones use `Intl.DateTimeFormat` with IANA zone names, so daylight-saving transitions are handled correctly without any bundled timezone data.

## Offline behaviour

FocusAir needs the network for its map: the globe is live satellite imagery, not a baked-in texture, so a first run with no internet shows a plain sphere with no ground detail. Everything else works offline from the moment you first load the page — libraries are vendored, place and aircraft data are committed, sound is synthesised in the browser, timezones come from the browser, and the airport minigame is entirely local (same-origin, no network calls of its own).

After that first load, the service worker means offline gets better the more you use the app: any map tile you've already seen is cached and redraws instantly with no network at all, and the app's own files stay available offline too. There's no way to pre-download the whole planet — only areas you've actually visited are cached.

## Data and attribution

- Live globe imagery: Esri World Imagery (© Esri, Maxar, Earthstar Geographics).
- Cloud texture by [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0), based on NASA imagery. (Earth day/night textures from the same source are committed under `assets/textures/` but currently unused, kept for a possible future baked-texture or night mode.)
- Place data from [GeoNames](https://www.geonames.org/) (CC BY 4.0); airports from [OurAirports](https://ourairports.com/data/) (public domain).
- Rendered with [Three.js](https://threejs.org/); animated with [GSAP](https://gsap.com/).

## License

Released under the terms in the [LICENSE](LICENSE) file.
