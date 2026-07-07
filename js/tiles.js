// The globe surface: high-res Esri World Imagery satellite tiles draped on the
// sphere — the only surface (there is no baked base texture). Three layers keep
// it smooth: a whole-world base loaded once and never dropped (so there's always
// full coverage, no blank pop-in), a coverage grid spanning the visible cap, and
// a high-zoom detail patch around the look point. Online only; the plain base
// sphere shows at the poles (Web-Mercator stops at ±85°) and before tiles load.
import * as THREE from '../vendor/three/three.module.js';
import { latLngToVec3 } from './geo.js';

// Esri World Imagery: keyless high-res satellite (note the z/y/x order).
const TILE_URL = (z, x, y) =>
  `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const BASE_Z = 3;         // whole-world base layer, loaded once and kept forever
const COV_GRID = 3;       // coverage: 7x7 tiles blanket the whole visible cap
const DET_GRID = 3;       // detail: 7x7 high-zoom patch, pre-rendered wide
const PATCH = 8;          // mesh subdivisions per tile (for sphere curvature)
const R_BASE = 1.0008;    // persistent world base, just above the plain sphere
const R_COV = 1.0016;     // coverage shell, above the base
const R_DET = 1.0026;     // detail shell, above coverage so crisp tiles win
const COV_MAX_Z = 7;      // coverage stays bounded; the detail patch carries resolution
const MAX_Z = 19;

const clampLat = (l) => Math.max(-85.05, Math.min(85.05, l));
const lon2tile = (lon, z) => Math.floor((lon + 180) / 360 * (1 << z));
const lat2tile = (lat, z) => {
  const r = lat * Math.PI / 180;
  return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * (1 << z));
};
const tile2lon = (x, z) => x / (1 << z) * 360 - 180;
const tile2lat = (y, z) => {
  const n = Math.PI - 2 * Math.PI * y / (1 << z);
  return 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
};

export class TileLayer {
  constructor(scene) {
    this.group = new THREE.Group();
    scene.add(this.group);
    this.cache = new Map(); // "z/x/y" -> { mesh, keep }
    this.failed = new Set();
    this.loader = new THREE.TextureLoader();
    this.loader.setCrossOrigin('anonymous');
    this.active = false;
    this.enabled = true;
    this.lastKey = '';
    this.brightness = 1; // multiplied into each tile so they dim with the globe in flight
  }

  setBrightness(v) {
    if (v === this.brightness) return;
    this.brightness = v;
    for (const e of this.cache.values()) if (e.mesh) e.mesh.material.color.setScalar(v);
  }

  #zoomFor(altKm) {
    return THREE.MathUtils.clamp(Math.round(Math.log2(229000 / Math.max(20, altKm))), 3, MAX_Z);
  }

  #buildPatch(z, x, y, tex, radius) {
    const lng0 = tile2lon(x, z), lng1 = tile2lon(x + 1, z);
    const lat0 = tile2lat(y, z), lat1 = tile2lat(y + 1, z);
    const g = PATCH;
    const pos = new Float32Array((g + 1) * (g + 1) * 3);
    const uv = new Float32Array((g + 1) * (g + 1) * 2);
    let p = 0, u = 0;
    for (let j = 0; j <= g; j++) {
      for (let i = 0; i <= g; i++) {
        const v = latLngToVec3(lat0 + (lat1 - lat0) * (j / g), lng0 + (lng1 - lng0) * (i / g), radius);
        pos[p++] = v.x; pos[p++] = v.y; pos[p++] = v.z;
        uv[u++] = i / g; uv[u++] = 1 - j / g;
      }
    }
    const idx = [];
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
      const a = j * (g + 1) + i;
      idx.push(a, a + (g + 1), a + 1, a + 1, a + (g + 1), a + (g + 2));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex }));
  }

  #load(z, x, y, radius, persistent = false) {
    const key = `${z}/${x}/${y}`;
    if (this.cache.has(key)) { this.cache.get(key).keep = true; return; }
    if (this.failed.has(key)) return;
    const entry = { mesh: null, keep: true, persistent };
    this.cache.set(key, entry);
    this.loader.load(TILE_URL(z, x, y), (tex) => {
      // identity check: the cache may hold a NEWER entry for this key by now
      if (this.cache.get(key) !== entry) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 8;
      entry.mesh = this.#buildPatch(z, x, y, tex, radius);
      entry.mesh.material.color.setScalar(this.brightness); // match the current globe dimming
      this.group.add(entry.mesh);
    }, undefined, () => {
      if (this.cache.get(key) === entry) this.cache.delete(key);
      this.failed.add(key);
    });
  }

  #drop(entry) {
    if (!entry.mesh) return;
    entry.mesh.geometry.dispose();
    entry.mesh.material.map?.dispose();
    entry.mesh.material.dispose();
    this.group.remove(entry.mesh);
  }

  #clear() {
    for (const e of this.cache.values()) this.#drop(e);
    this.cache.clear();
    this.failed.clear(); // transient network errors get another chance next visit
    this.active = false;
    this.lastKey = '';
    this._baseDone = false;
  }

  // a coarse whole-world layer loaded once and kept forever, so there's always
  // full tile coverage under the finer layers — no blank flashes while panning.
  #ensureBase() {
    if (this._baseDone) return;
    this._baseDone = true;
    const max = 1 << BASE_Z;
    for (let x = 0; x < max; x++) for (let y = 0; y < max; y++) this.#load(BASE_Z, x, y, R_BASE, true);
  }

  // load a (2*grid+1)^2 block of tiles around a center tile, at a given radius
  #loadGrid(z, cx, cy, grid, radius) {
    const max = 1 << z;
    for (let dy = -grid; dy <= grid; dy++) for (let dx = -grid; dx <= grid; dx++) {
      const x = ((cx + dx) % max + max) % max;
      const y = cy + dy;
      if (y < 0 || y >= max) continue;
      this.#load(z, x, y, radius);
    }
  }

  update(camera) {
    const dist = camera.position.length();
    if (!this.enabled) {
      if (this.active || this.cache.size) this.#clear();
      return;
    }
    this.#ensureBase();
    const altKm = (dist - 1) * 6371;
    const c = camera.position.clone().normalize();
    const lat = clampLat(90 - Math.acos(THREE.MathUtils.clamp(c.y, -1, 1)) * 180 / Math.PI);
    let lng = Math.atan2(c.z, -c.x) * 180 / Math.PI - 180;
    if (lng < -180) lng += 360; if (lng > 180) lng -= 360;
    // Coverage tier: a bounded zoom whose grid spans the whole visible cap, so the
    // globe is always fully satellite. Detail tier: altitude-based deep zoom around
    // the look point, layered on top for street-level crispness when it beats coverage.
    const capFullDeg = 2 * Math.acos(THREE.MathUtils.clamp(1 / dist, 0, 1)) * 180 / Math.PI;
    const zc = THREE.MathUtils.clamp(Math.floor(Math.log2(360 * (2 * COV_GRID + 1) / Math.max(18, capFullDeg))), BASE_Z, COV_MAX_Z);
    const zd = this.#zoomFor(altKm);
    const wantDetail = zd > zc;
    const cxc = lon2tile(lng, zc), cyc = lat2tile(lat, zc);
    const cxd = wantDetail ? lon2tile(lng, zd) : 0, cyd = wantDetail ? lat2tile(lat, zd) : 0;
    const key = `${zc}/${cxc}/${cyc}/${wantDetail ? zd : 0}/${cxd}/${cyd}`;
    if (key === this.lastKey && this.active) return;
    this.lastKey = key;
    this.active = true;

    for (const e of this.cache.values()) e.keep = false;
    this.#loadGrid(zc, cxc, cyc, COV_GRID, R_COV);
    if (wantDetail) this.#loadGrid(zd, cxd, cyd, DET_GRID, R_DET);
    for (const [k, e] of [...this.cache.entries()]) {
      if (e.keep || e.persistent) continue;
      this.#drop(e);
      this.cache.delete(k);
    }
  }
}
