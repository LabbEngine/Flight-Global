# FocusAir

A browser-based 3D flight visualiser and planner. Spin an interactive globe, plan a great-circle route with connecting stops, board the aircraft, and fly it from a live map view or a fully modelled first-person cabin. It is pure front end — HTML, CSS, and JavaScript with Three.js and GSAP — and runs entirely offline after cloning.

## Overview

FocusAir renders an 8K daylit Earth with a custom GLSL shader, drifting clouds, an atmospheric rim, and a procedural star field. From there you plan a trip between any two points, control its real-time length and number of connecting airports, and watch it play out.

Boarding hands you a boarding pass, a 30-row seat map, and a first-person cabin: a textured, three-by-three fuselage interior with seat-back displays — the one directly ahead of your seat showing live flight data — that you look around by dragging. A frequent-flyer tier system (Silver, Gold, Platinum, Premium) advances as you complete flights and determines how early you board.

There is no build step and no backend. The repository is the whole application.

## Requirements

- Python 3 (any recent 3.x; used only to serve static files)
- A modern desktop browser with WebGL 2

## Getting started

The application is a set of static files. You only need Python 3 to serve them locally — no Git, no build tools, and no dependency installation.

### Download and run

1. Open the repository on GitHub: <https://github.com/LabbEngine/Flight-Global>.
2. Click the green **Code** button, then **Download ZIP**.
3. Unzip the downloaded file. This produces a folder named `Flight-Global-main`; move it to your Desktop (or anywhere convenient) and open it.
4. Open a terminal inside that folder:
   - **macOS:** right-click the folder in Finder and choose *New Terminal at Folder*, or run `cd ~/Desktop/Flight-Global-main`.
   - **Windows:** open the folder in File Explorer, type `cmd` in the address bar, and press Enter.
   - **Linux:** right-click inside the folder and choose *Open Terminal*, or `cd` into it.
5. Start the server:

   ```bash
   python run.py
   ```

   If `python` is not found, use `python3 run.py`.

Your browser opens automatically at <http://localhost:8003>. Stop the server with `Ctrl+C` in the terminal.

`run.py` is a small static file server; it exists only because browsers refuse to load the textures and JSON data over `file://`, so the files must be served over `localhost`. Nothing else is installed: Three.js and GSAP are vendored under `vendor/`, and all textures and data are committed.

### Alternative: clone with Git

```bash
git clone https://github.com/LabbEngine/Flight-Global.git
cd Flight-Global
python run.py
```

## Features

- **Interactive globe** — quaternion trackball camera with inertia, unrestricted rotation over the poles, altitude-scaled zoom, a compass, and idle auto-rotation.
- **Capitals** — every world capital is marked on the globe while browsing and can be clicked to set it as the destination.
- **Search** — prefix, word-boundary, IATA, and population-ranked autocomplete over roughly 3,900 cities, 1,200 airports, and a set of landmarks, plus raw coordinates.
- **Trip planner** — set the total real-time trip length, the number of connecting airports (zero to three), and the wait time at each; the route is re-planned through intermediate airports chosen along the great circle.
- **Great-circle routes** — shortest-path arcs drawn as a two-tone tube, with automatic fuel stops added when a leg exceeds the aircraft's range.
- **Four aircraft** — 787-9, 777-300ER, A350-900, and A330-900neo, each with its own range, cruise speed, and capacity.
- **Boarding and flight** — a boarding pass with real airport codes, a seat map, a tier-aware boarding sequence, and a live dashboard showing status, countdown, altitude, and both arrival clocks.
- **First-person cabin** — a modelled three-by-three, 30-row interior with textured seats, overhead bins, oval windows onto a shader sky, and seat-back in-flight-entertainment displays. The screen ahead of your seat shows live flight data; the rest show an entertainment home screen. Drag to look around, and return to the map with one button.
- **Membership** — Silver, Gold, Platinum, and Premium tiers that advance with flights flown and grant earlier boarding.
- **Timezones** — departure and arrival shown in both zones via the browser's Intl API, with correct daylight-saving handling.
- **Deep-zoom imagery** — optional Esri World Imagery tiles stream in near the ground when online, and degrade to the base globe when offline.

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
| `c` | Calculate a flight, or board it |
| `f` | Fullscreen |
| `Esc` | Close menus, cancel boarding, exit a flight |

During a flight, switch between the Top, Trip, Behind, and Cabin cameras from the dashboard. In the cabin, dragging looks around (grab-style, so dragging left looks right); the "Earth view" button returns to the globe.

## Project structure

```
index.html            markup and HUD
run.py                static file server and browser launch
css/style.css         styling
js/
  main.js             boot, application state, render loop
  globe.js            Earth shader, clouds, atmosphere, stars
  controls.js         quaternion trackball camera
  route.js            great-circle geometry and the in-flight comet
  flight.js           distance, duration, timezones, stops, breaks
  sim.js              boarding, flight timeline, dashboard, cameras
  cabin.js            first-person cabin scene
  capitals.js         clickable capital markers
  membership.js       frequent-flyer tiers
  search.js           place search and ranking
  ui.js               planner, panels, HUD, keyboard
  pins.js, tiles.js, audio.js, citylabels.js, fx.js, geo.js
data/                 places.json, aircraft.json
assets/textures/      committed Earth textures
vendor/               Three.js and GSAP
```

## How it works

Rendering uses a Three.js sphere with a custom fragment shader over the 8K daylight texture, a separate cloud shell, and a fresnel atmosphere. The cabin is an independent Three.js scene with its own renderer, built almost entirely from instanced meshes so that 180 seats, the windows, and the seat-back displays cost only a handful of draw calls; the sky outside the windows is a fractal-noise cloud shader.

Routing interpolates the two endpoints on the sphere, samples the great circle, and lifts the path above the surface. Distance is the haversine formula. Connecting airports (the planner's "breaks") are the nearest airports to points spaced evenly along the track. The flight plays on a real-time schedule: each leg runs for its share of the trip length, with a ground pause at each connecting airport.

Timezones use `Intl.DateTimeFormat` with IANA zone names, so daylight-saving transitions are handled correctly without any bundled timezone data.

## Offline behaviour

After cloning, FocusAir runs with no network access. Libraries are vendored, textures and data are committed, sound is synthesised in the browser, and timezones come from the browser. The only online feature is the optional deep-zoom satellite imagery, which is simply absent — not broken — when offline.

## Data and attribution

- Earth textures by [Solar System Scope](https://www.solarsystemscope.com/textures/) (CC BY 4.0), based on NASA Blue Marble and Black Marble imagery.
- Place data from [GeoNames](https://www.geonames.org/) (CC BY 4.0); airports from [OurAirports](https://ourairports.com/data/) (public domain).
- Deep-zoom imagery: Esri World Imagery (© Esri, Maxar, Earthstar Geographics).
- Rendered with [Three.js](https://threejs.org/); animated with [GSAP](https://gsap.com/).

## License

Released under the terms in the [LICENSE](LICENSE) file.
