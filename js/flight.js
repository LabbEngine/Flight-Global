// Flight planning: distance, duration, timezones, fuel stops. Pure logic, no DOM.
import { haversineKm } from './geo.js';

const TAXI_CLIMB_HOURS = 0.4; // taxi + climb + descent allowance per leg
const REFUEL_HOURS = 1.0; // ground time per fuel stop
const USABLE_RANGE = 0.93; // keep a reserve off the book range

// Minutes that `tz` is ahead of UTC at the given instant. DST-correct,
// courtesy of the browser's own IANA database.
export function tzOffsetMinutes(tz, date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const asUTC = Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute, p.second);
  return Math.round((asUTC - date.getTime()) / 60000);
}

// Interpret a wall-clock time as local time in `tz`, return the instant.
export function wallTimeToInstant(tz, y, mo, d, h, mi) {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    guess = Date.UTC(y, mo - 1, d, h, mi) - tzOffsetMinutes(tz, new Date(guess)) * 60000;
  }
  return new Date(guess);
}

export function formatInTz(date, tz) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short', day: 'numeric', month: 'short',
    hour: '2-digit', minute: '2-digit',
  }).format(date);
}

export function tzAbbr(date, tz) {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(date);
  return parts.find((p) => p.type === 'timeZoneName')?.value ?? tz;
}

export function formatDuration(hours) {
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return m === 60 ? `${h + 1} h 00 m` : `${h} h ${String(m).padStart(2, '0')} m`;
}

// Greedy fuel-stop planner. Walks toward the destination picking large
// airports that keep every leg inside usable range with little detour.
function planStops(origin, dest, usableKm, airports) {
  const stops = [];
  let cur = origin;
  for (let hop = 0; hop < 4; hop++) {
    const remaining = haversineKm(cur, dest);
    if (remaining <= usableKm) return stops;
    const candidates = [];
    for (const a of airports) {
      if (a === cur) continue;
      const dCur = haversineKm(cur, a);
      const dDest = haversineKm(a, dest);
      if (dCur > usableKm * 0.98) continue; // can't reach it
      if (dCur < 400 || dDest < 400) continue; // pointless hop
      if (dDest > remaining - 250) continue; // must make real progress
      candidates.push({ a, dCur, dDest, detour: (dCur + dDest) / remaining });
    }
    if (!candidates.length) return null;
    // Prefer stops close to the direct track, and among those, the longest hop.
    const onTrack = candidates.filter((c) => c.detour < 1.08);
    const pool = onTrack.length ? onTrack : candidates.sort((x, y) => x.detour - y.detour).slice(0, 5);
    pool.sort((x, y) => y.dCur - x.dCur);
    const pick = pool[0].a;
    stops.push(pick);
    cur = pick;
  }
  return haversineKm(cur, dest) <= usableKm ? stops : null;
}

// A point on the great circle from a to b at fraction f (0..1).
function interpGC(a, b, f) {
  const R = Math.PI / 180, D = 180 / Math.PI;
  const la1 = a.lat * R, lo1 = a.lng * R, la2 = b.lat * R, lo2 = b.lng * R;
  const d = 2 * Math.asin(Math.sqrt(Math.sin((la2 - la1) / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin((lo2 - lo1) / 2) ** 2));
  if (d < 1e-6) return { lat: a.lat, lng: a.lng };
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(la1) * Math.cos(lo1) + B * Math.cos(la2) * Math.cos(lo2);
  const y = A * Math.cos(la1) * Math.sin(lo1) + B * Math.cos(la2) * Math.sin(lo2);
  const z = A * Math.sin(la1) + B * Math.sin(la2);
  return { lat: Math.atan2(z, Math.hypot(x, y)) * D, lng: Math.atan2(y, x) * D };
}

// Pick `n` connecting airports spaced evenly along the direct track — the user's "breaks".
function planBreaks(origin, dest, n, airports) {
  const stops = [], used = new Set();
  for (let i = 1; i <= n; i++) {
    const target = interpGC(origin, dest, i / (n + 1));
    let best = null, bestD = Infinity;
    for (const a of airports) {
      if (used.has(a) || a === origin || a === dest) continue;
      const d = haversineKm(target, a);
      if (d < bestD) { bestD = d; best = a; }
    }
    if (best) { stops.push(best); used.add(best); }
  }
  return stops;
}

// The main event: everything the info panel needs, from two pins,
// an aircraft, and a departure instant.
export function computeFlight({ origin, dest, aircraft, departure, airports, breaks = null }) {
  const directKm = haversineKm(origin, dest);
  const usableKm = aircraft.maxRangeKm * USABLE_RANGE;

  let stops = [];
  let feasible = true;
  if (breaks != null) {
    // the user chose exactly how many connecting airports they want
    if (breaks > 0) stops = planBreaks(origin, dest, breaks, airports);
  } else if (directKm > usableKm) {
    const planned = planStops(origin, dest, usableKm, airports);
    if (planned === null) feasible = false;
    else stops = planned;
  }

  const waypoints = [origin, ...stops, dest];
  const legs = [];
  for (let i = 0; i < waypoints.length - 1; i++) {
    legs.push({
      from: waypoints[i],
      to: waypoints[i + 1],
      distKm: haversineKm(waypoints[i], waypoints[i + 1]),
    });
  }

  const totalKm = legs.reduce((s, l) => s + l.distKm, 0);
  const airTimeH = legs.reduce((s, l) => s + l.distKm / aircraft.cruiseSpeedKmh + TAXI_CLIMB_HOURS, 0);
  const groundTimeH = stops.length * REFUEL_HOURS;
  const totalH = airTimeH + groundTimeH;
  const arrival = new Date(departure.getTime() + totalH * 3600000);

  const tzShiftH =
    (tzOffsetMinutes(dest.tz, arrival) - tzOffsetMinutes(origin.tz, departure)) / 60;

  return {
    feasible, legs, stops, directKm, totalKm,
    airTimeH, groundTimeH, totalH,
    departure, arrival, tzShiftH,
    fuelKg: aircraft.fuelBurnKgPerHour ? Math.round(aircraft.fuelBurnKgPerHour * airTimeH) : null,
    nonstop: stops.length === 0,
  };
}
