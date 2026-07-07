// Everything DOM: planner card, info panel, place/context cards, HUD controls,
// toasts, keyboard shortcuts. main.js owns state; this renders it.
import { formatInTz, tzAbbr, formatDuration } from './flight.js';
import { formatLatLng } from './geo.js';

const nf = new Intl.NumberFormat('en-GB', { maximumFractionDigits: 0 });

// Per-aircraft silhouette parameters and accent color for the fleet picker.
const AC_ART = {
  b789: { len: 1.0, span: 1.0, sweep: 1.0, tip: 'raked', color: '#93b7d4' },
  b77w: { len: 1.13, span: 1.05, sweep: 0.82, tip: 'raked', color: '#a9a2c0' },
  a359: { len: 1.03, span: 1.0, sweep: 0.94, tip: 'sharklet', color: '#8ebfa3' },
  a339: { len: 0.9, span: 0.93, sweep: 0.78, tip: 'sharklet', color: '#c6b183' },
};
const AC_ART_FALLBACK = { len: 1.0, span: 1.0, sweep: 0.9, tip: 'raked', color: '#93b7d4' };

// Top-view airliner silhouette, parametrised so each type genuinely differs.
function planeSvg(id) {
  const a = AC_ART[id] ?? AC_ART_FALLBACK;
  const noseY = 4, L = Math.min(52 * a.len, 58);
  const tailY = noseY + L;
  const S = 25 * a.span;
  const wy = noseY + L * 0.38;
  const D = 11 * a.sweep;
  const tipW = a.tip === 'raked' ? 1.4 : 3.0;
  const winglets = a.tip === 'sharklet'
    ? `<path d="M${32 + S} ${wy + D} l2.3 -3.4 l1.5 1.3 l-1.9 3.6 z" opacity="0.9"/>
       <path d="M${32 - S} ${wy + D} l-2.3 -3.4 l-1.5 1.3 l1.9 3.6 z" opacity="0.9"/>` : '';
  const ty = tailY - 9;
  return `<svg viewBox="0 0 64 64" fill="currentColor" aria-hidden="true">
    <ellipse cx="32" cy="${noseY + L / 2}" rx="2.9" ry="${L / 2}"/>
    <path d="M33.5 ${wy} L${32 + S} ${wy + D} l0 ${tipW} L34 ${wy + 13} z"/>
    <path d="M30.5 ${wy} L${32 - S} ${wy + D} l0 ${tipW} L30 ${wy + 13} z"/>
    ${winglets}
    <path d="M33 ${ty} L${32 + 10.5} ${ty + 4.6} l0 2 L33 ${ty + 6.6} z"/>
    <path d="M31 ${ty} L${32 - 10.5} ${ty + 4.6} l0 2 L31 ${ty + 6.6} z"/>
    <rect x="${32 + S * 0.34 - 1.6}" y="${wy + D * 0.34 - 2.6}" width="3.2" height="7.4" rx="1.5" opacity="0.85"/>
    <rect x="${32 - S * 0.34 - 1.6}" y="${wy + D * 0.34 - 2.6}" width="3.2" height="7.4" rx="1.5" opacity="0.85"/>
    <rect x="31.2" y="${tailY - 8}" width="1.6" height="7" rx="0.8" opacity="0.6"/>
  </svg>`;
}

export function initUI(app) {
  const $ = (id) => document.getElementById(id);
  const els = {
    originSlot: $('origin-slot'), destSlot: $('dest-slot'),
    swap: $('swap-btn'),
    acCurrent: $('ac-current'), acMenu: $('ac-menu'), acPicker: $('ac-picker'),
    departure: $('departure-input'), calc: $('calc-btn'),
    placeCard: $('place-card'), contextCard: $('context-card'),
    infoPanel: $('info-panel'), infoBody: $('info-body'),
    toast: $('toast'), coords: $('coords'), fps: $('fps'),
    compassRose: $('compass-rose'), searchInput: $('search-input'),
    themeBtn: $('theme-btn'), fsBtn: $('fs-btn'),
    planner: $('planner'), seClockTime: $('se-clock-time'),
  };

  // ---------- Swedish clock ----------
  const seClock = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit',
  });
  const tickClock = () => { els.seClockTime.textContent = seClock.format(new Date()); };
  tickClock();
  setInterval(tickClock, 5000);

  // ---------- aircraft picker (the hangar) ----------
  const fleetMax = {
    speed: Math.max(...app.aircraftList.map((a) => a.cruiseSpeedKmh)),
    range: Math.max(...app.aircraftList.map((a) => a.maxRangeKm)),
    pax: Math.max(...app.aircraftList.map((a) => a.maxPassengers)),
  };
  const statBar = (label, value, frac, color) => `
    <span class="ac-stat">
      <span class="ac-stat-label">${label}</span>
      <span class="ac-track"><span class="ac-fill" style="width:${Math.round(frac * 100)}%;background:${color}"></span></span>
      <span class="ac-stat-val">${value}</span>
    </span>`;

  function renderAircraftCurrent() {
    const a = app.state.aircraft;
    const art = AC_ART[a.id] ?? AC_ART_FALLBACK;
    els.acCurrent.innerHTML = `
      <span class="ac-art ac-art--sm" style="color:${art.color}">${planeSvg(a.id)}</span>
      <span class="ac-cur-text">
        <span class="ac-name">${a.name}</span>
        <span class="ac-maker">${a.manufacturer} · ${nf.format(a.maxRangeKm)} km · ${a.maxPassengers} seats</span>
      </span>
      <svg class="ac-chevron" viewBox="0 0 12 12"><path d="m2.5 4.5 3.5 3.5 3.5-3.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    for (const row of els.acMenu.querySelectorAll('.ac-row')) {
      row.classList.toggle('is-selected', row.dataset.id === a.id);
    }
  }

  els.acMenu.innerHTML = app.aircraftList.map((a) => {
    const art = AC_ART[a.id] ?? AC_ART_FALLBACK;
    return `
    <button class="ac-row" type="button" role="option" data-id="${a.id}">
      <span class="ac-art" style="color:${art.color}">${planeSvg(a.id)}</span>
      <span class="ac-info">
        <span class="ac-name">${a.name}</span>
        <span class="ac-maker">${a.manufacturer} · FL${Math.round(a.cruiseAltitudeFt / 100)}</span>
        <span class="ac-stats">
          ${statBar('Speed', `${nf.format(a.cruiseSpeedKmh)} km/h`, a.cruiseSpeedKmh / fleetMax.speed, art.color)}
          ${statBar('Range', `${nf.format(a.maxRangeKm)} km`, a.maxRangeKm / fleetMax.range, art.color)}
          ${statBar('Seats', a.maxPassengers, a.maxPassengers / fleetMax.pax, art.color)}
        </span>
      </span>
    </button>`;
  }).join('');

  function openAcMenu() {
    els.acMenu.hidden = false;
    els.acCurrent.setAttribute('aria-expanded', 'true');
    gsap.fromTo(els.acMenu, { opacity: 0, y: -6, scale: 0.98 },
      { opacity: 1, y: 0, scale: 1, duration: 0.25, ease: 'power2.out', clearProps: 'transform' });
  }
  function closeAcMenu() {
    els.acMenu.hidden = true;
    els.acCurrent.setAttribute('aria-expanded', 'false');
  }
  els.acCurrent.addEventListener('click', () => {
    els.acMenu.hidden ? openAcMenu() : closeAcMenu();
  });
  for (const row of els.acMenu.querySelectorAll('.ac-row')) {
    row.addEventListener('click', () => {
      app.setAircraft(row.dataset.id);
      renderAircraftCurrent();
      closeAcMenu();
    });
  }
  document.addEventListener('pointerdown', (e) => {
    if (!els.acMenu.hidden && !els.acPicker.contains(e.target)) closeAcMenu();
  });
  renderAircraftCurrent();

  // ---------- planner ----------
  function slotHtml(role, place) {
    const dot = `<span class="slot-dot slot-dot--${role}"></span>`;
    if (!place) {
      const hint = role === 'origin' ? 'Choose origin' : 'Choose destination';
      return `${dot}<span class="slot-text slot-text--empty">${hint}</span>
        <span class="slot-hint">search ↵</span>`;
    }
    const sub = place.iata ? `${place.iata} · ${place.country}` : place.country || '';
    return `${dot}<span class="slot-text"><span class="slot-name">${place.name}</span>
      <span class="slot-sub">${sub}</span></span>
      <span class="slot-clear" data-role="${role}" title="Clear">×</span>`;
  }

  const PLANE_ICON = '<svg class="icon" viewBox="0 0 16 16"><path d="M8 1.5c.5 0 .9.4.9.9v4.1l5.6 3.2v1.6L8.9 9.6v3l1.6 1.2v1.2L8 14.4 5.5 15v-1.2L7.1 12.6v-3L1.5 11.3V9.7l5.6-3.2V2.4c0-.5.4-.9.9-.9z" fill="currentColor"/></svg>';

  function renderPlanner() {
    // the planner stays out of the way until a first place is chosen
    const wantPlanner = !!(app.state.origin || app.state.dest);
    if (wantPlanner && els.planner.hidden) {
      els.planner.hidden = false;
      gsap.fromTo(els.planner, { opacity: 0, y: -10 }, { opacity: 1, y: 0, duration: 0.45, ease: 'power2.out', clearProps: 'transform,opacity' });
    } else if (!wantPlanner) {
      els.planner.hidden = true;
    }
    els.originSlot.innerHTML = slotHtml('origin', app.state.origin);
    els.destSlot.innerHTML = slotHtml('dest', app.state.dest);
    els.originSlot.classList.toggle('is-set', !!app.state.origin);
    els.destSlot.classList.toggle('is-set', !!app.state.dest);
    els.originSlot.classList.toggle('is-pending', app.pendingRole === 'origin');
    els.destSlot.classList.toggle('is-pending', app.pendingRole === 'dest');
    const ready = app.state.origin && app.state.dest && app.state.aircraft;
    // once a route is calculated, the button becomes the boarding door
    const boardable = !!(app.state.flight && app.state.flight.feasible);
    els.calc.classList.toggle('btn--board', boardable);
    els.calc.innerHTML = boardable
      ? `${PLANE_ICON} Board flight`
      : `${PLANE_ICON} Calculate flight`;
    els.calc.disabled = boardable ? false : !ready;
    for (const x of document.querySelectorAll('.slot-clear')) {
      x.addEventListener('click', (e) => {
        e.stopPropagation();
        app.clearPlace(x.dataset.role);
      });
    }
    if (!app.pendingRole) setSearchHint(null); // keep the placeholder in step with state
  }

  els.originSlot.addEventListener('click', () => app.armSlot('origin'));
  els.destSlot.addEventListener('click', () => app.armSlot('dest'));
  els.swap.addEventListener('click', () => app.swap());
  els.departure.addEventListener('change', () => app.onDepartureChanged());
  els.calc.addEventListener('click', () => app.primaryAction());

  function setSearchHint(role) {
    if (role) {
      els.searchInput.placeholder = `Search ${role === 'origin' ? 'origin' : 'destination'}: city, airport, coordinates…`;
    } else if (!app.state.dest) {
      els.searchInput.placeholder = 'Search your destination…';
    } else if (!app.state.origin) {
      els.searchInput.placeholder = 'Now search your origin…';
    } else {
      els.searchInput.placeholder = 'Search cities, airports, landmarks…';
    }
  }

  // ---------- place card (after a search selection) ----------
  function showPlaceCard(place) {
    hideContextCard();
    const local = place.tz
      ? `${formatInTz(new Date(), place.tz)} (${tzAbbr(new Date(), place.tz)})` : '';
    els.placeCard.innerHTML = `
      <button class="card-close" id="pc-close" title="Close">×</button>
      <div class="card-title">${place.name}</div>
      <div class="card-sub">${place.country || ''}${place.iata ? ' · ' + place.iata : ''}</div>
      <div class="card-meta">${formatLatLng(place.lat, place.lng)}${local ? ' · ' + local : ''}</div>
      <div class="card-actions">
        <button class="btn btn--origin" id="pc-origin">Set as origin</button>
        <button class="btn btn--dest" id="pc-dest">Set as destination</button>
        <button class="btn btn--ghost" id="pc-go">Go there</button>
      </div>`;
    els.placeCard.hidden = false;
    gsap.fromTo(els.placeCard, { opacity: 0, y: -8 }, { opacity: 1, y: 0, duration: 0.35, ease: 'power2.out' });
    $('pc-close').onclick = hidePlaceCard;
    $('pc-origin').onclick = () => { app.setPlace('origin', place); hidePlaceCard(); };
    $('pc-dest').onclick = () => { app.setPlace('dest', place); hidePlaceCard(); };
    $('pc-go').onclick = () => app.flyToPlace(place, { closer: true });
  }
  function hidePlaceCard() { els.placeCard.hidden = true; }

  // ---------- context card (right-click on the globe) ----------
  function showContextCard({ clientX, clientY, lat, lng, near }) {
    hidePlaceCard();
    const isNear = near && near.distKm < 150;
    const title = isNear ? near.place.name : 'Dropped pin';
    const sub = isNear ? near.place.country : `nearest timezone: ${near.place.tz}`;
    els.contextCard.innerHTML = `
      <div class="card-title card-title--sm">${title}</div>
      <div class="card-meta">${formatLatLng(lat, lng)} · ${sub}</div>
      <div class="card-actions">
        <button class="btn btn--origin" id="cc-origin">Origin here</button>
        <button class="btn btn--dest" id="cc-dest">Destination here</button>
      </div>`;
    const place = isNear ? near.place : {
      name: `${lat.toFixed(2)}°, ${lng.toFixed(2)}°`, type: 'point',
      country: '', lat, lng, tz: near.place.tz,
    };
    els.contextCard.hidden = false;
    const pad = 12;
    const w = els.contextCard.offsetWidth, h = els.contextCard.offsetHeight;
    els.contextCard.style.left = `${Math.min(clientX, innerWidth - w - pad)}px`;
    els.contextCard.style.top = `${Math.min(clientY, innerHeight - h - pad)}px`;
    gsap.fromTo(els.contextCard, { opacity: 0, scale: 0.92 }, { opacity: 1, scale: 1, duration: 0.25, ease: 'power2.out' });
    $('cc-origin').onclick = () => { app.setPlace('origin', place); hideContextCard(); };
    $('cc-dest').onclick = () => { app.setPlace('dest', place); hideContextCard(); };
  }
  function hideContextCard() { els.contextCard.hidden = true; }
  document.addEventListener('pointerdown', (e) => {
    if (!els.contextCard.hidden && !els.contextCard.contains(e.target)) hideContextCard();
  });

  // ---------- info panel ----------
  function cell(label, value, sub = '') {
    return `<div class="stat"><div class="stat-label">${label}</div>
      <div class="stat-value">${value}</div>
      ${sub ? `<div class="stat-sub">${sub}</div>` : ''}</div>`;
  }

  function showFlight(r) {
    const { origin, dest, aircraft } = app.state;
    const miles = r.totalKm * 0.621371;
    const via = r.stops.length
      ? ` · via ${r.stops.map((s) => s.iata || s.name).join(', ')}` : '';
    const badge = !r.feasible
      ? `<span class="badge badge--bad">Exceeds ${aircraft.name} range — no viable fuel stops</span>`
      : r.nonstop
        ? `<span class="badge badge--good">Nonstop · within ${nf.format(aircraft.maxRangeKm)} km range</span>`
        : `<span class="badge badge--warn">${r.stops.length} fuel stop${r.stops.length > 1 ? 's' : ''} · via ${r.stops.map((s) => s.iata || s.name).join(' → ')}</span>`;

    els.infoBody.innerHTML = `
      <div class="info-head">
        <div>
          <div class="info-route">${origin.name} <span class="route-arrow">→</span> ${dest.name}</div>
          <div class="info-sub">${aircraft.manufacturer} ${aircraft.name}${via}</div>
        </div>
        <div class="info-actions">
          <button class="card-close" id="info-close" title="Close">×</button>
        </div>
      </div>
      <div class="info-badge">${badge}</div>
      <div class="info-grid">
        ${cell('Distance', `${nf.format(r.totalKm)} km`, `${nf.format(miles)} mi${r.stops.length ? ` · ${nf.format(r.directKm)} km direct` : ''}`)}
        ${cell('Flight time', formatDuration(r.totalH), r.groundTimeH ? `incl. ${formatDuration(r.groundTimeH)} refuelling` : 'gate to gate')}
        ${cell('Cruise', `${nf.format(aircraft.cruiseSpeedKmh)} km/h`, `FL${Math.round(aircraft.cruiseAltitudeFt / 100)} · ${aircraft.maxPassengers} pax`)}
        ${cell('Departure', formatInTz(r.departure, origin.tz), `${tzAbbr(r.departure, origin.tz)} · ${origin.name}`)}
        ${cell(`Arrival · ${tzAbbr(r.arrival, origin.tz)}`, formatInTz(r.arrival, origin.tz), 'in departure timezone')}
        ${cell(`Arrival · local`, formatInTz(r.arrival, dest.tz), `${tzAbbr(r.arrival, dest.tz)} · ${dest.name}`)}
        ${cell('Time shift', `${r.tzShiftH >= 0 ? '+' : '−'}${Math.abs(r.tzShiftH).toFixed(Math.abs(r.tzShiftH % 1) > 0.01 ? 1 : 0)} h`, r.tzShiftH === 0 ? 'same timezone' : `${dest.name} is ${r.tzShiftH > 0 ? 'ahead' : 'behind'}`)}
        ${r.fuelKg
          ? cell('Fuel burn', `≈ ${nf.format(Math.round(r.fuelKg / 1000))} t`, 'rough estimate')
          : cell('Range', `${nf.format(aircraft.maxRangeKm)} km`, 'aircraft maximum')}
      </div>`;
    $('info-close').onclick = hideFlight;
    gsap.killTweensOf(els.infoPanel); // a mid-fade hide must not swallow the new panel
    if (els.infoPanel.hidden) {
      els.infoPanel.hidden = false;
      gsap.fromTo(els.infoPanel, { opacity: 0, y: 26 }, { opacity: 1, y: 0, duration: 0.55, ease: 'power3.out', clearProps: 'transform' });
    } else {
      gsap.set(els.infoPanel, { opacity: 1, clearProps: 'transform' });
    }
  }
  function hideFlight() {
    if (els.infoPanel.hidden) return;
    gsap.to(els.infoPanel, {
      opacity: 0, y: 20, duration: 0.3, ease: 'power2.in',
      onComplete: () => { els.infoPanel.hidden = true; els.infoPanel.style.opacity = ''; els.infoPanel.style.transform = ''; },
    });
  }

  // ---------- toast ----------
  let toastTween = null;
  function toast(msg) {
    toastTween?.kill();
    els.toast.textContent = msg;
    els.toast.hidden = false;
    toastTween = gsap.timeline()
      .fromTo(els.toast, { opacity: 0, y: 12 }, { opacity: 1, y: 0, duration: 0.3, ease: 'power2.out' })
      .to(els.toast, { opacity: 0, y: -8, duration: 0.35, delay: 2.1, onComplete: () => { els.toast.hidden = true; } });
  }

  // ---------- top-right / bottom-right controls ----------
  els.themeBtn.addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    localStorage.setItem('fg_theme', next);
  });
  document.documentElement.dataset.theme = localStorage.getItem('fg_theme') || 'dark';

  $('reset-btn').addEventListener('click', () => { app.resetAll(); toast('Everything reset'); });
  els.fsBtn.addEventListener('click', toggleFullscreen);
  function toggleFullscreen() {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen?.();
  }
  document.addEventListener('fullscreenchange', () => {
    els.fsBtn.classList.toggle('is-on', !!document.fullscreenElement);
  });

  $('zoom-in').addEventListener('click', () => app.zoomBy(0.72));
  $('zoom-out').addEventListener('click', () => app.zoomBy(1.38));
  $('home-btn').addEventListener('click', () => app.goToMyLocation());
  $('compass').addEventListener('click', () => app.faceNorth());
  function setLocating(on) { $('home-btn').classList.toggle('is-locating', on); }

  // ---------- collapsible sidebar ----------
  const sidebar = $('sidebar');
  const sideToggle = $('side-toggle');
  const indicator = $('side-indicator');
  let activeItem = $('side-flights');
  const moveIndicator = (el) => {
    indicator.style.setProperty('--ind-y', `${el.offsetTop}px`);
    indicator.style.setProperty('--ind-h', `${el.offsetHeight}px`);
    indicator.classList.add('is-ready');
  };
  // the blue highlight rests on the active item and only moves on a click;
  // hovering just gives a dimmed white overlay (handled in CSS)
  const setActive = (el) => {
    activeItem = el;
    for (const it of sidebar.querySelectorAll('.side-item')) it.classList.toggle('is-active', it === el);
    moveIndicator(el);
  };
  requestAnimationFrame(() => moveIndicator(activeItem));

  sideToggle.addEventListener('click', () => {
    const open = sidebar.classList.toggle('is-open');
    document.body.classList.toggle('sidebar-open', open);
    sideToggle.setAttribute('aria-expanded', String(open));
    setTimeout(() => moveIndicator(activeItem), 300); // offsets shift once labels settle
  });
  function openFlightSearch() {
    if (app.simBusy?.()) return;
    els.searchInput.focus();
  }
  $('side-flights').addEventListener('click', () => { setActive($('side-flights')); openFlightSearch(); });
  $('side-locate').addEventListener('click', () => { setActive($('side-locate')); app.goToMyLocation(); });
  $('side-reset').addEventListener('click', () => { setActive($('side-reset')); app.resetAll(); toast('Everything reset'); });

  // ---------- telemetry ----------
  function setCoords(ll, altKm) {
    els.coords.textContent = ll
      ? `${formatLatLng(ll.lat, ll.lng)} · alt ${nf.format(altKm)} km`
      : `alt ${nf.format(altKm)} km`;
  }
  function setFps(v) { els.fps.textContent = `${v} fps`; }
  let lastCompass = null;
  function updateCompass(deg) {
    const d = Math.round(deg * 10) / 10;
    if (d === lastCompass) return;
    lastCompass = d;
    els.compassRose.setAttribute('transform', `rotate(${d} 22 22)`);
  }

  // ---------- keyboard ----------
  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement?.tagName);
    if (e.key === 'Escape') {
      if (app.simBusy() || !document.getElementById('boarding').hidden) { app.exitSim(); return; }
      hidePlaceCard(); hideContextCard(); closeAcMenu(); app.disarmSlot();
      return;
    }
    if (typing) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return; // leave copy/find/browser-zoom alone
    switch (e.key) {
      case '/': e.preventDefault(); els.searchInput.focus(); break;
      case '+': case '=': app.zoomBy(0.78); break;
      case '-': case '_': app.zoomBy(1.28); break;
      case 'f': toggleFullscreen(); break;
      case 'h': app.goToMyLocation(); break;
      case 'n': app.faceNorth(); break;
      case 'c': if (!els.calc.disabled) app.primaryAction(); break;
      case 'Enter': app.enterAdvance(); break;
      case 'ArrowLeft': app.nudge(0, -4); break;
      case 'ArrowRight': app.nudge(0, 4); break;
      case 'ArrowUp': app.nudge(3, 0); break;
      case 'ArrowDown': app.nudge(-3, 0); break;
    }
  });

  function revealHud() {
    gsap.to('.hud', {
      opacity: 1, y: 0, duration: 0.8, stagger: 0.08, ease: 'power3.out',
      onComplete: () => {
        document.querySelectorAll('.hud').forEach((h) => h.classList.add('hud--ready'));
        els.searchInput.focus({ preventScroll: true }); // ready to type a destination
      },
    });
  }

  renderPlanner();
  return {
    renderPlanner, showFlight, hideFlight, toast,
    showPlaceCard, hidePlaceCard, showContextCard, hideContextCard,
    setCoords, setFps, updateCompass, setSearchHint, revealHud, setLocating,
    departureEl: els.departure, searchInput: els.searchInput,
  };
}
