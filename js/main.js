// Boot: load assets, build the scene, own the app state, run the render loop.
import * as THREE from '../vendor/three/three.module.js';
import { buildGlobe } from './globe.js';
import { GlobeControls } from './controls.js';
import { PinManager } from './pins.js';
import { FlightRoute } from './route.js';
import { SearchBox, nearestPlace } from './search.js';
import { computeFlight, wallTimeToInstant } from './flight.js';
import { haversineKm } from './geo.js';
import { FlightSim } from './sim.js';
import { TileLayer } from './tiles.js';
import { FlightAudio } from './audio.js';
import { CityLabels } from './citylabels.js';
import { CapitalLabels } from './capitals.js';
import { TIERS, tierFor, tierProgress, addFlight } from './membership.js';
import { initUI } from './ui.js';

const HOME = { lat: 45, lng: 15, dist: 2.85 };

const loadStatus = document.getElementById('load-status');
const loadBar = document.getElementById('load-bar');
let loadedItems = 0;
const TOTAL_ITEMS = 3;
function bumpProgress(label) {
  loadedItems++;
  loadBar.style.width = `${(loadedItems / TOTAL_ITEMS) * 100}%`;
  loadStatus.textContent = label;
}

function loadTexture(loader, url, label) {
  return new Promise((resolve, reject) => {
    loader.load(url, (t) => { bumpProgress(label); resolve(t); }, undefined,
      () => reject(new Error(`Could not load ${url}`)));
  });
}
async function loadJSON(url, label) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`Could not load ${url}`);
  const j = await r.json();
  bumpProgress(label);
  return j;
}

async function boot() {
  const canvas = document.getElementById('globe-canvas');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch {
    loadStatus.textContent = 'WebGL is not available in this browser.';
    return;
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.setClearColor(0x04060d);

  const texLoader = new THREE.TextureLoader();
  const [clouds, places, aircraftList] = await Promise.all([
    loadTexture(texLoader, 'assets/textures/earth_clouds_4k.jpg', 'Seeding the clouds…'),
    loadJSON('data/places.json', 'Reading the atlas…'),
    loadJSON('data/aircraft.json', 'Rolling out the fleet…'),
  ]);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.01, 130);
  const globe = buildGlobe(scene, { clouds }, renderer.capabilities.getMaxAnisotropy());
  const controls = new GlobeControls(camera, canvas);
  const pins = new PinManager(scene, document.getElementById('labels'));
  const route = new FlightRoute(scene);
  const tiles = new TileLayer(scene);
  const audio = new FlightAudio();
  const cityLabels = new CityLabels(document.getElementById('labels'), places);
  const capitals = new CapitalLabels(document.getElementById('labels'), places, (cap) => app.setPlace('dest', cap));
  const airports = places.filter((p) => p.type === 'airport');
  // a city shows its biggest nearby airport's call sign (Stockholm -> ARN)
  const airportCode = (place) => {
    if (place.iata) return place.iata;
    const near = nearestPlace(airports, place.lat, place.lng);
    return (near.place && near.distKm < 250) ? near.place.iata : place.name.slice(0, 3).toUpperCase();
  };

  // ---------- application state & actions ----------
  const app = {
    aircraftList,
    places,
    pendingRole: null,
    state: { origin: null, dest: null, aircraft: aircraftList[0], flight: null, tripMinutes: 15, breaks: 0, layoverMinutes: 5 },

    armSlot(role) {
      app.pendingRole = role;
      ui.setSearchHint(role);
      ui.searchInput.focus();
      ui.renderPlanner();
    },
    disarmSlot() {
      app.pendingRole = null;
      ui.setSearchHint(null);
      ui.renderPlanner();
    },
    setPlace(role, place, { defer = false } = {}) {
      app.state[role] = place;
      pins.setPin(role, place, { pending: defer }); // deferred labels print after the zoom
      ui.toast(`${role === 'origin' ? 'Origin' : 'Destination'}: ${place.name}`);
      app.disarmSlot();
      if (app.state.flight) app.calculate({ recenter: false, silent: true });
      // both endpoints chosen -> the route calculates itself (fewer clicks).
      // Deferred (search-flow) sets run autoCalc after their own fly-to instead.
      else if (!defer && app.state.origin && app.state.dest) gsap.delayedCall(0.9, () => app.autoCalc());
    },
    autoCalc() {
      if (app.state.origin && app.state.dest && !app.state.flight && !sim.busy) {
        app.calculate({ recenter: true });
      }
    },
    clearPlace(role) {
      app.state[role] = null;
      pins.clearPin(role);
      app.clearFlight();
      ui.renderPlanner();
    },
    swap() {
      const { origin, dest } = app.state;
      if (!origin && !dest) return;
      app.state.origin = dest;
      app.state.dest = origin;
      if (app.state.origin) pins.setPin('origin', app.state.origin); else pins.clearPin('origin');
      if (app.state.dest) pins.setPin('dest', app.state.dest); else pins.clearPin('dest');
      ui.renderPlanner();
      if (app.state.flight) app.calculate({ recenter: false, silent: true });
    },
    setAircraft(id) {
      app.state.aircraft = aircraftList.find((a) => a.id === id);
      if (app.state.flight) app.calculate({ recenter: false, silent: true });
    },
    setTripMinutes(m) { app.state.tripMinutes = Math.max(1, Math.round(m)); },
    setBreaks(n) {
      app.state.breaks = Math.max(0, Math.min(3, Math.round(n)));
      if (app.state.flight) app.calculate({ recenter: false, silent: true }); // route changes with breaks
    },
    setLayoverMinutes(m) { app.state.layoverMinutes = Math.max(1, Math.round(m)); },
    onDepartureChanged() {
      if (app.state.flight) app.calculate({ recenter: false, silent: true });
    },

    departureInstant() {
      const m = ui.departureEl.value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
      if (!m || !app.state.origin) return new Date();
      return wallTimeToInstant(app.state.origin.tz, +m[1], +m[2], +m[3], +m[4], +m[5]);
    },

    // one button, two jobs: calculate first, then board the calculated flight
    primaryAction() {
      if (app.state.flight?.feasible) app.board();
      else app.calculate({ recenter: true });
    },
    board() {
      if (sim.busy || !app.state.flight?.feasible) return;
      const { origin, dest, aircraft } = app.state;
      sim.openBoarding({
        origin, dest, aircraft, flight: app.state.flight,
        originCode: airportCode(origin), destCode: airportCode(dest),
        tripMinutes: app.state.tripMinutes, layoverMinutes: app.state.layoverMinutes,
      });
    },
    // Enter keeps advancing the whole flow: board when ready, or grab a random
    // seat and go once the boarding pass is open.
    enterAdvance() {
      if (!document.getElementById('boarding').hidden) { sim.boardRandomSeat(); return; }
      if (sim.busy) return;
      if (app.state.flight?.feasible) { app.board(); return; }
      if (app.state.origin && app.state.dest) app.calculate({ recenter: true });
    },
    simBusy() { return sim.busy; },
    exitSim() { sim.exit(); },

    calculate({ recenter = true, silent = false } = {}) {
      if (sim.busy) return; // never rebuild the route under a boarding/flying/finishing sim
      const { origin, dest, aircraft } = app.state;
      if (!origin || !dest || !aircraft) return;
      if (haversineKm(origin, dest) < 30) {
        ui.toast('Origin and destination are the same place');
        app.clearFlight(); // don't leave a stale route/panel behind
        return;
      }
      const result = computeFlight({
        origin, dest, aircraft, departure: app.departureInstant(), airports, breaks: app.state.breaks,
      });
      app.state.flight = result;
      pins.setStops(result.stops);
      route.show(result.legs, { onDrawn: () => pins.pulse('dest') }); // ripple when the line reaches the city
      ui.showFlight(result);
      ui.renderPlanner(); // the calculate button becomes "Board flight"
      if (!silent && !result.feasible) ui.toast('Out of range — showing the route anyway');
      if (recenter) {
        const mid = {
          lat: (origin.lat + dest.lat) / 2,
          lng: origin.lng + (((dest.lng - origin.lng + 540) % 360) - 180) / 2,
        };
        const angular = result.directKm / 6371;
        controls.flyTo({
          lat: mid.lat, lng: mid.lng,
          dist: THREE.MathUtils.clamp(1.15 + angular * 1.35, 1.6, 4.8),
          duration: 1.6,
        });
      }
    },

    clearFlight() {
      app.state.flight = null;
      route.clear();
      pins.clearStops();
      ui.hideFlight();
      ui.renderPlanner();
    },
    // After landing: clear the trip and ease from a very-close view of the
    // arrival city back out to space, leaving a clean globe.
    arriveAndReset(dest) {
      app.state.origin = null;
      app.state.dest = null;
      app.state.flight = null;
      app.pendingRole = null;
      pins.clearAll();
      route.clear();
      ui.hideFlight();
      ui.renderPlanner();
      controls.enabled = true;
      controls.jumpTo(dest.lat, dest.lng, 1.05); // very zoomed into the arrival city
      controls.flyTo({ lat: dest.lat, lng: dest.lng, dist: 3.0, duration: 5.2 }); // slow zoom out
    },
    resetAll() {
      sim.kill();
      app.clearFlight();
      pins.clearAll();
      app.state.origin = null;
      app.state.dest = null;
      app.disarmSlot();
      ui.renderPlanner();
      app.flyHome();
    },
    flyHome() {
      if (sim.busy) { ui.toast('Exit the flight first'); return; }
      controls.flyTo({ ...HOME, duration: 1.8 });
    },
    faceNorth() {
      if (sim.busy) return;
      controls.faceNorth();
    },
    // The home button: find me on the globe. Falls back to the last known
    // fix, then to the default view, if the browser can't locate us.
    goToMyLocation() {
      if (sim.busy) { ui.toast('Exit the flight first'); return; }
      const fly = (lat, lng, note) => {
        pins.setPin('user', { name: 'My location', lat, lng }, { pending: true });
        const tok = pins.tokenOf('user');
        controls.flyTo({ lat, lng, dist: 1.35, onComplete: () => pins.revealPin('user', tok) });
        gsap.delayedCall(3, () => pins.revealPin('user', tok));
        if (note) ui.toast(note);
      };
      const cached = (() => {
        try { return JSON.parse(localStorage.getItem('fg_geo') || 'null'); } catch { return null; }
      })();
      const fallback = () => {
        if (cached && Number.isFinite(cached.lat) && Number.isFinite(cached.lng)) fly(cached.lat, cached.lng, 'Using your last known location');
        else { controls.flyTo({ ...HOME, duration: 1.8 }); ui.toast('Location unavailable — flying to the default view'); }
      };
      if (!navigator.geolocation) { fallback(); return; }
      ui.setLocating(true);
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          ui.setLocating(false);
          const { latitude: lat, longitude: lng } = pos.coords;
          localStorage.setItem('fg_geo', JSON.stringify({ lat, lng }));
          fly(lat, lng);
        },
        () => { ui.setLocating(false); fallback(); },
        { timeout: 8000, maximumAge: 600000 }
      );
    },
    zoomBy(f) {
      if (sim.inFlight) sim.zoomBy(f);
      else if (!sim.busy) controls.zoomBy(f);
    },
    nudge(dLat, dLng) { controls.nudge(dLat, dLng); },
    flyToPlace(place, { closer = false, onDone = null } = {}) {
      const dist = closer ? 1.06
        : place.type === 'landmark' ? 1.28
        : place.type === 'airport' ? 1.45 : 1.55;
      controls.flyTo({ lat: place.lat, lng: place.lng, dist, onComplete: onDone });
    },
    // A slower, closer glide into the departure point.
    flyToOrigin(place, onDone = null) {
      const dist = place.type === 'airport' ? 1.32 : place.type === 'landmark' ? 1.35 : 1.42;
      controls.flyTo({ lat: place.lat, lng: place.lng, dist, duration: 1.7, onComplete: onDone });
    },
  };

  const ui = initUI(app);

  const sim = new FlightSim({
    camera, controls, route, globe, ui, audio, canvas,
    onStateChange(on) {
      document.body.classList.toggle('sim-on', on);
      controls.enabled = !on;
      if (on) {
        ui.hidePlaceCard();
        ui.hideContextCard();
        ui.hideFlight();
      } else {
        ui.renderPlanner();
      }
    },
    onFinish(dest) {
      const before = tierFor().key;
      const flights = addFlight(); // one more completed flight toward the next tier
      app.arriveAndReset(dest);
      renderMembership();
      const after = tierFor(flights);
      if (after.key !== before) gsap.delayedCall(3.6, () => ui.toast(`✦ Membership upgraded to ${after.name}!`));
    },
    // exit began: unselect everything but keep the destination callout in
    // view while the plane finishes its run there
    onDeselect() {
      app.state.origin = null;
      app.state.dest = null;
      app.state.flight = null;
      app.pendingRole = null;
      pins.clearPin('origin');
      pins.clearPin('user');
      pins.clearStops();
      ui.hideFlight();
      ui.renderPlanner();
    },
    // exit finished (plane landed): the route line disappears
    onExitDone() {
      route.clear();
      pins.clearAll();
      ui.renderPlanner();
    },
  });

  // default departure = now, local system time
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  ui.departureEl.value =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`;

  // ---------- membership chip + card ----------
  const memChip = document.getElementById('mem-chip');
  const memTierEl = document.getElementById('mem-tier');
  const memCard = document.getElementById('mem-card');
  function renderMembership() {
    const t = tierFor();
    memTierEl.textContent = t.name;
    memChip.style.setProperty('--tc', t.color);
  }
  function showMemCard() {
    const p = tierProgress();
    memCard.innerHTML = `
      <button class="card-close" id="mem-close" title="Close">×</button>
      <div class="mem-head"><span class="mem-badge" style="--tc:${p.cur.color}">${p.cur.name}</span><span class="mem-flights">${p.flights} flight${p.flights === 1 ? '' : 's'} flown</span></div>
      <div class="mem-ladder">${TIERS.map((x) => `<span class="mem-step${x.key === p.cur.key ? ' is-cur' : ''}${p.flights >= x.min ? ' is-reached' : ''}" style="--tc:${x.color}">${x.name}<small>${x.min}+</small></span>`).join('')}</div>
      ${p.next ? `<div class="mem-bar"><span style="width:${Math.round(p.frac * 100)}%"></span></div><div class="mem-next"><b>${p.need}</b> more flight${p.need === 1 ? '' : 's'} to <b style="color:${p.next.color}">${p.next.name}</b></div>` : `<div class="mem-next">Top tier — you fly <b style="color:${p.cur.color}">Premium</b> ✦</div>`}
      <div class="mem-perk">Higher tiers board first — your boarding pass shows your group by tier.</div>`;
    memCard.hidden = false;
    document.getElementById('mem-close').onclick = () => { memCard.hidden = true; };
  }
  memChip.onclick = () => { if (memCard.hidden) showMemCard(); else memCard.hidden = true; };
  renderMembership();

  new SearchBox({
    input: ui.searchInput,
    resultsEl: document.getElementById('search-results'),
    places,
    onEnterEmpty: () => app.enterAdvance(), // Enter on an empty box advances the flow
    onSelect(place) {
      if (sim.busy) return; // no route changes mid-boarding/flight
      // reveal the pin's callout once the fly-to lands; a backstop covers an
      // interrupted animation, and the token keeps a stale backstop from
      // revealing a pin that has since been replaced
      const reveal = (role) => {
        const tok = pins.tokenOf(role);
        gsap.delayedCall(3, () => pins.revealPin(role, tok));
        return () => pins.revealPin(role, tok);
      };
      // Explicit override: a slot was armed by clicking it.
      if (app.pendingRole) {
        const role = app.pendingRole;
        app.setPlace(role, place, { defer: true });
        const done = reveal(role);
        app.flyToPlace(place, { onDone: () => { done(); app.autoCalc(); } });
        gsap.delayedCall(3.2, () => app.autoCalc());
        return;
      }
      // Default flow: first pick is the destination, second is the origin,
      // then the camera glides into the origin and the route calculates itself.
      if (!app.state.dest) {
        app.setPlace('dest', place, { defer: true });
        app.flyToPlace(place, { onDone: reveal('dest') });
        ui.toast(`Destination ${place.name} — now search your origin`);
        ui.searchInput.focus();
      } else if (!app.state.origin) {
        app.setPlace('origin', place, { defer: true });
        const done = reveal('origin');
        app.flyToOrigin(place, () => { done(); app.autoCalc(); });
        gsap.delayedCall(3.2, () => app.autoCalc()); // backstop if the glide is interrupted
        ui.toast(`Origin ${place.name} — calculating route`);
      } else {
        // both already chosen: let the user decide what to do with this one
        app.flyToPlace(place);
        ui.showPlaceCard(place);
      }
    },
  });

  controls.onPick = ({ lat, lng }) => {
    if (sim.busy) return;
    controls.flyTo({ lat, lng, dist: Math.max(controls.dist * 0.55, 1.05) });
  };
  controls.onContext = ({ lat, lng, clientX, clientY }) => {
    if (sim.busy) return;
    ui.showContextCard({ clientX, clientY, lat, lng, near: nearestPlace(places, lat, lng) });
  };
  let hoverLL = null;
  controls.onHover = (ll) => { hoverLL = ll; };

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });

  // ---------- lift the curtain ----------
  const overlay = document.getElementById('loading');
  gsap.to(overlay, { opacity: 0, duration: 0.9, delay: 0.25, onComplete: () => overlay.remove() });
  // Open in space, then zoom into the viewer's own location. A cached fix (if
  // any) gives an instant target; live geolocation refines it; a denied or
  // unavailable location falls back to the default view.
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cachedGeo = (() => {
    try { const g = JSON.parse(localStorage.getItem('fg_geo') || 'null'); return g && Number.isFinite(g.lat) && Number.isFinite(g.lng) ? g : null; } catch { return null; }
  })();
  const flyToView = (lat, lng, dist, dur) =>
    reduced ? controls.jumpTo(lat, lng, dist) : controls.flyTo({ lat, lng, dist, duration: dur });

  if (!reduced) controls.jumpTo(5, -35, 5.8);
  if (cachedGeo) flyToView(cachedGeo.lat, cachedGeo.lng, 1.7, 3.4);
  else flyToView(HOME.lat, HOME.lng, HOME.dist, 3.4); // default until (if) location arrives

  // The geolocation fix can arrive up to 8 s late — by then the user may be
  // dragging, planning, or boarding, so only steal the camera if nothing else
  // is going on.
  let userTookOver = false;
  const markTakeover = () => { userTookOver = true; };
  canvas.addEventListener('pointerdown', markTakeover, { once: true });
  canvas.addEventListener('wheel', markTakeover, { once: true, passive: true });
  addEventListener('keydown', markTakeover, { once: true });
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude: lat, longitude: lng } = pos.coords;
        if (Number.isFinite(lat) && Number.isFinite(lng)) localStorage.setItem('fg_geo', JSON.stringify({ lat, lng }));
        if (userTookOver || sim.busy || !controls.enabled || app.state.origin || app.state.dest) return;
        flyToView(lat, lng, 1.7, 2.8);
      },
      () => {}, // denied/unavailable: keep whatever view we already chose
      { timeout: 8000, maximumAge: 600000 }
    );
  }
  if (reduced) { controls.autoRotate = false; ui.revealHud(); }
  else gsap.delayedCall(1.1, ui.revealHud);

  // ---------- render loop ----------
  const clock = new THREE.Clock();
  const _north = new THREE.Vector3();
  const _invQ = new THREE.Quaternion();
  const tileAttrib = document.getElementById('tile-attrib');
  let frames = 0, fpsTimer = 0, coordsTimer = 0;
  const renderFrame = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    // don't drift away from a live flight, and stay locked on a chosen city
    controls.autoRotate = !route.isActive && !app.state.origin && !app.state.dest;
    sim.advance(); // sets the plane's progress before the route positions it
    controls.update(dt);
    const altitude = camera.position.length() - 1;
    globe.update(dt, altitude);
    route.update(dt, camera);
    sim.updateCamera(); // chase cam needs the freshly-positioned plane
    tiles.enabled = true; // satellite tiles stay on during a flight too
    tiles.setBrightness(globe.brightness); // dim them in sync with the globe
    tiles.update(camera);
    tileAttrib.hidden = !tiles.active;
    pins.update(camera, innerWidth, innerHeight);
    cityLabels.setActive(sim.inFlight || sim.finishing); // big cities to spot in flight
    cityLabels.update(camera, innerWidth, innerHeight);
    capitals.setActive(!sim.busy && !route.isActive); // capitals clickable while browsing the globe
    capitals.update(camera, innerWidth, innerHeight);
    _north.set(0, 1, 0).applyQuaternion(_invQ.copy(camera.quaternion).invert());
    ui.updateCompass(Math.atan2(_north.x, _north.y) * 180 / Math.PI);

    frames++; fpsTimer += dt; coordsTimer += dt;
    if (fpsTimer >= 0.5) {
      ui.setFps(Math.round(frames / fpsTimer));
      frames = 0; fpsTimer = 0;
    }
    if (coordsTimer >= 0.1) {
      coordsTimer = 0;
      ui.setCoords(hoverLL, Math.round(altitude * 6371));
    }
    renderer.render(scene, camera);
  };
  renderer.setAnimationLoop(renderFrame);
}

boot().catch((err) => {
  loadStatus.textContent = `Something went wrong: ${err.message}`;
  loadBar.style.background = '#ff6b6b';
});
