// Location markers. The 3D marker is a small neutral dot with a thin ring;
// the name reads as a tactical callout — a leader line rising from the point
// to an uppercase label with a role tag. Muted colors, minimal glow.
import * as THREE from '../vendor/three/three.module.js';
import { latLngToVec3 } from './geo.js';
import { worldToScreen, facesCamera, disposeObject } from './fx.js';

export const PIN_COLORS = { origin: 0x86c7a2, dest: 0xe0a081, stop: 0xd6bd83, user: 0x6fb0dd };
const TAGS = { origin: 'ORIGIN', dest: 'DEST', user: 'YOU', stop: 'FUEL' };

function buildMarker(colorHex, small = false) {
  const s = small ? 0.7 : 1;
  const group = new THREE.Group();
  const color = new THREE.Color(colorHex);
  const dot = new THREE.Mesh(
    new THREE.SphereGeometry(0.0034 * s, 16, 16),
    new THREE.MeshBasicMaterial({ color: 0xf2f6fb })
  );
  dot.position.y = 0.001;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.0075 * s, 0.0089 * s, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false })
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.0006;
  const pulse = new THREE.Mesh(
    new THREE.RingGeometry(0.0075 * s, 0.0089 * s, 40),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false })
  );
  pulse.rotation.x = -Math.PI / 2;
  pulse.position.y = 0.0006;
  group.add(dot, ring, pulse);
  return { group, ring, pulse, dot, headY: 0.004 * s };
}

export class PinManager {
  constructor(scene, labelRoot) {
    this.scene = scene;
    this.labelRoot = labelRoot;
    this.pins = {};
    this.stops = [];
    this._seq = 0;
  }

  #makeLabel(role, place) {
    const label = document.createElement('div');
    label.className = `pin-label pin-label--${role}`;
    const name = (place.iata && role === 'stop') ? `${place.iata}` : (place.name || '').toUpperCase();
    label.innerHTML = `<span class="pin-tag">${TAGS[role] || ''}</span><span class="pin-name">${name}</span>`;
    this.labelRoot.appendChild(label);
    return label;
  }

  #place(root, place) {
    const normal = latLngToVec3(place.lat, place.lng, 1);
    root.position.copy(normal);
    root.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), normal.clone().normalize());
  }

  setPin(role, place, { pending = false } = {}) {
    this.clearPin(role);
    const { group: inner, pulse, headY } = buildMarker(PIN_COLORS[role]);
    const root = new THREE.Group();
    this.#place(root, place);
    root.add(inner);
    this.scene.add(root);
    const label = this.#makeLabel(role, place);
    label.classList.add('is-pending'); // hidden until revealed (fades via CSS)
    const t1 = gsap.from(inner.scale, { x: 0, y: 0, z: 0, duration: 0.5, ease: 'back.out(2)' });
    const pulseT = gsap.timeline({ repeat: -1, repeatDelay: 1.1 })
      .fromTo(pulse.scale, { x: 1, y: 1, z: 1 }, { x: 2.4, y: 2.4, z: 2.4, duration: 1.8, ease: 'power1.out' }, 0)
      .fromTo(pulse.material, { opacity: 0.4 }, { opacity: 0, duration: 1.8, ease: 'power1.out' }, 0);
    const token = ++this._seq; // identifies this pin instance for deferred reveals
    this.pins[role] = { root, label, headY, tweens: [t1, pulseT], token };
    // direct sets show the label right away; deferred ones print after the fly-to
    if (!pending) requestAnimationFrame(() => this.revealPin(role, token));
  }

  tokenOf(role) { return this.pins[role]?.token; }

  // a one-shot ripple of expanding rings from a pin (route reaching a city)
  pulse(role) {
    const p = this.pins[role];
    if (!p) return;
    const color = new THREE.Color(PIN_COLORS[role] ?? 0xffffff);
    for (let k = 0; k < 3; k++) {
      const ring = new THREE.Mesh(
        new THREE.RingGeometry(0.006, 0.0072, 48),
        new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 0.0012;
      p.root.add(ring);
      gsap.timeline({ delay: k * 0.32, onComplete: () => { ring.geometry.dispose(); ring.material.dispose(); p.root.remove(ring); } })
        .fromTo(ring.scale, { x: 0.4, y: 0.4, z: 0.4 }, { x: 7, y: 7, z: 7, duration: 1.4, ease: 'power2.out' }, 0)
        .fromTo(ring.material, { opacity: 0.85 }, { opacity: 0, duration: 1.4, ease: 'power2.out' }, 0);
    }
  }

  revealPin(role, token) {
    const p = this.pins[role];
    if (!p || (token != null && p.token !== token)) return; // stale reveal for a replaced pin
    p.label.classList.remove('is-pending');
  }

  clearPin(role) {
    const p = this.pins[role];
    if (!p) return;
    p.tweens.forEach((t) => t.kill());
    p.label.remove();
    disposeObject(p.root);
    delete this.pins[role];
  }

  setStops(places) {
    this.clearStops();
    for (const place of places) {
      const { group: inner, headY } = buildMarker(PIN_COLORS.stop, true);
      const root = new THREE.Group();
      this.#place(root, place);
      root.add(inner);
      this.scene.add(root);
      const label = this.#makeLabel('stop', place);
      gsap.from(inner.scale, { x: 0, y: 0, z: 0, duration: 0.5, ease: 'back.out(2)' });
      this.stops.push({ root, label, headY });
    }
  }

  clearStops() {
    for (const s of this.stops) { s.label.remove(); disposeObject(s.root); }
    this.stops = [];
  }

  clearAll() {
    this.clearPin('origin');
    this.clearPin('dest');
    this.clearPin('user');
    this.clearStops();
  }

  update(camera, width, height) {
    const scale = THREE.MathUtils.clamp((camera.position.length() - 1) * 1.15, 0.14, 2.4);
    const all = [...Object.values(this.pins), ...this.stops];
    const placed = [];
    for (const p of all) {
      p.root.scale.setScalar(scale);
      const visible = facesCamera(p.root.position, camera);
      p.root.visible = visible;
      const s = visible ? worldToScreen(p.root.position, camera, width, height) : null;
      if (!s) { p.label.style.display = 'none'; continue; }
      p.label.style.display = ''; // must be visible before measuring its width
      if (!p.labelW) p.labelW = p.label.offsetWidth || 70;
      // military callout: label sits up-left of the point, leader drops back to it
      let ly = s.y - 30;
      for (let tries = 0; tries < 4; tries++) {
        const hit = placed.find((o) => Math.abs(o.x - s.x) < (o.w + p.labelW) / 2 + 10 && Math.abs(o.y - ly) < 22);
        if (!hit) break;
        ly = hit.y - 26;
      }
      placed.push({ x: s.x, y: ly, w: p.labelW });
      p.label.style.setProperty('--stem', `${(s.y - ly).toFixed(1)}px`);
      p.label.style.transform = `translate(${s.x.toFixed(1)}px, ${ly.toFixed(1)}px) translateY(-100%)`;
    }
  }
}
