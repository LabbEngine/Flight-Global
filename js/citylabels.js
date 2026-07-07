// Big-city name markers shown only during a boarded flight, so there's
// something to spot as the plane crosses the map. The biggest cities are
// pre-projected each frame; only the ~20 nearest screen-center are drawn.
import { latLngToVec3 } from './geo.js';
import { worldToScreen, facesCamera } from './fx.js';

const MAX_SHOWN = 20;

export class CityLabels {
  constructor(root, places, pool = 150) {
    this.active = false;
    const cities = places
      .filter((p) => p.type === 'city')
      .sort((a, b) => (b.pop || 0) - (a.pop || 0))
      .slice(0, pool);
    this.items = cities.map((c) => {
      const el = document.createElement('div');
      el.className = 'city-label';
      el.textContent = c.name;
      el.style.display = 'none';
      root.appendChild(el);
      return { pos: latLngToVec3(c.lat, c.lng, 1), el };
    });
  }

  setActive(on) {
    if (this.active === on) return;
    this.active = on;
    if (!on) for (const it of this.items) it.el.style.display = 'none';
  }

  update(camera, w, h) {
    if (!this.active) return;
    const vis = [];
    for (const it of this.items) {
      if (!facesCamera(it.pos, camera)) { it.el.style.display = 'none'; continue; }
      const s = worldToScreen(it.pos, camera, w, h);
      if (!s || s.x < -60 || s.x > w + 60 || s.y < -30 || s.y > h + 30) { it.el.style.display = 'none'; continue; }
      it._s = s;
      it._d = (s.x - w / 2) ** 2 + (s.y - h / 2) ** 2;
      vis.push(it);
    }
    vis.sort((a, b) => a._d - b._d);
    for (let i = 0; i < vis.length; i++) {
      const it = vis[i];
      if (i < MAX_SHOWN) {
        it.el.style.display = '';
        it.el.style.transform = `translate(-50%, -50%) translate(${it._s.x.toFixed(1)}px, ${it._s.y.toFixed(1)}px)`;
      } else {
        it.el.style.display = 'none';
      }
    }
  }
}
