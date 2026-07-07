// The globe surface: OpenStreetMap tiles draped on the sphere at every zoom.
// The tile zoom is chosen so the loaded grid always covers the whole visible
// cap — coarse far out, finer as you zoom in. Streams from OSM when online;
// offline the base satellite sphere shows through (poles always do, since the
// Web-Mercator tile scheme stops at ±85°). © OpenStreetMap contributors.
import * as THREE from '../vendor/three/three.module.js';
import { latLngToVec3 } from './geo.js';

// OSM standard tiles: keyless. Please respect the OSM tile usage policy.
const TILE_URL = (z, x, y) =>
  `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
const GRID = 3;           // (2*GRID+1)^2 tiles -> 7x7 around the look point
const PATCH = 8;          // mesh subdivisions per tile (for sphere curvature)
const R = 1.0025;         // clearly above the base sphere so the limb doesn't z-fight
const MIN_Z = 2;
const MAX_Z = 17;

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
  }

  #zoomFor(altKm) {
    return THREE.MathUtils.clamp(Math.round(Math.log2(229000 / Math.max(20, altKm))), 3, MAX_Z);
  }

  #buildPatch(z, x, y, tex) {
    const lng0 = tile2lon(x, z), lng1 = tile2lon(x + 1, z);
    const lat0 = tile2lat(y, z), lat1 = tile2lat(y + 1, z);
    const g = PATCH;
    const pos = new Float32Array((g + 1) * (g + 1) * 3);
    const uv = new Float32Array((g + 1) * (g + 1) * 2);
    let p = 0, u = 0;
    for (let j = 0; j <= g; j++) {
      for (let i = 0; i <= g; i++) {
        const v = latLngToVec3(lat0 + (lat1 - lat0) * (j / g), lng0 + (lng1 - lng0) * (i / g), R);
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

  #load(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (this.cache.has(key)) { this.cache.get(key).keep = true; return; }
    if (this.failed.has(key)) return;
    const entry = { mesh: null, keep: true };
    this.cache.set(key, entry);
    this.loader.load(TILE_URL(z, x, y), (tex) => {
      // identity check: the cache may hold a NEWER entry for this key by now
      if (this.cache.get(key) !== entry) { tex.dispose(); return; }
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.anisotropy = 4;
      entry.mesh = this.#buildPatch(z, x, y, tex);
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
  }

  update(camera) {
    const dist = camera.position.length();
    if (!this.enabled) {
      if (this.active || this.cache.size) this.#clear();
      return;
    }
    // Pick a zoom so the (2*GRID+1)^2 grid spans the whole visible cap: the
    // globe is fully draped in OSM at any distance, gaining detail as you close in.
    const capFullDeg = 2 * Math.acos(THREE.MathUtils.clamp(1 / dist, 0, 1)) * 180 / Math.PI;
    const span = 2 * GRID + 1;
    const z = THREE.MathUtils.clamp(Math.floor(Math.log2(360 * span / Math.max(18, capFullDeg))), MIN_Z, MAX_Z);
    const c = camera.position.clone().normalize();
    const lat = clampLat(90 - Math.acos(THREE.MathUtils.clamp(c.y, -1, 1)) * 180 / Math.PI);
    let lng = Math.atan2(c.z, -c.x) * 180 / Math.PI - 180;
    if (lng < -180) lng += 360; if (lng > 180) lng -= 360;
    const cx = lon2tile(lng, z), cy = lat2tile(lat, z);
    const key = `${z}/${cx}/${cy}`;
    if (key === this.lastKey && this.active) return;
    this.lastKey = key;
    this.active = true;

    for (const e of this.cache.values()) e.keep = false;
    const max = 1 << z;
    for (let dy = -GRID; dy <= GRID; dy++) for (let dx = -GRID; dx <= GRID; dx++) {
      const x = ((cx + dx) % max + max) % max;
      const y = cy + dy;
      if (y < 0 || y >= max) continue;
      this.#load(z, x, y);
    }
    for (const [k, e] of [...this.cache.entries()]) {
      if (e.keep) continue;
      this.#drop(e);
      this.cache.delete(k);
    }
  }
}
