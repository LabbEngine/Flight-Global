// Every world capital, shown as a clickable marker whenever you're just browsing
// the globe (not planning or flying). Spin the Earth and the capitals on the near
// side light up; click one to drop it in as your destination. Bigger capitals get
// their name printed; the rest collapse to a dot (name on hover) to avoid clutter.
import { latLngToVec3 } from './geo.js';
import { worldToScreen, facesCamera } from './fx.js';

const MAX_LABELS = 46;

export class CapitalLabels {
  constructor(root, places, onPick) {
    this.active = false;
    this.onPick = onPick;
    const caps = places
      .filter((p) => p.capital === true && Number.isFinite(p.lat) && Number.isFinite(p.lng))
      .sort((a, b) => (b.pop || 0) - (a.pop || 0));
    this.items = caps.map((c) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'cap-marker';
      el.innerHTML = `<span class="cap-dot"></span><span class="cap-name">${c.name}</span>`;
      el.style.display = 'none';
      el.addEventListener('pointerdown', (e) => e.stopPropagation()); // don't start a globe drag
      el.addEventListener('click', (e) => { e.stopPropagation(); this.onPick && this.onPick(c); });
      root.appendChild(el);
      return { place: c, pos: latLngToVec3(c.lat, c.lng, 1), el };
    });
  }

  setActive(on) {
    if (this.active === on) return;
    this.active = on;
    if (!on) for (const it of this.items) it.el.style.display = 'none';
  }

  update(camera, w, h) {
    if (!this.active) return;
    const placed = [];
    for (const it of this.items) {
      if (!facesCamera(it.pos, camera)) { it.el.style.display = 'none'; continue; }
      const s = worldToScreen(it.pos, camera, w, h);
      if (!s || s.x < 0 || s.x > w || s.y < 0 || s.y > h) { it.el.style.display = 'none'; continue; }
      it.el.style.display = '';
      it.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px)`;
      // biggest capitals (iterated first) claim a name label; overlapping ones stay dots
      const labelled = placed.length < MAX_LABELS && !placed.some((p) => Math.abs(p.x - s.x) < 76 && Math.abs(p.y - s.y) < 20);
      it.el.classList.toggle('is-labelled', labelled);
      if (labelled) placed.push(s);
    }
  }
}
