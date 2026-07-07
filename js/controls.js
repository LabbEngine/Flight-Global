// Quaternion trackball camera: rotate the globe in ANY direction (straight
// over the poles included), with inertia, altitude-scaled speeds, smooth zoom,
// animated fly-to that settles north-up, and idle auto-rotation.
import * as THREE from '../vendor/three/three.module.js';
import { latLngToVec3, vec3ToLatLng, raySphere, DEG } from './geo.js';

const MIN_DIST = 1.025; // ~160 km altitude - detail layer keeps it crisp
const MAX_DIST = 6.5;
const IDLE_SECONDS = 25;

const _yAxis = new THREE.Vector3(0, 1, 0);
const _xAxis = new THREE.Vector3(1, 0, 0);
const _zAxis = new THREE.Vector3(0, 0, 1);

export class GlobeControls {
  constructor(camera, dom) {
    this.camera = camera;
    this.dom = dom;
    this.q = new THREE.Quaternion();
    this.dist = 3.4;
    this.targetDist = this.dist;
    this.velYaw = 0; this.velPitch = 0;
    this.dragging = false;
    this.flying = null;
    this.lastInteraction = performance.now();
    this.autoRotate = true;
    this.enabled = true; // false while the flight sim owns the camera
    this.onPick = null; // dblclick -> ({lat,lng})
    this.onContext = null; // right click -> ({lat,lng,clientX,clientY})
    this.onHover = null; // pointermove -> ({lat,lng}|null)
    this.jumpTo(30, 10, 3.4);

    dom.addEventListener('pointerdown', (e) => this.#down(e));
    window.addEventListener('pointermove', (e) => this.#move(e));
    window.addEventListener('pointerup', () => this.#up());
    dom.addEventListener('wheel', (e) => this.#wheel(e), { passive: false });
    dom.addEventListener('dblclick', (e) => this.#dblclick(e));
    dom.addEventListener('contextmenu', (e) => this.#context(e));
    this.#apply();
  }

  get altitude() { return this.dist - 1; }
  #zoomFactor() { return THREE.MathUtils.clamp(this.altitude / 2.2, 0.012, 1); }

  // Camera orientation looking at lat/lng from outside, north up.
  #orientationFor(lat, lng) {
    const pos = latLngToVec3(lat, lng, 1);
    const up = Math.abs(lat) > 88 ? _zAxis : _yAxis; // poles need a fallback up
    const m = new THREE.Matrix4().lookAt(pos, new THREE.Vector3(0, 0, 0), up);
    return new THREE.Quaternion().setFromRotationMatrix(m);
  }

  jumpTo(lat, lng, dist) {
    this.q.copy(this.#orientationFor(lat, lng));
    this.dist = dist;
    this.targetDist = dist;
    this.#apply();
  }

  // Rotate around the camera's own axes - this is what makes every
  // direction (including over the poles) reachable.
  rotateBy(yaw, pitch) {
    if (yaw) this.q.multiply(new THREE.Quaternion().setFromAxisAngle(_yAxis, yaw));
    if (pitch) this.q.multiply(new THREE.Quaternion().setFromAxisAngle(_xAxis, pitch));
    this.q.normalize();
  }

  // Where on screen is north? Degrees for a CSS rotate on the compass rose.
  northAngleDeg() {
    const n = _yAxis.clone().applyQuaternion(this.q.clone().invert());
    return Math.atan2(n.x, n.y) / DEG;
  }

  centerLatLng() {
    return vec3ToLatLng(this.camera.position);
  }

  #poke() {
    this.lastInteraction = performance.now();
    if (this.flying) { this.flying.kill(); this.flying = null; }
  }

  #down(e) {
    if (e.button !== 0 || !this.enabled) return;
    this.#poke();
    this.dragging = true;
    this.px = e.clientX; this.py = e.clientY;
    this.velYaw = 0; this.velPitch = 0;
    this.dom.classList.add('grabbing');
  }

  #move(e) {
    if (this.onHover) this.onHover(this.pick(e.clientX, e.clientY));
    if (!this.dragging) return;
    this.#poke();
    const k = 0.0038 * this.#zoomFactor();
    const yaw = -(e.clientX - this.px) * k;
    const pitch = -(e.clientY - this.py) * k;
    this.px = e.clientX; this.py = e.clientY;
    this.rotateBy(yaw, pitch);
    this.velYaw = yaw; this.velPitch = pitch;
  }

  #up() {
    if (!this.dragging) return;
    this.dragging = false;
    this.dom.classList.remove('grabbing');
  }

  #wheel(e) {
    e.preventDefault();
    if (!this.enabled) return;
    this.#poke();
    const speed = e.ctrlKey ? 0.008 : 0.0016; // pinch gestures arrive as ctrl+wheel
    this.targetDist *= Math.exp(e.deltaY * speed);
    this.targetDist = THREE.MathUtils.clamp(this.targetDist, MIN_DIST, MAX_DIST);
  }

  #dblclick(e) {
    if (!this.enabled) return;
    const p = this.pick(e.clientX, e.clientY);
    if (p && this.onPick) this.onPick(p);
  }

  #context(e) {
    e.preventDefault();
    if (!this.enabled) return;
    const p = this.pick(e.clientX, e.clientY);
    if (p && this.onContext) this.onContext({ ...p, clientX: e.clientX, clientY: e.clientY });
  }

  // Screen point -> lat/lng on the globe, or null if we miss it.
  pick(clientX, clientY) {
    const rect = this.dom.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1
    );
    this.camera.updateMatrixWorld();
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const hit = raySphere(ray.ray.origin, ray.ray.direction, 1);
    return hit ? vec3ToLatLng(hit) : null;
  }

  zoomBy(factor) {
    this.#poke();
    this.targetDist = THREE.MathUtils.clamp(this.targetDist * factor, MIN_DIST, MAX_DIST);
  }

  nudge(dLatDeg, dLngDeg) {
    this.lastInteraction = performance.now();
    const k = Math.max(0.05, this.#zoomFactor());
    this.rotateBy(-dLngDeg * DEG * k, dLatDeg * DEG * k);
  }

  // Animated flight to a target view; arrives with north pointing up.
  flyTo({ lat, lng, dist = null, duration = null, onComplete = null }) {
    this.#poke();
    this.velYaw = 0; this.velPitch = 0; // stale drag inertia must not shove us off target
    const q0 = this.q.clone();
    const q1 = this.#orientationFor(lat, lng);
    const angle = q0.angleTo(q1);
    const d0 = this.dist;
    const d1 = dist ?? this.dist;
    // long hops get a graceful zoom-out bump mid-flight
    const bump = Math.min(angle * 0.55, Math.max(0, 4.4 - Math.max(d0, d1)));
    const dur = duration ?? THREE.MathUtils.clamp(0.7 + angle * 0.55, 0.8, 2.6);
    const state = { t: 0 };
    this.flying = gsap.to(state, {
      t: 1, duration: dur, ease: 'power2.inOut',
      onUpdate: () => {
        this.q.slerpQuaternions(q0, q1, state.t);
        this.dist = THREE.MathUtils.lerp(d0, d1, state.t) + bump * Math.sin(Math.PI * state.t);
        this.targetDist = this.dist;
      },
      onComplete: () => {
        this.flying = null;
        this.lastInteraction = performance.now();
        onComplete?.();
      },
    });
    this.flying.eventCallback('onInterrupt', () => { this.flying = null; });
  }

  faceNorth() {
    const { lat, lng } = this.centerLatLng();
    this.flyTo({ lat, lng, duration: 0.9 });
  }

  update(dt) {
    if (!this.enabled) return; // the sim is flying the camera
    // inertia after a drag
    if (!this.dragging && !this.flying) {
      const decay = Math.exp(-dt * 3.2);
      this.velYaw *= decay; this.velPitch *= decay;
      if (Math.abs(this.velYaw) > 1e-6 || Math.abs(this.velPitch) > 1e-6) {
        this.rotateBy(this.velYaw * dt * 21, this.velPitch * dt * 21);
      }
      // gentle spin when idle
      const idle = (performance.now() - this.lastInteraction) / 1000 - IDLE_SECONDS;
      if (this.autoRotate && idle > 0) {
        const w = dt * 0.9 * DEG * Math.min(1, idle / 4);
        this.q.premultiply(new THREE.Quaternion().setFromAxisAngle(_yAxis, w));
      }
    }
    // smooth zoom approach
    if (!this.flying) {
      this.dist += (this.targetDist - this.dist) * (1 - Math.exp(-dt * 7));
    }
    this.#apply();
  }

  #apply() {
    this.camera.quaternion.copy(this.q);
    this.camera.position.set(0, 0, this.dist).applyQuaternion(this.q);
    this.camera.near = THREE.MathUtils.clamp(this.altitude * 0.25, 0.0006, 0.5);
    this.camera.far = 130;
    this.camera.updateProjectionMatrix();
  }
}
