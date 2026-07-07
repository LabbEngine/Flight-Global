// Board-the-flight simulation: boarding pass, seat + pomodoro flight-length,
// a bright establishing pan, then a dimmed flight you watch from one of three
// camera modes (top / whole-trip / behind). Exiting detaches to the whole-trip
// view and lets the plane finish; its line vanishes on landing.
import * as THREE from '../vendor/three/three.module.js';
import { formatInTz, tzAbbr, formatDuration } from './flight.js';
import { latLngToVec3, vec3ToLatLng } from './geo.js';
import { CabinView, ROWS } from './cabin.js';
import { tierFor } from './membership.js';

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
    this.orbitYaw = 0; // Behind-view drag: swing around the plane (0 = directly behind)
    this.orbitPitch = 0;
    this.tripMinutes = 15; this.layoverMinutes = 5; // set from the planner when you board
    this.boardingEl = document.getElementById('boarding');
    this.dashEl = document.getElementById('sim-dash');
    this.cabinEl = document.getElementById('cabin-view');
    this.cabin = new CabinView(this.cabinEl); // first-person window-seat scene (lazy WebGL)
    this.cabin.onExit = () => this.setCamMode('full'); // "Earth view" button → back to the globe
    canvas.addEventListener('wheel', (e) => {
      if (this.inFlight && this.camMode !== 'full' && this.camMode !== 'cabin') this.zoomBy(Math.exp(e.deltaY * 0.0014));
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
    this.simAirports = true; // also play the airport at each connecting stop (board always plays it)
    this.tripMinutes = ctx.tripMinutes || 15;
    this.layoverMinutes = ctx.layoverMinutes || 5;
    const multiLeg = (ctx.flight?.legs?.length || 1) > 1;
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
        <div class="bp-eyebrow">Boarding pass<span class="bp-tier" style="--tc:${tierFor().color}">${tierFor().name}</span></div>
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
        <div class="cabin-map">
          <div class="cabin-nose">
            <svg viewBox="0 0 234 58" preserveAspectRatio="none" aria-hidden="true">
              <defs><linearGradient id="fuseNose" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2b313a"/><stop offset="1" stop-color="#12151b"/></linearGradient></defs>
              <path d="M117 3 C58 3 14 25 6 58 L228 58 C220 25 176 3 117 3 Z" fill="url(#fuseNose)" stroke="rgba(255,255,255,0.05)" stroke-width="1"/>
              <path d="M117 17 C97 17 81 26 75 39 L159 39 C153 26 137 17 117 17 Z" fill="rgba(130,165,200,0.14)"/>
              <path d="M117 17 L117 39" stroke="rgba(20,24,30,0.6)" stroke-width="1.4"/>
            </svg>
          </div>
          <div class="cabin-body">
            <div class="cabin-cols"><span>A</span><span>B</span><span>C</span><span></span><span>D</span><span>E</span><span>F</span></div>
            <div class="seat-map" id="seat-map"></div>
          </div>
        </div>
        <div class="bp-trip">${this.#tripSummary()}</div>
        ${multiLeg ? `<button class="bp-simair is-on" id="bp-simair" type="button"><span class="simair-check"></span><span>Airport at each stop</span><span class="simair-hint">play a pitstop at every connection</span></button>` : ''}
        <button class="btn btn--primary" id="bp-board" disabled>Pick a seat to board</button>
      </div>`;
    this.#buildSeatMap();
    this.boardingEl.hidden = false;
    gsap.fromTo(this.boardingEl.firstElementChild, { opacity: 0, y: 24, scale: 0.97 },
      { opacity: 1, y: 0, scale: 1, duration: 0.45, ease: 'power3.out' });
    document.getElementById('bp-close').onclick = () => this.closeBoarding();
    document.getElementById('bp-board').onclick = () => this.#startBoarding();
    const simBtn = document.getElementById('bp-simair');
    if (simBtn) simBtn.onclick = () => { this.simAirports = !this.simAirports; simBtn.classList.toggle('is-on', this.simAirports); };
  }

  boardRandomSeat() {
    if (this.boardingEl.hidden) return;
    if (!this.seat) {
      const avail = [...this.boardingEl.querySelectorAll('.seat:not(.is-occ)')];
      if (avail.length) this.#pickSeat(avail[Math.floor(Math.random() * avail.length)]);
    }
    if (this.seat) this.#startBoarding();
  }

  #buildSeatMap() {
    const map = document.getElementById('seat-map');
    const groups = [['A', 'B', 'C'], ['D', 'E', 'F']]; // 3-3, matching the cabin
    for (let r = 1; r <= ROWS; r++) {
      const row = document.createElement('div');
      row.className = 'seat-row';
      groups.forEach((group, gi) => {
        const g = document.createElement('span');
        g.className = 'seat-group';
        for (const letter of group) {
          const seat = document.createElement('button');
          seat.type = 'button';
          seat.className = 'seat';
          seat.dataset.id = `${r}${letter}`;
          if (Math.random() < 0.3) seat.classList.add('is-occ');
          else seat.onclick = () => this.#pickSeat(seat);
          g.appendChild(seat);
        }
        row.appendChild(g);
        // row number sits in the centre aisle, between the two seat blocks
        if (gi === 0) row.insertAdjacentHTML('beforeend', `<span class="seat-rownum">${String(r).padStart(2, '0')}</span>`);
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
    const { origin, dest } = this.ctx;
    this.controls.flyTo({ lat: origin.lat, lng: origin.lng, dist: 1.14, duration: 2.4 }); // zoom into the gate
    // pressing Board plays the 2D airport to your gate & seat; take off when you board (or skip)
    this.#playAirport({
      origin: this.originCode, originCity: origin.name, dest: this.destCode, destCity: dest.name,
      seat: this.seat, member: tierFor().name, flight: this.flightNo, gate: this.gate,
    }).then(() => this.#begin());
  }

  #showBoardingQueue(onDone, opts = {}) {
    const tier = tierFor();
    const groups = [
      { name: 'Passengers needing assistance', tier: null },
      { name: 'Premium · First to board', tier: 'premium' },
      { name: 'Platinum · Sky Priority', tier: 'platinum' },
      { name: 'Gold · Priority', tier: 'gold' },
      { name: 'Silver · Main cabin', tier: 'silver' },
      { name: 'General boarding', tier: null },
    ];
    const youIdx = Math.max(0, groups.findIndex((g) => g.tier === tier.key));
    const el = document.getElementById('board-queue');
    const title = opts.title || 'Now boarding';
    const flightLine = opts.flight || `${this.flightNo} · Gate ${this.gate}`;
    const footEnd = opts.footEnd || "You're aboard — cleared for pushback";
    el.innerHTML = `
      <div class="bq-card glass">
        <div class="bq-head">
          <span class="bq-title">${title}</span>
          <span class="bq-flight">${flightLine}</span>
        </div>
        <div class="bq-sub"><b style="color:${tier.color}">${tier.name} member</b> · you're in group ${youIdx + 1} of ${groups.length}</div>
        <div class="bq-list">
          ${groups.map((g, i) => `<div class="bq-row${i === youIdx ? ' is-you' : ''}"><span class="bq-dot"></span><span class="bq-name">${g.name}</span>${i === youIdx ? `<span class="bq-you" style="--tc:${tier.color}">YOU</span>` : '<span class="bq-check">✓</span>'}</div>`).join('')}
        </div>
        <div class="bq-bar"><span id="bq-fill"></span></div>
        <div class="bq-foot" id="bq-foot">Boarding…</div>
      </div>`;
    el.hidden = false;
    const card = el.firstElementChild;
    const rows = [...el.querySelectorAll('.bq-row')];
    gsap.set(rows, { opacity: 0, x: -14 });
    const per = 0.9;
    const boardCount = youIdx + 1; // your group + everyone ahead — you don't wait for the rest
    const tl = gsap.timeline({
      onComplete: () => {
        gsap.to(card, { opacity: 0, scale: 0.95, duration: 0.45, ease: 'power2.in', onComplete: () => { el.hidden = true; } });
        if (onDone) onDone();
      },
    });
    tl.fromTo(card, { opacity: 0, y: 24, scale: 0.9 }, { opacity: 1, y: 0, scale: 1, duration: 0.6, ease: 'back.out(1.5)' });
    rows.forEach((row, i) => {
      if (i > youIdx) { tl.to(row, { opacity: 0.45, x: 0, duration: 0.3 }, 0.5); return; } // still queued behind you
      const t = 0.5 + i * per;
      tl.to(row, { opacity: 1, x: 0, duration: 0.4, ease: 'power2.out', onStart: () => row.classList.add('is-boarding') }, t);
      tl.add(() => { row.classList.remove('is-boarding'); row.classList.add('is-done'); }, t + per * 0.62);
      tl.to('#bq-fill', { width: `${((i + 1) / boardCount) * 100}%`, duration: per * 0.62, ease: 'power1.out' }, t);
    });
    tl.add(() => { const f = document.getElementById('bq-foot'); if (f) f.textContent = footEnd; }, 0.5 + boardCount * per);
    tl.to({}, { duration: 0.9 });
    this.queueTl = tl;
  }

  // Launch the 2D airport minigame overlay; resolves when the player boards (or skips).
  #playAirport(params) {
    return new Promise((resolve) => {
      const host = document.getElementById('airport-game');
      const frame = document.getElementById('airport-frame');
      if (!host || !frame) { resolve(); return; }
      const onMsg = (e) => {
        if (!e.data || e.data.type !== 'airport-done') return;
        window.removeEventListener('message', onMsg);
        setTimeout(() => { host.hidden = true; frame.src = 'about:blank'; resolve(); }, e.data.skipped ? 200 : 1500);
      };
      window.addEventListener('message', onMsg);
      frame.src = 'airport.html?' + new URLSearchParams(params).toString();
      host.hidden = false;
    });
  }
  #pauseJourney() { if (!this._pauseAt) this._pauseAt = performance.now(); }        // freeze the flight timeline
  #skipJourneyTo(t) { this._pauseAt = 0; this.flightStartPerf = performance.now() - t * 1000; } // resume, jump to time t
  // A connecting airport: pause the flight, play the pitstop game, then depart the next leg.
  #airportStop(stopIdx, stopEndS) {
    this.#pauseJourney();
    const flight = this.ctx.flight || {};
    const stop = flight.stops?.[stopIdx];
    const nextLeg = (flight.legs || [])[stopIdx + 1];
    this.#playAirport({
      origin: this.#wpCode(stop), originCity: stop?.name || '',
      dest: nextLeg ? this.#wpCode(nextLeg.to) : this.destCode, destCity: nextLeg?.to?.name || this.ctx.dest.name,
      seat: this.seat, member: tierFor().name, flight: this.flightNo, gate: this.gate,
    }).then(() => this.#skipJourneyTo(stopEndS));
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
    this.#buildJourney();
    this.followZoom = 1;
    this.camMode = 'top';
    this.orbitYaw = 0;
    this.orbitPitch = 0;
    this.#hideCabin();
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
    if (mode === this.camMode) { // re-click recenters the Behind orbit / Cabin gaze
      if (mode === 'behind' || mode === 'cabin') {
        this.orbitYaw = 0; this.orbitPitch = 0;
        this.#armBlend();
        this.ui.toast(mode === 'cabin' ? 'Recentered your window view' : 'Recentered behind the plane');
      }
      return;
    }
    const leavingCabin = this.camMode === 'cabin';
    this.camMode = mode;
    this.orbitYaw = 0; this.orbitPitch = 0;
    if (leavingCabin) this.#setCabin(false);
    if (mode === 'behind') this.ui.toast('Behind view · drag to look around, click Behind to recenter');
    if (mode === 'cabin') { this.#setCabin(true); this.ui.toast('Window seat · drag to look around'); }
    this.#armBlend();
    for (const b of this.dashEl.querySelectorAll('.cam-mode')) b.classList.toggle('is-on', b.dataset.m === mode);
  }

  // Build the real-time timeline: fly each leg for its share of the trip time,
  // then wait `layoverMinutes` at each connecting airport before the next leg.
  #buildJourney() {
    const legs = this.route.legs || [];
    const waitS = (this.layoverMinutes || 0) * 60;
    const stops = Math.max(0, legs.length - 1);
    const flyingS = Math.max(20, (this.tripMinutes || 15) * 60 - stops * waitS);
    this.journey = [];
    let t = 0;
    for (let i = 0; i < legs.length; i++) {
      const dur = this.totalKm > 0 ? flyingS * (legs[i].distKm / this.totalKm) : flyingS;
      this.journey.push({ type: 'fly', legIdx: i, t0: t, t1: t + dur, km0: legs[i].startKm, km1: legs[i].startKm + legs[i].distKm });
      t += dur;
      if (i < legs.length - 1) { this.journey.push({ type: 'stop', stopIdx: i, t0: t, t1: t + waitS, km: legs[i].startKm + legs[i].distKm }); t += waitS; }
    }
    this.journeyDurS = Math.max(1, t);
    this.atStop = null;
    this._shownStop = -1; // last connecting airport we played the pitstop for
    this._pauseAt = 0; // >0 while the flight timeline is frozen for the airport game
    this.legIdx = 0; // which leg is current, for the "Leg" camera + dashboard readout
  }
  #stopName(i) { const s = this.ctx.flight?.stops?.[i]; return s ? (s.iata || s.name) : 'stop'; }

  #elapsedS() { return this.flightStartPerf == null ? 0 : (performance.now() - this.flightStartPerf) / 1000; }
  #frac() { return this.journeyDurS ? Math.min(1, this.#elapsedS() / this.journeyDurS) : 0; }
  simNow() { return new Date(this.takeoff.getTime() + this.#frac() * this.realFlightH * 3600000); }

  advance() {
    if (this.finishing) {
      const t = Math.min(1, (performance.now() - this.exitStart) / this.exitDurMs);
      this.route.setProgressKm(this.exitFromKm + (this.totalKm - this.exitFromKm) * t);
      if (t >= 1) this.#finishExit();
      return;
    }
    if (!this.inFlight || this.landed) return;
    if (this._pauseAt) return; // frozen while the airport pitstop game is up
    const el = this.#elapsedS();
    let ph = this.journey[this.journey.length - 1];
    for (const p of this.journey) { if (el < p.t1) { ph = p; break; } }
    if (ph && ph.type === 'stop') {
      this.route.setProgressKm(ph.km);
      this.atStop = { name: this.#stopName(ph.stopIdx), remainS: Math.max(0, ph.t1 - el) };
      if (this.simAirports && this._shownStop !== ph.stopIdx) {
        this._shownStop = ph.stopIdx; // once, when we first reach this airport
        this.#airportStop(ph.stopIdx, ph.t1);
      }
    } else if (ph) {
      const f = ph.t1 > ph.t0 ? Math.min(1, (el - ph.t0) / (ph.t1 - ph.t0)) : 1;
      this.route.setProgressKm(ph.km0 + (ph.km1 - ph.km0) * f);
      this.atStop = null;
    }
    this.route.setParked(this.atStop != null); // landed at a connecting airport → hide the plane
    // track the current leg (during a layover, the leg you're about to depart on)
    const nLegs = this.route.legs?.length || 1;
    const newLeg = !ph ? this.legIdx
      : ph.type === 'stop' ? Math.min(nLegs - 1, ph.stopIdx + 1)
      : ph.legIdx;
    if (newLeg !== this.legIdx) {
      this.legIdx = newLeg;
      if (this.camMode === 'leg') this.#armBlend(); // glide smoothly onto the new leg
    }
    if (el >= this.journeyDurS) this.#land();
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

  // frame just the current leg: current sub-origin → current sub-destination
  #legCam(i) {
    const legs = this.ctx.flight?.legs || [];
    if (!legs.length) return this.#fullCam();
    const leg = legs[THREE.MathUtils.clamp(i, 0, legs.length - 1)];
    const o = latLngToVec3(leg.from.lat, leg.from.lng, 1);
    const d = latLngToVec3(leg.to.lat, leg.to.lng, 1);
    const mid = o.clone().add(d).normalize();
    const angular = o.angleTo(d);
    const dist = THREE.MathUtils.clamp(1.16 + angular * 1.15, 1.55, 5.2); // tighter than the full-trip frame
    const camPos = mid.multiplyScalar(dist);
    return { camPos, q: quatLookAt(camPos, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1, 0)) };
  }
  #wpCode(p) { return String((p && (p.iata || p.name?.slice(0, 3))) || '—').toUpperCase(); }

  updateCamera() {
    if (!this.inFlight) return; // during finishing the user owns the camera
    if (this.camMode === 'cabin') return; // Cabin is a DOM scene; the 3D camera sits idle
    let camPos, q;
    if (this.camMode === 'full') {
      ({ camPos, q } = this.#fullCam());
    } else if (this.camMode === 'leg') {
      ({ camPos, q } = this.#legCam(this.legIdx));
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
        camPos = st.pos.clone().addScaledVector(dir, 0.042 * this.followZoom);
        q = quatLookAt(camPos, st.pos, up); // plane stays centered whatever the orbit
      } else {
        // top: a lower overhead so the satellite ground renders in high detail
        camPos = st.pos.clone().addScaledVector(up, 0.085 * this.followZoom);
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

  zoomBy(f) { this.followZoom = THREE.MathUtils.clamp(this.followZoom * f, 0.2, 3.4); } // 0.2 = zoom in twice as close

  // ---------- dashboard ----------
  #buildDashboard() {
    const { origin, dest } = this.ctx;
    const multi = (this.route.legs?.length || 1) > 1;
    this.dashEl.innerHTML = `
      <div class="dash-head">
        <span class="dash-route">${this.originCode} <span class="route-arrow">→</span> ${this.destCode} · ${this.flightNo}</span>
        <button class="btn btn--ghost dash-exit" id="dash-exit">Exit</button>
      </div>
      <div class="dash-leg" id="dash-leg" hidden></div>
      <div class="dash-timer-row">
        <span class="dash-status" id="dash-status" data-phase="lifting">Lifting off</span>
        <span class="dash-timer" id="dash-timer">--:--</span>
      </div>
      <div class="dash-bar"><span id="dash-fill"></span></div>
      <div class="dash-grid" id="dash-grid"></div>
      <div class="cam-modes">
        <button class="cam-mode is-on" data-m="top" type="button">Top</button>
        <button class="cam-mode" data-m="full" type="button">Trip</button>
        ${multi ? '<button class="cam-mode" data-m="leg" type="button">Leg</button>' : ''}
        <button class="cam-mode" data-m="behind" type="button">Behind</button>
        <button class="cam-mode" data-m="cabin" type="button">Cabin</button>
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
    const remWallS = Math.max(0, this.journeyDurS - this.#elapsedS());
    const now = this.landed ? this.landedAt : this.simNow();
    const arrival = this.landedAt || new Date(this.takeoff.getTime() + this.realFlightH * 3600000);
    const remKm = Math.max(0, (1 - frac) * this.totalKm);
    const remH = (1 - frac) * this.realFlightH;
    const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });
    const mm = Math.floor(remWallS / 60), ss = Math.floor(remWallS % 60);
    const timerEl = document.getElementById('dash-timer');
    if (timerEl) timerEl.textContent = this.landed ? 'Arrived' : `${mm}:${String(ss).padStart(2, '0')}`;
    const atStop = this.atStop;
    // current-leg readout for connecting flights (which sub-trip you're on)
    const legEl = document.getElementById('dash-leg');
    if (legEl) {
      const legs = this.ctx.flight?.legs || [];
      if (legs.length > 1 && !this.landed) {
        const leg = legs[Math.min(this.legIdx, legs.length - 1)];
        const from = this.#wpCode(leg.from), to = this.#wpCode(leg.to);
        legEl.hidden = false;
        legEl.innerHTML = atStop
          ? `<span class="leg-count">Landed</span> ${from} <span class="leg-arrow">→</span> ${to}`
          : `<span class="leg-count">Leg ${this.legIdx + 1}/${legs.length}</span> ${from} <span class="leg-arrow">→</span> ${to}`;
      } else {
        legEl.hidden = true;
      }
    }
    const phase = this.landed ? { t: 'Landed', k: 'landed' }
      : atStop ? { t: `Landed · ${atStop.name}`, k: 'landed' }
      : frac < 0.05 ? { t: 'Lifting off', k: 'lifting' }
      : frac > 0.94 ? { t: 'Landing', k: 'landing' }
      : { t: 'En route', k: 'route' };
    const statusEl = document.getElementById('dash-status');
    if (statusEl) { statusEl.textContent = phase.t; statusEl.dataset.phase = phase.k; }
    document.getElementById('dash-fill').style.width = `${frac * 100}%`;
    // live altitude: on the ground during a layover, else climb / cruise / descend
    const cruiseFt = aircraft.cruiseAltitudeFt;
    const altFt = atStop ? 0 : frac < 0.08 ? cruiseFt * (frac / 0.08)
      : frac > 0.92 ? cruiseFt * ((1 - frac) / 0.08) : cruiseFt;
    const altSub = atStop ? `on the ground · ${Math.ceil(atStop.remainS)}s` : frac < 0.08 ? 'climbing' : frac > 0.92 ? 'descending' : `FL${Math.round(cruiseFt / 100)}`;
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
    // feed the live seat-back data screen inside the cabin view
    this.cabin?.setFlightData({
      route: `${this.originCode} → ${this.destCode}`,
      flightNo: this.flightNo,
      status: phase.t,
      timer: this.landed ? 'Arrived' : `${mm}:${String(ss).padStart(2, '0')}`,
      alt: this.landed ? '—' : `${nf.format(Math.round(altFt / 500) * 500)} ft`,
      eta: formatInTz(arrival, dest.tz),
      etaZone: tzAbbr(arrival, dest.tz),
      remaining: this.landed ? 'Arrived' : formatDuration(remH),
      progress: frac,
    });
  }

  #land() {
    if (this.landed) return;
    this.landed = true;
    this.atStop = null;
    this.landedDurH = this.realFlightH;
    this.landedAt = new Date(this.takeoff.getTime() + this.realFlightH * 3600000);
    this.route.setProgressKm(this.totalKm);
    this.audio?.stopEngine();
    this.#showArrival();
    this.ui.toast(`Welcome to ${this.ctx.dest.name} — seat ${this.seat}`);
    this.#refreshDashboard();
    this.landTimer = gsap.delayedCall(6, () => this.finish());
  }

  // the pop-in arrival card the moment the plane touches the destination
  #showArrival() {
    const el = document.getElementById('arrival-card');
    if (!el) return;
    const dest = this.ctx.dest;
    el.innerHTML = `
      <div class="arr-card glass">
        <div class="arr-badge">✦ Arrived</div>
        <div class="arr-city">${dest.name}</div>
        <div class="arr-sub">${this.originCode} → ${this.destCode} · seat ${this.seat}</div>
        <div class="arr-row"><span>Flight time</span><b>${formatDuration(this.landedDurH)}</b></div>
        <div class="arr-row"><span>Arrived</span><b>${formatInTz(this.landedAt, dest.tz)} ${tzAbbr(this.landedAt, dest.tz)}</b></div>
      </div>`;
    el.hidden = false;
    const card = el.firstElementChild;
    gsap.fromTo(card, { opacity: 0, scale: 0.55, y: 24 }, { opacity: 1, scale: 1, y: 0, duration: 0.75, ease: 'back.out(1.7)' });
    gsap.to(card, { opacity: 0, scale: 0.92, duration: 0.4, delay: 5.0, ease: 'power2.in', onComplete: () => { el.hidden = true; } });
  }

  #tripSummary() {
    const stops = Math.max(0, (this.ctx.flight?.legs?.length || 1) - 1);
    const stopTxt = stops ? ` · ${stops} stop${stops > 1 ? 's' : ''} × ${this.layoverMinutes} min wait` : ' · non-stop';
    return `Plays over <b>${this.tripMinutes} min</b>${stopTxt}`;
  }

  // natural completion: deselect and ease from a close-up of the city out to space
  finish() {
    if (!this.inFlight) return;
    this.landTimer?.kill();
    const dest = this.ctx.dest;
    this.inFlight = false;
    this.dashEl.hidden = true;
    this.#hideCabin();
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
    this.#hideCabin();
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

  // ---------- first-person cabin (window seat) ----------
  #setCabin(on) {
    if (on) { this.dashEl.hidden = true; this.cabin?.enter(this.seat); }
    else { this.dashEl.hidden = false; this.cabin?.exit(); }
  }

  #hideCabin() { this.cabin?.exit(); }

  // hard stop (used by global reset) — no animation
  kill() {
    this.landTimer?.kill();
    this.takeoffBackstop?.kill();
    this.#hideQueue();
    this.inFlight = false;
    this.finishing = false;
    this.takingOff = false;
    this.dashEl.hidden = true;
    this.#hideCabin();
    this.closeBoarding();
    this.audio?.silence();
    this.globe.setBrightness(1, 0.4);
    document.body.classList.remove('sim-on');
    this.controls.enabled = true;
  }
}
