// Board-the-flight simulation: boarding pass, seat + pomodoro flight-length,
// a bright establishing pan, then a dimmed flight you watch from one of three
// camera modes (top / whole-trip / behind). Exiting detaches to the whole-trip
// view and lets the plane finish; its line vanishes on landing.
import * as THREE from '../vendor/three/three.module.js';
import { formatInTz, tzAbbr, formatDuration } from './flight.js';
import { latLngToVec3, vec3ToLatLng } from './geo.js';

const SEAT_ROWS = 8;
const SEAT_LAYOUTS = {
  b789: ['ABC', 'DEF', 'GHJ'], b77w: ['ABC', 'DEFG', 'HJK'],
  a359: ['ABC', 'DEF', 'GHJ'], a339: ['AB', 'CDEF', 'GH'],
};
const TIMERS = [
  { s: 60, label: '1 min' }, { s: 300, label: '5 min' }, { s: 900, label: '15 min' },
  { s: 1500, label: '25 min' }, { s: 2700, label: '45 min' },
];
const DEFAULT_TIMER = 900;

function flightNumber(a, b) {
  let h = 0;
  for (const ch of a + b) h = (h * 31 + ch.charCodeAt(0)) % 899;
  return `FG ${100 + h}`;
}
function quatLookAt(from, to, up) {
  return new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().lookAt(from, to, up));
}

export class FlightSim {
  constructor({ camera, controls, route, globe, ui, audio, canvas, onStateChange, onFinish, onDeselect, onExitDone }) {
    this.camera = camera;
    this.controls = controls;
    this.route = route;
    this.globe = globe;
    this.ui = ui;
    this.audio = audio;
    this.onStateChange = onStateChange;
    this.onFinish = onFinish;
    this.onDeselect = onDeselect;
    this.onExitDone = onExitDone;
    this.inFlight = false;
    this.finishing = false;
    this.takingOff = false; // Board clicked, establishing pan running
    this.landed = false;
    this.followZoom = 1;
    this.camMode = 'top';
    this.orbitYaw = 0; // Behind-mode orbit around the plane (0 = directly behind)
    this.orbitPitch = 0;
    this.wallDurationS = DEFAULT_TIMER;
    this.boardingEl = document.getElementById('boarding');
    this.dashEl = document.getElementById('sim-dash');
    canvas.addEventListener('wheel', (e) => {
      if (this.inFlight && this.camMode !== 'full') this.zoomBy(Math.exp(e.deltaY * 0.0014));
    }, { passive: true });
    // drag to swing the camera around the aircraft while in Behind view
    let dragging = false, px = 0, py = 0;
    canvas.addEventListener('pointerdown', (e) => {
      if (e.button === 0 && this.inFlight && this.camMode === 'behind') { dragging = true; px = e.clientX; py = e.clientY; }
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      this.orbitYaw += (e.clientX - px) * 0.006;
      this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch - (e.clientY - py) * 0.005, -1.15, 1.15);
      px = e.clientX; py = e.clientY;
    });
    window.addEventListener('pointerup', () => { dragging = false; });
  }

  get busy() { return this.inFlight || this.finishing || this.takingOff; }

  // ---------- boarding ----------
  openBoarding(ctx) {
    if (!this.boardingEl.hidden) return; // already boarding — don't wipe the seat pick
    this.ctx = ctx;
    this.seat = null;
    this.wallDurationS = DEFAULT_TIMER;
    const { origin, dest, aircraft } = ctx;
    // real airport call signs (e.g. ARN, HND) — supplied by main from the atlas
    this.originCode = ctx.originCode || (origin.iata || origin.name.slice(0, 3)).toUpperCase();
    this.destCode = ctx.destCode || (dest.iata || dest.name.slice(0, 3)).toUpperCase();
    const now = new Date();
    this.gate = 'ABCDEF'[Math.floor(Math.random() * 6)] + (1 + Math.floor(Math.random() * 22));
    const gate = this.gate;
    this.flightNo = flightNumber(this.originCode, this.destCode);
    const dateStr = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: origin.tz }).format(now);
    const depStr = new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: origin.tz }).format(now);

    this.boardingEl.innerHTML = `
      <div class="boarding-card glass">
        <button class="card-close" id="bp-close" title="Not today">×</button>
        <div class="bp-eyebrow">Boarding pass</div>
        <div class="bp">
          <div class="bp-route">
            <div><div class="bp-code">${this.originCode}</div><div class="bp-city">${origin.name}</div></div>
            <svg class="bp-plane" viewBox="0 0 16 16"><path d="M8 1.5c.5 0 .9.4.9.9v4.1l5.6 3.2v1.6L8.9 9.6v3l1.6 1.2v1.2L8 14.4 5.5 15v-1.2L7.1 12.6v-3L1.5 11.3V9.7l5.6-3.2V2.4c0-.5.4-.9.9-.9z" fill="currentColor"/></svg>
            <div><div class="bp-code">${this.destCode}</div><div class="bp-city">${dest.name}</div></div>
          </div>
          <div class="bp-grid">
            <div><span>Flight</span><b>${this.flightNo}</b></div>
            <div><span>Date</span><b>${dateStr}</b></div>
            <div><span>Departs</span><b>${depStr}</b></div>
            <div><span>Gate</span><b>${gate}</b></div>
            <div><span>Seat</span><b id="bp-seat">——</b></div>
            <div><span>Aircraft</span><b>${aircraft.name}</b></div>
          </div>
          <div class="bp-strip"></div>
        </div>
        <div class="bp-seats-title">Choose your seat</div>
        <div class="seat-map" id="seat-map"></div>
        <div class="bp-seats-title">Flight length · sets how long the trip plays</div>
        <div class="timer-chips" id="timer-chips">
          ${TIMERS.map((t) => `<button class="timer-chip${t.s === this.wallDurationS ? ' is-on' : ''}" type="button" data-s="${t.s}">${t.label}</button>`).join('')}
        </div>
        <button class="btn btn--primary" id="bp-board" disabled>Pick a seat to board</button>
      </div>`;
    this.#buildSeatMap(aircraft);
    for (const chip of this.boardingEl.querySelectorAll('.timer-chip')) {
      chip.onclick = () => {
        this.wallDurationS = +chip.dataset.s;
        for (const c of this.boardingEl.querySelectorAll('.timer-chip')) c.classList.toggle('is-on', c === chip);
      };
    }
    this.boardingEl.hidden = false;
    gsap.fromTo(this.boardingEl.firstElementChild, { opacity: 0, y: 24, scale: 0.97 },
      { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'power3.out' });
    document.getElementById('bp-close').onclick = () => this.closeBoarding();
    document.getElementById('bp-board').onclick = () => this.#startBoarding();
  }

  boardRandomSeat() {
    if (this.boardingEl.hidden) return;
    if (!this.seat) {
      const avail = [...this.boardingEl.querySelectorAll('.seat:not(.is-occ)')];
      if (avail.length) this.#pickSeat(avail[Math.floor(Math.random() * avail.length)]);
    }
    if (this.seat) this.#startBoarding();
  }

  #buildSeatMap(aircraft) {
    const layout = SEAT_LAYOUTS[aircraft.id] || SEAT_LAYOUTS.b789;
    const map = document.getElementById('seat-map');
    for (let r = 1; r <= SEAT_ROWS; r++) {
      const row = document.createElement('div');
      row.className = 'seat-row';
      row.innerHTML = `<span class="seat-rownum">${r + 11}</span>`;
      layout.forEach((group, gi) => {
        const g = document.createElement('span');
        g.className = 'seat-group';
        for (const letter of group) {
          const seat = document.createElement('button');
          seat.type = 'button';
          seat.className = 'seat';
          seat.dataset.id = `${r + 11}${letter}`;
          if (Math.random() < 0.32) seat.classList.add('is-occ');
          else seat.onclick = () => this.#pickSeat(seat);
          g.appendChild(seat);
        }
        row.appendChild(g);
        if (gi < layout.length - 1) row.insertAdjacentHTML('beforeend', '<span class="seat-aisle"></span>');
      });
      map.appendChild(row);
    }
  }

  #pickSeat(el) {
    this.boardingEl.querySelector('.seat.is-sel')?.classList.remove('is-sel');
    el.classList.add('is-sel');
    this.seat = el.dataset.id;
    document.getElementById('bp-seat').textContent = this.seat;
    const btn = document.getElementById('bp-board');
    btn.disabled = false;
    btn.textContent = `Board · seat ${this.seat}`;
  }

  closeBoarding() { this.boardingEl.hidden = true; }

  // ---------- boarding sequence & flight ----------
  #startBoarding() {
    this.takingOff = true;
    this.audio?.prime(); // create/resume the audio graph inside the click gesture
    this.closeBoarding();
    document.body.classList.add('sim-on');
    this.globe.setBrightness(1.24, 0.7);
    this.ui.toast(`Seat ${this.seat} · welcome aboard`);
    const { origin } = this.ctx;
    this.controls.flyTo({ lat: origin.lat, lng: origin.lng, dist: 1.14, duration: 2.4 }); // zoom into the gate
    this.#showBoardingQueue(() => this.#begin());
    // begin even if the boarding queue is interrupted
    this.takeoffBackstop = gsap.delayedCall(11, () => this.#begin());
  }

  #showBoardingQueue(onDone) {
    const groups = ['Passengers needing assistance', 'First & Business', 'Sky Priority', 'Group 1', 'Group 2', 'Group 3'];
    const el = document.getElementById('board-queue');
    el.innerHTML = `
      <div class="bq-card glass">
        <div class="bq-head">
          <span class="bq-title">Now boarding</span>
          <span class="bq-flight">${this.flightNo} · Gate ${this.gate}</span>
        </div>
        <div class="bq-sub">Please have your boarding pass ready</div>
        <div class="bq-list">
          ${groups.map((g) => `<div class="bq-row"><span class="bq-dot"></span><span class="bq-name">${g}</span><span class="bq-check">✓</span></div>`).join('')}
        </div>
        <div class="bq-bar"><span id="bq-fill"></span></div>
        <div class="bq-foot" id="bq-foot">Boarding…</div>
      </div>`;
    el.hidden = false;
    const card = el.firstElementChild;
    const rows = [...el.querySelectorAll('.bq-row')];
    gsap.set(rows, { opacity: 0, x: -14 });
    const per = 0.95;
    const tl = gsap.timeline({
      onComplete: () => {
        gsap.to(card, { opacity: 0, scale: 0.95, duration: 0.45, ease: 'power2.in', onComplete: () => { el.hidden = true; } });
        onDone();
      },
    });
    tl.fromTo(card, { opacity: 0, y: 24, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.5)' });
    rows.forEach((row, i) => {
      const t = 0.5 + i * per;
      tl.to(row, { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out', onStart: () => row.classList.add('is-boarding') }, t);
      tl.add(() => { row.classList.remove('is-boarding'); row.classList.add('is-done'); }, t + per * 0.62);
      tl.to('#bq-fill', { width: `${((i + 1) / rows.length) * 100}%`, duration: per * 0.62, ease: 'power1.out' }, t);
    });
    tl.add(() => { const f = document.getElementById('bq-foot'); if (f) f.textContent = 'Boarding complete — cleared for pushback'; }, 0.5 + rows.length * per);
    tl.to({}, { duration: 1.0 }); // hold on "boarding complete"
    this.queueTl = tl;
  }

  #hideQueue() {
    this.queueTl?.kill();
    const bq = document.getElementById('board-queue');
    if (bq) bq.hidden = true;
  }

  #begin() {
    if (this.inFlight || this.finishing || !this.takingOff) return; // idempotent, cancellable
    this.takingOff = false;
    this.takeoffBackstop?.kill();
    this.#hideQueue();
    this.inFlight = true;
    this.finishing = false;
    this.landed = false;
    this.takeoff = new Date();
    this.flightStartPerf = performance.now();
    this.totalKm = this.route.totalKm;
    this.realFlightH = this.totalKm / this.ctx.aircraft.cruiseSpeedKmh;
    this.followZoom = 1;
    this.camMode = 'top';
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.route.enterSim();
    this.onStateChange(true);
    this.globe.setBrightness(0.46, 1.6);
    this.ui.toast(`${this.flightNo} cleared for takeoff ✈`);
    // sound: reset to 8% and start the engine drone
    this.audio?.setVolume(0.08);
    this.audio?.startEngine();
    this.#buildDashboard();
    this.#armBlend();
    this.lastDash = 0;
  }

  #armBlend() {
    this.blendStart = performance.now();
    this.startPos = this.camera.position.clone();
    this.startQuat = this.camera.quaternion.clone();
  }

  setCamMode(mode) {
    if (mode === 'behind' && this.camMode === 'behind') { // re-click recenters the orbit
      this.orbitYaw = 0; this.orbitPitch = 0;
      this.#armBlend();
      this.ui.toast('Recentered behind the plane');
      return;
    }
    if (this.camMode === mode) return;
    this.camMode = mode;
    if (mode === 'behind') {
      this.orbitYaw = 0; this.orbitPitch = 0;
      this.ui.toast('Behind view · drag to look around, click Behind to recenter');
    }
    this.#armBlend();
    for (const b of this.dashEl.querySelectorAll('.cam-mode')) b.classList.toggle('is-on', b.dataset.m === mode);
  }

  #frac() {
    if (this.flightStartPerf == null) return 0;
    return Math.min(1, (performance.now() - this.flightStartPerf) / (this.wallDurationS * 1000));
  }
  simNow() { return new Date(this.takeoff.getTime() + this.#frac() * this.realFlightH * 3600000); }

  advance() {
    if (this.finishing) {
      const t = Math.min(1, (performance.now() - this.exitStart) / this.exitDurMs);
      this.route.setProgressKm(this.exitFromKm + (this.totalKm - this.exitFromKm) * t);
      if (t >= 1) this.#finishExit();
      return;
    }
    if (!this.inFlight || this.landed) return;
    const frac = this.#frac();
    this.route.setProgressKm(frac * this.totalKm);
    if (frac >= 1) this.#land();
    if (performance.now() - this.lastDash > 250) {
      this.lastDash = performance.now();
      this.#refreshDashboard();
    }
  }

  #fullCam() {
    const { origin, dest } = this.ctx;
    const o = latLngToVec3(origin.lat, origin.lng, 1);
    const d = latLngToVec3(dest.lat, dest.lng, 1);
    const mid = o.clone().add(d).normalize();
    const angular = o.angleTo(d);
    const dist = THREE.MathUtils.clamp(1.28 + angular * 1.05, 1.8, 5.6);
    const camPos = mid.multiplyScalar(dist);
    return { camPos, q: quatLookAt(camPos, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)) };
  }

  updateCamera() {
    if (!this.inFlight) return; // during finishing the user owns the camera
    let camPos, q;
    if (this.camMode === 'full') {
      ({ camPos, q } = this.#fullCam());
    } else {
      const st = this.route.planeState();
      if (!st) return;
      const up = st.pos.clone().normalize();
      if (this.camMode === 'behind') {
        // orbit direction: start directly behind + slightly up, then swing by the user's yaw/pitch
        const right = new THREE.Vector3().crossVectors(up, st.fwd).normalize();
        const dir = st.fwd.clone().multiplyScalar(-1).addScaledVector(up, 0.34).normalize();
        dir.applyAxisAngle(up, this.orbitYaw);
        dir.applyAxisAngle(right.clone().applyAxisAngle(up, this.orbitYaw), this.orbitPitch);
        camPos = st.pos.clone().addScaledVector(dir, 0.06 * this.followZoom);
        q = quatLookAt(camPos, st.pos, up); // plane stays centered whatever the orbit
      } else {
        // top: a high overhead so you see plenty of ground around the plane
        camPos = st.pos.clone().addScaledVector(up, 0.16 * this.followZoom);
        q = quatLookAt(camPos, st.pos, st.fwd);
      }
      if (camPos.length() < 1.006) camPos.setLength(1.006);
    }
    const raw = Math.min(1, (performance.now() - this.blendStart) / 1300);
    const t = raw * raw * (3 - 2 * raw);
    this.camera.position.lerpVectors(this.startPos, camPos, t);
    this.camera.quaternion.slerpQuaternions(this.startQuat, q, t);
    this.camera.near = 0.0004;
    this.camera.far = 130;
    this.camera.updateProjectionMatrix();
  }

  zoomBy(f) { this.followZoom = THREE.MathUtils.clamp(this.followZoom * f, 0.4, 3.4); }

  // ---------- dashboard ----------
  #buildDashboard() {
    const { origin, dest } = this.ctx;
    this.dashEl.innerHTML = `
      <div class="dash-head">
        <span class="dash-route">${this.originCode} <span class="route-arrow">→</span> ${this.destCode} · ${this.flightNo}</span>
        <button class="btn btn--ghost dash-exit" id="dash-exit">Exit</button>
      </div>
      <div class="dash-timer-row">
        <span class="dash-status" id="dash-status" data-phase="lifting">Lifting off</span>
        <span class="dash-timer" id="dash-timer">--:--</span>
      </div>
      <div class="dash-bar"><span id="dash-fill"></span></div>
      <div class="dash-grid" id="dash-grid"></div>
      <div class="cam-modes">
        <button class="cam-mode is-on" data-m="top" type="button">Top</button>
        <button class="cam-mode" data-m="full" type="button">Trip</button>
        <button class="cam-mode" data-m="behind" type="button">Behind</button>
      </div>
      <div class="dash-audio">
        <svg class="dash-vol-icon" viewBox="0 0 16 16"><path d="M2 6h2.5L8 3v10L4.5 10H2z" fill="currentColor"/><path d="M10.5 5.5a3.3 3.3 0 0 1 0 5M12.4 3.6a6 6 0 0 1 0 8.8" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
        <input type="range" id="dash-vol" class="dash-vol" min="0" max="100" value="8" aria-label="Volume">
        <span class="dash-vol-val" id="dash-vol-val">8%</span>
      </div>`;
    this.dashEl.hidden = false;
    gsap.fromTo(this.dashEl, { opacity: 0, x: 16 }, { opacity: 1, x: 0, duration: 0.5, ease: 'power2.out' });
    document.getElementById('dash-exit').onclick = () => this.exit();
    for (const b of this.dashEl.querySelectorAll('.cam-mode')) b.onclick = () => this.setCamMode(b.dataset.m);
    const vol = document.getElementById('dash-vol');
    vol.value = 8; // force 8% each flight (the value attr isn't always honored via innerHTML)
    document.getElementById('dash-vol-val').textContent = '8%';
    vol.oninput = () => {
      this.audio?.setVolume(vol.value / 100);
      document.getElementById('dash-vol-val').textContent = `${vol.value}%`;
    };
    this.#refreshDashboard();
  }

  #refreshDashboard() {
    const { dest, aircraft } = this.ctx;
    const frac = this.#frac();
    const remWallS = Math.max(0, this.wallDurationS * (1 - frac));
    const now = this.landed ? this.landedAt : this.simNow();
    const arrival = this.landedAt || new Date(this.takeoff.getTime() + this.realFlightH * 3600000);
    const remKm = Math.max(0, (1 - frac) * this.totalKm);
    const remH = (1 - frac) * this.realFlightH;
    const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
    const mm = Math.floor(remWallS / 60), ss = Math.floor(remWallS % 60);
    const timerEl = document.getElementById('dash-timer');
    if (timerEl) timerEl.textContent = this.landed ? 'Arrived' : `${mm}:${String(ss).padStart(2, '0')}`;
    const phase = this.landed ? { t: 'Landed', k: 'landed' }
      : frac < 0.05 ? { t: 'Lifting off', k: 'lifting' }
      : frac > 0.9 ? { t: 'Landing', k: 'landing' }
      : { t: 'En route', k: 'route' };
    const statusEl = document.getElementById('dash-status');
    if (statusEl) { statusEl.textContent = phase.t; statusEl.dataset.phase = phase.k; }
    document.getElementById('dash-fill').style.width = `${frac * 100}%`;
    // live altitude: climb over the first stretch, cruise, then descend
    const cruiseFt = aircraft.cruiseAltitudeFt;
    const altFt = frac < 0.08 ? cruiseFt * (frac / 0.08)
      : frac > 0.92 ? cruiseFt * ((1 - frac) / 0.08) : cruiseFt;
    const altSub = frac < 0.08 ? 'climbing' : frac > 0.92 ? 'descending' : `FL${Math.round(cruiseFt / 100)}`;
    const cell = (l, v, s = '') =>
      `<div class="stat"><div class="stat-label">${l}</div><div class="stat-value stat-value--sm">${v}</div>${s ? `<div class="stat-sub">${s}</div>` : ''}</div>`;
    document.getElementById('dash-grid').innerHTML = this.landed
      ? cell('Landed', formatInTz(this.landedAt, dest.tz), `${tzAbbr(this.landedAt, dest.tz)} · ${dest.name}`)
        + cell('Flight time', formatDuration(this.landedDurH), 'gate to gate')
      : cell(`Time · ${this.destCode}`, formatInTz(now, dest.tz), tzAbbr(now, dest.tz))
        + cell('Arrival · local', formatInTz(arrival, dest.tz), tzAbbr(arrival, dest.tz))
        + cell('Remaining', formatDuration(remH), `${nf.format(remKm)} km to go`)
        + cell('Altitude', `${nf.format(Math.round(altFt / 500) * 500)} ft`, altSub)
        + cell('Cruise', `${nf.format(aircraft.cruiseSpeedKmh)} km/h`, `${aircraft.maxPassengers} seats`);
  }

  #land() {
    if (this.landed) return;
    this.landed = true;
    this.landedDurH = this.realFlightH;
    this.landedAt = new Date(this.takeoff.getTime() + this.realFlightH * 3600000);
    this.route.setProgressKm(this.totalKm);
    this.audio?.stopEngine();
    this.ui.toast(`Welcome to ${this.ctx.dest.name} — seat ${this.seat}`);
    this.#refreshDashboard();
    this.landTimer = gsap.delayedCall(5.5, () => this.finish());
  }

  // natural completion: deselect and ease from a close-up of the city out to space
  finish() {
    if (!this.inFlight) return;
    this.landTimer?.kill();
    const dest = this.ctx.dest;
    this.inFlight = false;
    this.dashEl.hidden = true;
    this.audio?.silence();
    this.globe.setBrightness(1, 1.8);
    this.route.exitSim();
    this.onStateChange(false);
    this.onFinish?.(dest);
  }

  // manual exit: detach to the whole-trip view, deselect, let the plane finish,
  // then the line disappears
  exit(silent = false) {
    if (this.finishing) return;
    if (this.takingOff) { // cancel boarding before the wheels leave the ground
      this.takingOff = false;
      this.takeoffBackstop?.kill();
      this.#hideQueue();
      this.controls.flying?.kill();
      this.controls.flying = null;
      document.body.classList.remove('sim-on');
      this.audio?.silence();
      this.globe.setBrightness(1, 0.8);
      if (!silent) this.ui.toast('Boarding cancelled');
      return;
    }
    if (!this.inFlight) { this.closeBoarding(); return; }
    this.landTimer?.kill();
    this.finishing = true;
    this.inFlight = false;
    this.dashEl.hidden = true;
    // hand the camera to the user so they can look around while it finishes,
    // after a gentle glide out to frame the whole trip
    document.body.classList.remove('sim-on');
    const here = vec3ToLatLng(this.camera.position);
    this.controls.jumpTo(here.lat, here.lng, this.camera.position.length());
    this.controls.enabled = true;
    const { origin, dest } = this.ctx;
    const mid = latLngToVec3(origin.lat, origin.lng, 1).add(latLngToVec3(dest.lat, dest.lng, 1)).normalize();
    const midLL = vec3ToLatLng(mid);
    const angular = latLngToVec3(origin.lat, origin.lng, 1).angleTo(latLngToVec3(dest.lat, dest.lng, 1));
    this.controls.flyTo({ lat: midLL.lat, lng: midLL.lng, dist: THREE.MathUtils.clamp(1.35 + angular * 1.05, 1.9, 5.6), duration: 1.8 });
    this.onDeselect?.(); // clear pins + planner, keep the route + plane + dest pin
    this.exitStart = performance.now();
    this.exitFromKm = this.route.progressKm;
    const remainingFrac = 1 - (this.exitFromKm / this.totalKm);
    this.exitDurMs = THREE.MathUtils.clamp(remainingFrac * 4200 + 900, 1200, 5200);
    if (!silent) this.ui.toast('Watch it land — drag to look around');
  }

  #finishExit() {
    this.finishing = false;
    this.audio?.silence();
    this.globe.setBrightness(1, 1.6);
    this.route.exitSim();
    this.onExitDone?.(); // clear route (line disappears) + pins; camera stays with the user
  }

  // hard stop (used by global reset) — no animation
  kill() {
    this.landTimer?.kill();
    this.takeoffBackstop?.kill();
    this.#hideQueue();
    this.inFlight = false;
    this.finishing = false;
    this.takingOff = false;
    this.dashEl.hidden = true;
    this.closeBoarding();
    this.audio?.silence();
    this.globe.setBrightness(1, 0.4);
    document.body.classList.remove('sim-on');
    this.controls.enabled = true;
  }
}
