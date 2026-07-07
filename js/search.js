// Search across cities, airports, landmarks and raw coordinates,
// with keyboard navigation and recent searches.
import { haversineKm } from './geo.js';

const COORD_RE = /^\s*(-?\d{1,2}(?:\.\d+)?)[,;\s]+(-?\d{1,3}(?:\.\d+)?)\s*$/;
const MAX_RESULTS = 8;

export function nearestPlace(places, lat, lng, type = null) {
  let best = null, bestD = Infinity;
  for (const p of places) {
    if (type && p.type !== type) continue;
    const d = haversineKm({ lat, lng }, p);
    if (d < bestD) { bestD = d; best = p; }
  }
  return { place: best, distKm: bestD };
}

const ICONS = {
  city: '<svg viewBox="0 0 16 16"><path d="M2 14V6l3-1v9M5 14V3l4-1.5V14M9 14V6l5 1.5V14" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>',
  airport: '<svg viewBox="0 0 16 16"><path d="M8 1.5c.5 0 .9.4.9.9v4.1l5.6 3.2v1.6L8.9 9.6v3l1.6 1.2v1.2L8 14.4 5.5 15v-1.2L7.1 12.6v-3L1.5 11.3V9.7l5.6-3.2V2.4c0-.5.4-.9.9-.9z" fill="currentColor"/></svg>',
  landmark: '<svg viewBox="0 0 16 16"><path d="M8 1l2 4.2 4.6.6-3.4 3.2.9 4.6L8 11.4l-4.1 2.2.9-4.6L1.4 5.8 6 5.2z" fill="currentColor"/></svg>',
  point: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.6" fill="currentColor"/><circle cx="8" cy="8" r="5.6" fill="none" stroke="currentColor" stroke-width="1.2"/></svg>',
  recent: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M8 4.5V8l2.4 1.6" fill="none" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
};

function score(place, q) {
  let s = -1;
  const name = place._n;
  if (place.iata && q.length === 3 && place.iata.toLowerCase() === q) s = Math.max(s, 130);
  if (name === q) s = Math.max(s, 120);
  else if (name.startsWith(q)) s = Math.max(s, 100);
  else if (name.includes(' ' + q) || name.includes('-' + q)) s = Math.max(s, 78);
  else if (name.includes(q)) s = Math.max(s, 52);
  if (place._city) {
    if (place._city.startsWith(q)) s = Math.max(s, 72);
    else if (place._city.includes(q)) s = Math.max(s, 46);
  }
  if (s < 0 && place._country.startsWith(q)) s = 34;
  if (s < 0) return -1;
  s += Math.log10((place.pop || 80000)) * 3.5;
  if (place.type === 'city') s += 10;
  if (place.type === 'landmark') s += 9;
  if (place.capital) s += 5;
  return s;
}

export class SearchBox {
  constructor({ input, resultsEl, places, onSelect, onEnterEmpty }) {
    this.input = input;
    this.resultsEl = resultsEl;
    this.places = places;
    this.onSelect = onSelect;
    this.onEnterEmpty = onEnterEmpty;
    this.items = [];
    this.active = -1;
    for (const p of places) {
      p._n = p.name.toLowerCase();
      p._country = (p.country || '').toLowerCase();
      p._city = (p.city || '').toLowerCase();
    }
    let debounce = null;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      debounce = setTimeout(() => this.query(input.value), 70);
    });
    input.addEventListener('focus', () => this.query(input.value));
    input.addEventListener('keydown', (e) => this.#key(e));
    document.addEventListener('pointerdown', (e) => {
      if (!resultsEl.contains(e.target) && e.target !== input) this.close();
    });
  }

  #recents() {
    try {
      const v = JSON.parse(localStorage.getItem('fg_recent') || '[]');
      return Array.isArray(v) ? v : [];
    } catch { return []; }
  }

  #remember(place) {
    const r = this.#recents().filter((p) => p.name !== place.name || p.tz !== place.tz);
    r.unshift({ name: place.name, type: place.type, country: place.country,
      lat: place.lat, lng: place.lng, tz: place.tz, iata: place.iata, city: place.city });
    localStorage.setItem('fg_recent', JSON.stringify(r.slice(0, 6)));
  }

  query(text) {
    const q = text.trim().toLowerCase();
    if (!q) {
      const recents = this.#recents();
      this.#render(recents.map((p) => ({ place: p, recent: true })), recents.length ? 'Recent' : null);
      return;
    }
    const m = text.match(COORD_RE);
    if (m) {
      const lat = parseFloat(m[1]), lng = parseFloat(m[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
        const near = nearestPlace(this.places, lat, lng);
        this.#render([{
          place: {
            name: `${lat.toFixed(3)}°, ${lng.toFixed(3)}°`, type: 'point',
            country: near.distKm < 400 ? `near ${near.place.name}` : 'open coordinates',
            lat, lng, tz: near.place?.tz || 'UTC',
          },
        }]);
        return;
      }
    }
    const hits = [];
    for (const p of this.places) {
      const s = score(p, q);
      if (s > 0) hits.push([s, p]);
    }
    hits.sort((a, b) => b[0] - a[0]);
    this.#render(hits.slice(0, MAX_RESULTS).map(([, place]) => ({ place })));
  }

  #render(items, heading = null) {
    this.items = items;
    this.active = -1;
    const el = this.resultsEl;
    el.innerHTML = '';
    if (!items.length) { el.hidden = true; return; }
    if (heading) {
      const h = document.createElement('div');
      h.className = 'search-heading';
      h.textContent = heading;
      el.appendChild(h);
    }
    items.forEach(({ place, recent }, i) => {
      const row = document.createElement('button');
      row.className = 'search-row';
      row.type = 'button';
      const sub = place.type === 'airport'
        ? `${place.city ? place.city + ', ' : ''}${place.country} · ${place.iata}`
        : `${place.type[0].toUpperCase() + place.type.slice(1)} · ${place.country}`;
      row.innerHTML = `
        <span class="search-icon search-icon--${place.type}">${ICONS[recent ? 'recent' : place.type] || ICONS.point}</span>
        <span class="search-text"><span class="search-name">${place.name}</span>
        <span class="search-sub">${sub}</span></span>`;
      row.addEventListener('click', () => this.#choose(i));
      row.addEventListener('pointerenter', () => this.#highlight(i));
      el.appendChild(row);
    });
    el.hidden = false;
  }

  #highlight(i) {
    this.active = i;
    [...this.resultsEl.querySelectorAll('.search-row')].forEach((r, j) =>
      r.classList.toggle('is-active', j === i));
  }

  #key(e) {
    if (e.key === 'Escape') { this.close(); this.input.blur(); return; }
    if (e.key === 'Enter' && !this.items.length) { e.preventDefault(); this.onEnterEmpty?.(); return; }
    if (!this.items.length) return;
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const d = e.key === 'ArrowDown' ? 1 : -1;
      this.#highlight((this.active + d + this.items.length) % this.items.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      this.#choose(this.active >= 0 ? this.active : 0);
    }
  }

  #choose(i) {
    const item = this.items[i];
    if (!item) return;
    if (item.place.type !== 'point') this.#remember(item.place);
    this.close();
    this.input.value = '';
    this.onSelect(item.place);
  }

  close() {
    this.resultsEl.hidden = true;
    this.items = [];
  }
}
