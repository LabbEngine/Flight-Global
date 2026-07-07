// FocusAir frequent-flyer membership. Four tiers — Silver → Gold → Platinum →
// Premium — that level up automatically with the number of flights you complete
// (stored locally). Your tier decides how early you board: higher tiers are
// called to the gate first.
export const TIERS = [
  { key: 'silver', name: 'Silver', min: 0, color: '#aab4c2', group: 'Silver · Main cabin' },
  { key: 'gold', name: 'Gold', min: 3, color: '#e6c568', group: 'Gold · Priority' },
  { key: 'platinum', name: 'Platinum', min: 8, color: '#cdd6e2', group: 'Platinum · Sky Priority' },
  { key: 'premium', name: 'Premium', min: 16, color: '#7fb2e6', group: 'Premium · First to board' },
];

export function getFlights() {
  try { return Math.max(0, parseInt(localStorage.getItem('fc_flights'), 10) || 0); } catch (_) { return 0; }
}
export function addFlight() {
  const n = getFlights() + 1;
  try { localStorage.setItem('fc_flights', String(n)); } catch (_) {}
  return n;
}
export function tierFor(flights = getFlights()) {
  let t = TIERS[0];
  for (const x of TIERS) if (flights >= x.min) t = x;
  return t;
}
export function nextTier(flights = getFlights()) {
  return TIERS.find((x) => x.min > flights) || null;
}
export function tierProgress(flights = getFlights()) {
  const cur = tierFor(flights), next = nextTier(flights);
  if (!next) return { cur, next: null, need: 0, frac: 1, flights };
  const span = next.min - cur.min;
  return { cur, next, need: next.min - flights, frac: span > 0 ? (flights - cur.min) / span : 1, flights };
}
