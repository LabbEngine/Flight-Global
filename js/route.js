// The flight route. Planning shows a clean great-circle arc that draws itself
// in. During a boarded flight the arc gives way to a "comet": a short line
// ahead of the aircraft and a filled trail behind it, with the full path kept
// as a faint context hairline. No looping demo plane — the aircraft only moves
// when the sim drives it.
import * as THREE from '../vendor/three/three.module.js';
import { GreatCircleCurve, arcAltitude, EARTH_RADIUS_KM } from './geo.js';
import { disposeObject } from './fx.js';

const CORE_COLOR = 0xdcedfb;   // bright line
const CASING_COLOR = 0x16222e; // dark outline so the line reads on bright terrain
const COMET_COLOR = 0xcfe6f8;
const CORE_RADIUS = 0.0026;
const CASING_RADIUS = 0.0046;
const DRAW_SECONDS = 3.0;
const AHEAD_KM = 340;
const BEHIND_KM = 820;
const TRAIL_PTS = 26;
const AHEAD_PTS = 12;

// A twin-engine widebody: tapered fuselage (rounded nose, upswept tail cone),
// swept raked-tip wings, two underwing engines, and a two-tone livery. Nose
// points +Z, up is +Y, wings along X — the frame the sim orients it in.
export function buildPlane() {
  const group = new THREE.Group();
  const body = new THREE.MeshStandardMaterial({ color: 0xf3f6fb, roughness: 0.5, metalness: 0.12 });
  const wingMat = new THREE.MeshStandardMaterial({ color: 0xd8e0ea, roughness: 0.55, metalness: 0.1 });
  const livery = new THREE.MeshStandardMaterial({ color: 0x4f93c4, roughness: 0.45, metalness: 0.18 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x28323f, roughness: 0.6, metalness: 0.2 });
  const ext = (shape, depth, mat) => new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: false }), mat);

  // fuselage
  const mid = new THREE.Mesh(new THREE.CylinderGeometry(0.085, 0.08, 0.72, 22), body);
  mid.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.SphereGeometry(0.085, 22, 16), body);
  nose.scale.set(1, 1, 1.7); nose.position.z = 0.36;
  const tailCone = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.46, 22), body);
  tailCone.rotation.x = -Math.PI / 2; tailCone.position.set(0, 0.02, -0.59);
  const canopy = new THREE.Mesh(new THREE.BoxGeometry(0.072, 0.03, 0.11), dark);
  canopy.position.set(0, 0.055, 0.3);

  // swept main wing with raked tips
  const w = new THREE.Shape();
  w.moveTo(0, 0.24); w.lineTo(0.30, 0.12); w.lineTo(0.86, -0.16); w.lineTo(0.86, -0.22);
  w.lineTo(0.30, -0.02); w.lineTo(0, -0.05);
  w.lineTo(-0.30, -0.02); w.lineTo(-0.86, -0.22); w.lineTo(-0.86, -0.16); w.lineTo(-0.30, 0.12);
  w.closePath();
  const wing = ext(w, 0.02, wingMat);
  wing.rotation.x = Math.PI / 2; wing.position.set(0, -0.012, -0.02);

  // horizontal stabilizers
  const t = new THREE.Shape();
  t.moveTo(0, 0.1); t.lineTo(0.32, -0.04); t.lineTo(0.32, -0.09); t.lineTo(0, -0.06);
  t.lineTo(-0.32, -0.09); t.lineTo(-0.32, -0.04); t.closePath();
  const tailplane = ext(t, 0.016, wingMat);
  tailplane.rotation.x = Math.PI / 2; tailplane.position.set(0, 0.03, -0.5);

  // vertical fin (livery)
  const f = new THREE.Shape();
  f.moveTo(0.05, 0); f.lineTo(-0.04, 0); f.lineTo(-0.24, 0.34); f.lineTo(-0.1, 0.34);
  f.closePath();
  const fin = ext(f, 0.016, livery);
  fin.rotation.y = -Math.PI / 2; fin.position.set(0.008, 0.05, -0.34);

  group.add(mid, nose, tailCone, canopy, wing, tailplane, fin);

  // two underwing engines
  for (const sx of [-1, 1]) {
    const nac = new THREE.Mesh(new THREE.CylinderGeometry(0.052, 0.046, 0.2, 16), livery);
    nac.rotation.x = Math.PI / 2; nac.position.set(sx * 0.34, -0.075, 0.05);
    const intake = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.03, 16), dark);
    intake.rotation.x = Math.PI / 2; intake.position.set(sx * 0.34, -0.075, 0.16);
    const pylon = new THREE.Mesh(new THREE.BoxGeometry(0.016, 0.06, 0.1), wingMat);
    pylon.position.set(sx * 0.34, -0.035, 0.02);
    group.add(nac, intake, pylon);
  }

  group.scale.setScalar(0.016);
  return group;
}

function lineFromColors(maxPts) {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(maxPts * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(maxPts * 3), 3));
  geo.setDrawRange(0, 0);
  return new THREE.Line(geo, new THREE.LineBasicMaterial({
    vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  }));
}

export class FlightRoute {
  constructor(scene) {
    this.scene = scene;
    this.group = null;
    this.tweens = [];
    this.active = false;
    this.simMode = false;
    this.progressKm = 0;
    this._pos = new THREE.Vector3(); // scratch for #pointAt
    this._planePos = new THREE.Vector3();
    this._planeFwd = new THREE.Vector3();
  }

  get isActive() { return this.active; }

  show(legs, { onDrawn = null } = {}) {
    this.clear();
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.active = true;
    this.simMode = false;
    this.legs = [];
    this.totalKm = 0;

    for (const leg of legs) {
      const angular = leg.distKm / EARTH_RADIUS_KM;
      const curve = new GreatCircleCurve(leg.from, leg.to, arcAltitude(angular));
      const segs = Math.max(64, Math.min(320, Math.round(angular * 220)));
      // map-style casing: dark outline under a bright core, visible on any terrain
      const casing = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segs, CASING_RADIUS, 8, false),
        new THREE.MeshBasicMaterial({ color: CASING_COLOR, transparent: true, opacity: 0.55, depthWrite: false })
      );
      const tube = new THREE.Mesh(
        new THREE.TubeGeometry(curve, segs, CORE_RADIUS, 8, false),
        new THREE.MeshBasicMaterial({ color: CORE_COLOR, transparent: true, opacity: 0.95, depthWrite: false })
      );
      casing.geometry.setDrawRange(0, 0);
      tube.geometry.setDrawRange(0, 0);
      this.group.add(casing, tube);
      this.legs.push({ curve, tube, casing, segs, distKm: leg.distKm, startKm: this.totalKm });
      this.totalKm += leg.distKm;
    }

    // faint full-path hairline (context for the full-trip camera during a flight)
    const pts = [];
    const N = 220;
    for (let i = 0; i <= N; i++) this.#pointAt((i / N) * this.totalKm, new THREE.Vector3()) && pts.push(this._pos.clone());
    const fullGeo = new THREE.BufferGeometry().setFromPoints(pts);
    this.fullLine = new THREE.Line(fullGeo, new THREE.LineBasicMaterial({
      color: COMET_COLOR, transparent: true, opacity: 0.32, depthWrite: false,
    }));
    this.fullLine.visible = false;
    this.group.add(this.fullLine);

    this.plane = buildPlane();
    this.plane.visible = false;
    this.group.add(this.plane);
    this.trail = lineFromColors(TRAIL_PTS);
    this.ahead = lineFromColors(AHEAD_PTS);
    this.trail.visible = false;
    this.ahead.visible = false;
    this.group.add(this.trail, this.ahead);

    // sequential draw-in, a constant 3 s regardless of distance
    const tl = gsap.timeline({ onComplete: () => onDrawn?.() });
    for (const leg of this.legs) {
      const proxy = { p: 0 };
      const dur = DRAW_SECONDS * (leg.distKm / this.totalKm);
      tl.to(proxy, {
        p: 1, duration: dur, ease: 'power1.inOut',
        onUpdate: () => {
          leg.tube.geometry.setDrawRange(0, Math.ceil(leg.tube.geometry.index.count * proxy.p));
          leg.casing.geometry.setDrawRange(0, Math.ceil(leg.casing.geometry.index.count * proxy.p));
        },
      });
    }
    this.tweens.push(tl);
    this.progressKm = 0;
  }

  #pointAt(km, target, tangent = null) {
    if (!this.legs || !this.legs.length) return null;
    let leg = this.legs[this.legs.length - 1];
    for (const l of this.legs) { if (km <= l.startKm + l.distKm) { leg = l; break; } }
    const t = THREE.MathUtils.clamp((km - leg.startKm) / leg.distKm, 0, 1);
    leg.curve.getPoint(t, this._pos);
    if (tangent) tangent.copy(leg.curve.getTangent(t));
    if (target) target.copy(this._pos);
    return this._pos;
  }

  enterSim() {
    if (!this.active) return;
    this.simMode = true;
    this.progressKm = 0;
    for (const leg of this.legs) { leg.tube.visible = false; leg.casing.visible = false; }
    this.fullLine.visible = true;
    this.plane.visible = true;
    this.trail.visible = true;
    this.ahead.visible = true;
  }
  exitSim() {
    this.simMode = false;
    if (!this.active) return;
    for (const leg of this.legs) {
      leg.tube.visible = true;
      leg.casing.visible = true;
      leg.tube.geometry.setDrawRange(0, leg.tube.geometry.index.count);
      leg.casing.geometry.setDrawRange(0, leg.casing.geometry.index.count);
    }
    this.fullLine.visible = false;
    this.plane.visible = false;
    this.trail.visible = false;
    this.ahead.visible = false;
  }
  setProgressKm(km) { this.progressKm = THREE.MathUtils.clamp(km, 0, this.totalKm); }
  planeState() {
    if (!this.active || !this.plane?.visible) return null;
    return { pos: this._planePos.clone(), fwd: this._planeFwd.clone() };
  }

  // fill a colored line by sampling the curve between two distances
  #fillLine(line, fromKm, toKm, n, headA, tailA) {
    const pos = line.geometry.attributes.position.array;
    const col = line.geometry.attributes.color.array;
    const c = new THREE.Color(COMET_COLOR);
    const span = Math.max(1e-3, toKm - fromKm);
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      this.#pointAt(fromKm + f * span, null);
      pos.set([this._pos.x, this._pos.y, this._pos.z], i * 3);
      const a = tailA + (headA - tailA) * f;
      col.set([c.r * a, c.g * a, c.b * a], i * 3);
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.geometry.attributes.color.needsUpdate = true;
    line.geometry.setDrawRange(0, n);
  }

  update(dt, camera) {
    if (!this.active) return;
    if (!this.simMode) return; // planning: static tubes, nothing to animate

    const pos = new THREE.Vector3();
    const tan = new THREE.Vector3();
    this.#pointAt(this.progressKm, pos, tan);
    this.plane.position.copy(pos);
    const up = pos.clone().normalize();
    const fwd = tan.normalize();
    const right = new THREE.Vector3().crossVectors(up, fwd).normalize();
    const upO = new THREE.Vector3().crossVectors(fwd, right).normalize();
    this.plane.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, upO, fwd));
    const camScale = THREE.MathUtils.clamp((camera.position.length() - 1) * 1.25, 0.4, 3);
    this.plane.scale.setScalar(0.016 * camScale);
    this._planePos.copy(pos);
    this._planeFwd.copy(fwd);

    // filled trail behind, short line ahead (both brightest at the plane)
    this.#fillLine(this.trail, Math.max(0, this.progressKm - BEHIND_KM), this.progressKm, TRAIL_PTS, 1.0, 0.0);
    const aheadTo = Math.min(this.totalKm, this.progressKm + AHEAD_KM);
    if (aheadTo - this.progressKm > 1) {
      this.ahead.visible = true;
      this.#fillLine(this.ahead, this.progressKm, aheadTo, AHEAD_PTS, 0.1, 0.95);
    } else {
      this.ahead.visible = false;
    }
  }

  clear() {
    this.tweens.forEach((t) => t.kill());
    this.tweens = [];
    if (this.group) disposeObject(this.group);
    this.group = null;
    this.active = false;
    this.simMode = false;
    this.progressKm = 0;
  }
}
