// First-person cabin view: a full modeled airliner interior you sit inside.
// A ~30-row, 3-3 tube (fuselage shell, floor, overhead bins, ceiling light strip,
// a window at every row showing a shader sky, and modern seats with armrests,
// tray tables and seat-back IFE screens) built almost entirely from InstancedMesh
// so 180 seats cost only a handful of draw calls. Your point of view is placed at
// the exact seat you chose in the boarding map. The screen on the seat in front of
// you shows live flight data; the rest show the entertainment home screen. Drag to
// look around; one button drops you back to the Earth view. Runs its own renderer.
import * as THREE from '../vendor/three/three.module.js';

THREE.ColorManagement.enabled = true;

// ---- shared cabin layout (also used by the boarding seat map) ----
export const ROWS = 30;
export const COLS = ['A', 'B', 'C', 'D', 'E', 'F']; // 3-3, aisle between C and D

const SEAT_X = { A: -1.56, B: -1.08, C: -0.60, D: 0.60, E: 1.08, F: 1.56 };
const ROW_PITCH = 1.0;
const FLOOR_Y = -1.0;
const EYE_Y = 0.18;
const RADIUS = 1.98;   // fuselage half-width (X)
const Y_SCALE = 0.68;  // flatten the circle into a fuselage oval
const V_RADIUS = RADIUS * Y_SCALE;
const rowZ = (r) => (r - 1) * ROW_PITCH;           // row 1 at the front (z=0), aft toward +Z
const CABIN_LEN = (ROWS - 1) * ROW_PITCH + 3.4;
const MID_Z = ((ROWS - 1) * ROW_PITCH) / 2;
const WIN_Y = 0.12;
const SCREEN_Y = FLOOR_Y + 0.92;    // seat-back screen height
const BACK_FACE_Z = 0.27;           // +Z offset of a seat back's rear face
const ellipseX = (y) => RADIUS * Math.sqrt(Math.max(0, 1 - (y / V_RADIUS) ** 2));

const SKY_VERT = `
  varying vec3 vWorld;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }`;

const SKY_FRAG = `
  precision highp float;
  varying vec3 vWorld;
  uniform float uTime;
  uniform vec3 uSun;
  float hash(vec2 p) { p = fract(p * vec2(123.34, 345.45)); p += dot(p, p + 34.345); return fract(p.x * p.y); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
    float a = hash(i), b = hash(i + vec2(1, 0)), c = hash(i + vec2(0, 1)), d = hash(i + vec2(1, 1));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.55; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
    for (int i = 0; i < 6; i++) { v += a * noise(p); p = m * p; a *= 0.5; }
    return v;
  }
  void main() {
    vec3 dir = normalize(vWorld - cameraPosition);
    vec3 sun = normalize(uSun);
    float up = clamp(dir.y, 0.0, 1.0);
    vec3 col = mix(vec3(0.80, 0.88, 0.96), vec3(0.12, 0.34, 0.72), pow(up, 0.42));
    float s = max(dot(dir, sun), 0.0);
    col += vec3(1.0, 0.92, 0.78) * pow(s, 5.0) * 0.30;
    col += vec3(1.0, 0.96, 0.88) * pow(s, 2200.0) * 1.6;
    if (dir.y < -0.006) {
      float th = -0.14 / dir.y;
      vec2 p = cameraPosition.xz + dir.xz * th;
      float dist = length(dir.xz * th);
      vec2 uv = p * 0.85 + vec2(uTime * 0.02, uTime * 0.005);
      float n = fbm(uv); n = n * 0.62 + 0.5 * fbm(uv * 2.6 + 3.0);
      float amt = clamp(smoothstep(0.46, 0.66, n) * smoothstep(150.0, 2.0, dist), 0.0, 1.0);
      float lit = 0.35 + 0.7 * fbm(uv * 1.3 + 7.0);
      vec3 cloud = mix(vec3(0.50, 0.56, 0.67), vec3(1.0), lit);
      cloud = mix(cloud, vec3(1.0, 0.95, 0.86), s * 0.5);
      col = mix(col, cloud, amt);
    }
    col = mix(col, vec3(0.86, 0.90, 0.96), smoothstep(0.05, 0.0, abs(dir.y)) * 0.28);
    gl_FragColor = vec4(col, 1.0);
  }`;

function shapeRR(ctx, w, h, r) {
  ctx.moveTo(-w + r, -h);
  ctx.lineTo(w - r, -h); ctx.quadraticCurveTo(w, -h, w, -h + r);
  ctx.lineTo(w, h - r); ctx.quadraticCurveTo(w, h, w - r, h);
  ctx.lineTo(-w + r, h); ctx.quadraticCurveTo(-w, h, -w, h - r);
  ctx.lineTo(-w, -h + r); ctx.quadraticCurveTo(-w, -h, -w + r, -h);
}
const rrShape = (w, h, r) => { const s = new THREE.Shape(); shapeRR(s, w, h, r); return s; };
const rrHole = (w, h, r) => { const p = new THREE.Path(); shapeRR(p, w, h, r); return p; };
function cvRR(x, rx, ry, w, h, r) {
  x.beginPath();
  x.moveTo(rx + r, ry); x.arcTo(rx + w, ry, rx + w, ry + h, r); x.arcTo(rx + w, ry + h, rx, ry + h, r);
  x.arcTo(rx, ry + h, rx, ry, r); x.arcTo(rx, ry, rx + w, ry, r); x.closePath();
}

// ---- procedural texture helpers (all offline, generated on <canvas> at init) ----
// a simple equirect gradient → cool ceiling / warm mid / dark floor, for image-based reflections
function makeEnvTexture() {
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 256;
  const x = cv.getContext('2d');
  const g = x.createLinearGradient(0, 0, 0, 256);
  g.addColorStop(0.0, '#c6d8ee'); g.addColorStop(0.42, '#aab3bf');
  g.addColorStop(0.6, '#d8ccb6'); g.addColorStop(1.0, '#1e222a');
  x.fillStyle = g; x.fillRect(0, 0, 512, 256);
  const t = new THREE.CanvasTexture(cv);
  t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// convert a grayscale height canvas into a tiling normal map (wrap-safe Sobel)
function heightToNormal(src, strength) {
  const s = src.width, d = src.getContext('2d').getImageData(0, 0, s, s).data;
  const out = document.createElement('canvas'); out.width = out.height = s;
  const ox = out.getContext('2d'), od = ox.createImageData(s, s);
  const H = (X, Y) => d[(((Y + s) % s) * s + ((X + s) % s)) * 4] / 255;
  for (let y = 0; y < s; y++) for (let x = 0; x < s; x++) {
    const dx = (H(x - 1, y) - H(x + 1, y)) * strength, dy = (H(x, y - 1) - H(x, y + 1)) * strength;
    const inv = 1 / Math.sqrt(dx * dx + dy * dy + 1), i = (y * s + x) * 4;
    od.data[i] = (dx * inv * 0.5 + 0.5) * 255; od.data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
    od.data[i + 2] = (inv * 0.5 + 0.5) * 255; od.data[i + 3] = 255;
  }
  ox.putImageData(od, 0, 0);
  const t = new THREE.CanvasTexture(out); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// roughness map from a height canvas: thread crowns a bit glossier than the valleys
function heightToRough(src, crown, valley) {
  const s = src.width, d = src.getContext('2d').getImageData(0, 0, s, s).data;
  const out = document.createElement('canvas'); out.width = out.height = s;
  const ox = out.getContext('2d'), od = ox.createImageData(s, s);
  for (let i = 0; i < d.length; i += 4) { const v = (valley + (crown - valley) * (d[i] / 255)) * 255; od.data[i] = od.data[i + 1] = od.data[i + 2] = v; od.data[i + 3] = 255; }
  ox.putImageData(od, 0, 0);
  const t = new THREE.CanvasTexture(out); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// a tileable woven-fabric albedo + matching normal + roughness (basketweave threads + slub noise)
function makeWeaveMaps() {
  const size = 256, g = document.createElement('canvas'); g.width = g.height = size;
  const gx = g.getContext('2d');
  gx.fillStyle = '#8f8f8f'; gx.fillRect(0, 0, size, size);
  const n = 22, cell = size / n;
  for (let iy = 0; iy < n; iy++) for (let ix = 0; ix < n; ix++) {
    const over = (ix + iy) % 2 === 0, x0 = ix * cell, y0 = iy * cell;
    const grd = over ? gx.createLinearGradient(x0, y0, x0 + cell, y0) : gx.createLinearGradient(x0, y0, x0, y0 + cell);
    grd.addColorStop(0, '#6a6a6a'); grd.addColorStop(0.5, '#ececec'); grd.addColorStop(1, '#6a6a6a');
    gx.fillStyle = grd; cvRR(gx, x0 + cell * 0.05, y0 + cell * 0.05, cell * 0.9, cell * 0.9, cell * 0.34); gx.fill();
  }
  const im = gx.getImageData(0, 0, size, size);
  for (let i = 0; i < im.data.length; i += 4) { const j = (Math.random() * 2 - 1) * 12; im.data[i] += j; im.data[i + 1] += j; im.data[i + 2] += j; }
  gx.putImageData(im, 0, 0);
  const map = new THREE.CanvasTexture(g); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return { map, normal: heightToNormal(g, 2.4), rough: heightToRough(g, 0.72, 0.96) };
}

// a soft round contact-shadow decal, laid under each seat so nothing floats
function makeRadialShadow() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 128;
  const x = cv.getContext('2d');
  const g = x.createRadialGradient(64, 64, 4, 64, 64, 60);
  g.addColorStop(0, 'rgba(0,0,0,0.5)'); g.addColorStop(0.6, 'rgba(0,0,0,0.25)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// speckled dark carpet (albedo + a fine pile normal)
function makeCarpetMaps() {
  const size = 256;
  const g = document.createElement('canvas'); g.width = g.height = size;
  const gx = g.getContext('2d');
  gx.fillStyle = '#2b2f37'; gx.fillRect(0, 0, size, size);
  const im = gx.getImageData(0, 0, size, size);
  for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() * 2 - 1) * 20; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n + 3; }
  gx.putImageData(im, 0, 0);
  const map = new THREE.CanvasTexture(g); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  return { map, normal: heightToNormal(g, 1.5) };
}

// light composite wall/bin panel (subtle orange-peel grain + a seam border per tile)
function makePanelMaps() {
  const size = 256;
  const g = document.createElement('canvas'); g.width = g.height = size;
  const gx = g.getContext('2d');
  gx.fillStyle = '#aeb3ba'; gx.fillRect(0, 0, size, size);
  const im = gx.getImageData(0, 0, size, size);
  for (let i = 0; i < im.data.length; i += 4) { const n = (Math.random() * 2 - 1) * 5; im.data[i] += n; im.data[i + 1] += n; im.data[i + 2] += n; }
  gx.putImageData(im, 0, 0);
  gx.strokeStyle = 'rgba(60,66,74,0.35)'; gx.lineWidth = 2; gx.strokeRect(1, 1, size - 2, size - 2);
  const map = new THREE.CanvasTexture(g); map.colorSpace = THREE.SRGBColorSpace; map.wrapS = map.wrapT = THREE.RepeatWrapping;
  const h = document.createElement('canvas'); h.width = h.height = size;
  const hx = h.getContext('2d'); hx.fillStyle = '#b0b0b0'; hx.fillRect(0, 0, size, size);
  hx.strokeStyle = '#585858'; hx.lineWidth = 4; hx.strokeRect(1, 1, size - 2, size - 2);
  return { map, normal: heightToNormal(h, 1.6) };
}

export class CabinView {
  constructor(container) {
    this.container = container;
    this.onExit = null;
    this.ready = false;
    this.active = false;
    this.raf = 0;
    this.t0 = 0;
    this.yaw = 0; this.pitch = 0;
    this.tYaw = 0; this.tPitch = 0;
    this._data = null;
    this._hidden = null;
    this._loop = this._loop.bind(this);
  }

  #init() {
    if (this.ready) return;
    this.ready = true;

    const canvas = document.createElement('canvas');
    canvas.className = 'cabin-canvas';
    this.container.appendChild(canvas);
    this.canvas = canvas;

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping; // filmic roll-off instead of hard white clipping
    renderer.toneMappingExposure = 1.15;
    this.renderer = renderer;

    this.scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pmrem.fromEquirectangular(makeEnvTexture()).texture; // image-based reflections
    pmrem.dispose();
    this.camera = new THREE.PerspectiveCamera(68, 1, 0.05, 400);

    this.sky = { uTime: { value: 0 }, uSun: { value: new THREE.Vector3(0.5, 0.55, -0.7).normalize() } };
    this.#buildShell();
    this.#buildSeats();
    this.#buildScreens();
    this.#buildWindows();
    this.#buildFurniture();
    this.#buildLights();
    this.#buildOverlay();
    this.#bindDrag();
    window.addEventListener('resize', () => this.active && this.#resize());
  }

  #buildShell() {
    const pm = makePanelMaps();
    pm.map.repeat.set(14, 30); pm.normal.repeat.set(14, 30);
    const wall = new THREE.MeshStandardMaterial({ color: 0xffffff, map: pm.map, normalMap: pm.normal, normalScale: new THREE.Vector2(0.35, 0.35), roughness: 0.9, metalness: 0.02, envMapIntensity: 0.4, side: THREE.BackSide });
    const tubeGeo = new THREE.CylinderGeometry(RADIUS, RADIUS, CABIN_LEN, 64, 1, true);
    tubeGeo.scale(1, 1, Y_SCALE);
    const tube = new THREE.Mesh(tubeGeo, wall);
    tube.rotation.x = Math.PI / 2; tube.position.z = MID_Z;
    this.scene.add(tube);
    const cap = new THREE.MeshStandardMaterial({ color: 0xbabfc6, roughness: 0.95, side: THREE.DoubleSide });
    for (const z of [-1.6, (ROWS - 1) * ROW_PITCH + 1.6]) {
      const disc = new THREE.Mesh(new THREE.CircleGeometry(RADIUS, 48), cap);
      disc.scale.y = Y_SCALE; disc.position.z = z;
      this.scene.add(disc);
    }
  }

  #buildSeats() {
    const weave = makeWeaveMaps();
    for (const t of [weave.map, weave.normal, weave.rough]) t.repeat.set(5, 5);
    const fabric = new THREE.MeshPhysicalMaterial({
      color: 0x3a5a7a, map: weave.map, normalMap: weave.normal, roughnessMap: weave.rough,
      normalScale: new THREE.Vector2(0.6, 0.6), roughness: 1.0, metalness: 0.0, envMapIntensity: 0.4,
      sheen: 0.5, sheenRoughness: 0.8, sheenColor: new THREE.Color(0x7891ad),
    });
    const bolster = new THREE.MeshPhysicalMaterial({
      color: 0x2f5074, map: weave.map, normalMap: weave.normal, roughnessMap: weave.rough,
      normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1.0, metalness: 0.0, envMapIntensity: 0.35,
      sheen: 0.4, sheenRoughness: 0.85,
    });
    const cover = new THREE.MeshStandardMaterial({ color: 0xd9dee6, roughness: 0.55, envMapIntensity: 0.6 });
    const armMat = new THREE.MeshStandardMaterial({ color: 0x222a33, roughness: 0.45, metalness: 0.35, envMapIntensity: 0.95 });
    const trayMat = new THREE.MeshStandardMaterial({ color: 0x3a424c, roughness: 0.5, metalness: 0.25, envMapIntensity: 0.85 });
    const N = ROWS * COLS.length;

    const pan = new THREE.BoxGeometry(0.46, 0.14, 0.52); pan.translate(0, FLOOR_Y + 0.42, 0.0);
    const back = new THREE.BoxGeometry(0.42, 0.66, 0.14); back.translate(0, FLOOR_Y + 0.82, 0.2);
    const wingL = new THREE.BoxGeometry(0.05, 0.66, 0.2); wingL.translate(-0.215, FLOOR_Y + 0.82, 0.16);
    const wingR = wingL.clone(); wingR.translate(0.43, 0, 0);
    const head = new THREE.BoxGeometry(0.34, 0.22, 0.15); head.translate(0, FLOOR_Y + 1.2, 0.18);
    const tray = new THREE.BoxGeometry(0.34, 0.24, 0.03); tray.translate(0, FLOOR_Y + 0.6, BACK_FACE_Z);
    const arm = new THREE.BoxGeometry(0.07, 0.09, 0.44); arm.translate(0, FLOOR_Y + 0.52, 0.0);

    const IM = (geo, mat, n) => new THREE.InstancedMesh(geo, mat, n);
    const panIM = IM(pan, fabric, N), backIM = IM(back, fabric, N), headIM = IM(head, cover, N);
    const wingLIM = IM(wingL, bolster, N), wingRIM = IM(wingR, bolster, N);
    const trayIM = IM(tray, trayMat, N), armIM = IM(arm, armMat, N * 2);

    const m = new THREE.Matrix4();
    let i = 0, a = 0;
    for (let r = 1; r <= ROWS; r++) {
      for (const L of COLS) {
        const x = SEAT_X[L], z = rowZ(r);
        m.makeTranslation(x, 0, z);
        for (const im of [panIM, backIM, headIM, wingLIM, wingRIM, trayIM]) im.setMatrixAt(i, m);
        i++;
        m.makeTranslation(x - 0.26, 0, z); armIM.setMatrixAt(a++, m);
        m.makeTranslation(x + 0.26, 0, z); armIM.setMatrixAt(a++, m);
      }
    }
    // per-seat tone jitter + fake AO (pans darker) so the 180 seats stop looking cloned and flat
    const c = new THREE.Color();
    let j = 0;
    for (let r = 1; r <= ROWS; r++) for (const L of COLS) {
      const t = 0.86 + Math.random() * 0.12;
      panIM.setColorAt(j, c.setScalar(t * 0.86));
      backIM.setColorAt(j, c.setScalar(t));
      headIM.setColorAt(j, c.setScalar(0.9 + Math.random() * 0.1));
      wingLIM.setColorAt(j, c.setScalar(t * 0.9)); wingRIM.setColorAt(j, c.setScalar(t * 0.9));
      j++;
    }
    for (const im of [panIM, backIM, headIM, wingLIM, wingRIM]) im.instanceColor.needsUpdate = true;
    for (const im of [panIM, backIM, headIM, wingLIM, wingRIM, trayIM, armIM]) { im.instanceMatrix.needsUpdate = true; this.scene.add(im); }

    // soft contact shadows under every seat so nothing floats
    const shIM = new THREE.InstancedMesh(new THREE.PlaneGeometry(0.66, 0.66),
      new THREE.MeshBasicMaterial({ map: makeRadialShadow(), transparent: true, depthWrite: false, opacity: 0.55 }), N);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    const one = new THREE.Vector3(1, 1, 1), pos = new THREE.Vector3(), sm = new THREE.Matrix4();
    let s = 0;
    for (let r = 1; r <= ROWS; r++) for (const L of COLS) { pos.set(SEAT_X[L], FLOOR_Y + 0.02, rowZ(r) + 0.06); sm.compose(pos, q, one); shIM.setMatrixAt(s++, sm); }
    shIM.instanceMatrix.needsUpdate = true; shIM.renderOrder = 1;
    this.scene.add(shIM);
  }

  #buildScreens() {
    const geo = new THREE.PlaneGeometry(0.34, 0.212);
    this.screenIM = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: this.#ifeTexture() }), ROWS * COLS.length);
    const m = new THREE.Matrix4();
    let i = 0;
    for (let r = 1; r <= ROWS; r++) for (const L of COLS) { m.makeTranslation(SEAT_X[L], SCREEN_Y, rowZ(r) + BACK_FACE_Z + 0.006); this.screenIM.setMatrixAt(i++, m); }
    this.screenIM.instanceMatrix.needsUpdate = true;
    this.scene.add(this.screenIM);
    // front bulkhead wall so the front-row screen mounts on it instead of floating
    this._frontZ = rowZ(1) - 0.82;
    const bulk = new THREE.Mesh(new THREE.PlaneGeometry(RADIUS * 2, V_RADIUS * 2),
      new THREE.MeshStandardMaterial({ color: 0xc3c8cf, roughness: 0.85, metalness: 0.03, envMapIntensity: 0.4, side: THREE.DoubleSide }));
    bulk.position.set(0, 0, this._frontZ);
    this.scene.add(bulk);
    this.bulkIM = new THREE.InstancedMesh(geo, new THREE.MeshBasicMaterial({ map: this.screenIM.material.map }), COLS.length);
    COLS.forEach((L, k) => { m.makeTranslation(SEAT_X[L], SCREEN_Y, this._frontZ + 0.02); this.bulkIM.setMatrixAt(k, m); });
    this.bulkIM.instanceMatrix.needsUpdate = true;
    this.scene.add(this.bulkIM);
    // the live data screen (placed on the seat — or bulkhead — in front of you)
    this._dataCanvas = document.createElement('canvas'); this._dataCanvas.width = 512; this._dataCanvas.height = 320;
    this._dataTex = new THREE.CanvasTexture(this._dataCanvas); this._dataTex.colorSpace = THREE.SRGBColorSpace; this._dataTex.anisotropy = 4;
    this.dataScreen = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.212), new THREE.MeshBasicMaterial({ map: this._dataTex }));
    this.dataScreen.visible = false;
    this.scene.add(this.dataScreen);
    this.#drawData();
  }

  #ifeTexture() {
    const cv = document.createElement('canvas'); cv.width = 512; cv.height = 320;
    const x = cv.getContext('2d');
    const bg = x.createLinearGradient(0, 0, 0, 320); bg.addColorStop(0, '#0d1e33'); bg.addColorStop(1, '#0a1220');
    x.fillStyle = bg; x.fillRect(0, 0, 512, 320);
    x.textBaseline = 'top';
    x.font = 'bold 30px sans-serif'; x.fillStyle = '#eef4fb'; x.fillText('Focus', 28, 22);
    const fw = x.measureText('Focus').width; x.fillStyle = '#6fb0dd'; x.fillText('Air', 28 + fw, 22);
    x.font = '12px sans-serif'; x.fillStyle = '#8298b0'; x.fillText('E N T E R T A I N M E N T', 30, 58);
    x.fillStyle = 'rgba(111,176,221,0.4)'; x.fillRect(28, 80, 456, 2);
    // featured hero
    const hg = x.createLinearGradient(28, 94, 278, 244); hg.addColorStop(0, '#315984'); hg.addColorStop(1, '#a5472f');
    cvRR(x, 28, 94, 250, 150, 12); x.fillStyle = hg; x.fill();
    x.fillStyle = 'rgba(255,255,255,0.9)'; x.beginPath(); x.moveTo(142, 150); x.lineTo(142, 188); x.lineTo(174, 169); x.closePath(); x.fill();
    x.fillStyle = '#cfe0f0'; x.font = '11px sans-serif'; x.fillText('FEATURED · ACTION', 44, 205);
    x.fillStyle = '#ffffff'; x.font = 'bold 22px sans-serif'; x.fillText('Skyfall', 44, 219);
    // poster grid
    const tiles = [['#3f6fbf', '#1b3a63', 'The Deep'], ['#4d8a5b', '#27502f', 'Wildlands'], ['#8a5aa8', '#3c2a55', 'Nova Bright'], ['#caa03f', '#5f4712', 'Dune Sea']];
    tiles.forEach((t, i) => {
      const tx = 298 + (i % 2) * 104, ty = 94 + ((i / 2) | 0) * 82;
      const gr = x.createLinearGradient(tx, ty, tx, ty + 58); gr.addColorStop(0, t[0]); gr.addColorStop(1, t[1]);
      cvRR(x, tx, ty, 96, 58, 8); x.fillStyle = gr; x.fill();
      x.fillStyle = '#d5e0ee'; x.font = '11px sans-serif'; x.fillText(t[2], tx + 2, ty + 62);
    });
    x.fillStyle = '#8298b0'; x.font = '13px sans-serif'; x.fillText('Tap a title to start watching', 28, 296);
    const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    return tex;
  }

  #drawData() {
    const d = this._data || {};
    const cv = this._dataCanvas, x = cv.getContext('2d'), W = cv.width, H = cv.height;
    const bg = x.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#0a1a2e'); bg.addColorStop(1, '#0c2138');
    x.fillStyle = bg; x.fillRect(0, 0, W, H);
    x.fillStyle = '#6fb0dd'; x.fillRect(0, 0, W, 4); // top accent
    x.textBaseline = 'top';
    x.fillStyle = '#eef4fb'; x.font = 'bold 40px sans-serif'; x.fillText(d.route || 'In flight', 26, 22);
    x.fillStyle = '#7f95ad'; x.font = '15px sans-serif'; x.fillText(d.flightNo || '', 28, 70);
    // status pill (top-right)
    const st = (d.status || '').toUpperCase();
    if (st) {
      x.font = 'bold 12px sans-serif'; const pw = x.measureText(st).width + 22;
      cvRR(x, W - 26 - pw, 30, pw, 24, 12); x.fillStyle = 'rgba(111,176,221,0.16)'; x.fill();
      x.fillStyle = '#8fc0e4'; x.fillText(st, W - 26 - pw + 11, 36);
    }
    // progress bar with a little plane
    const bx = 28, by = 104, bw = W - 56, bh = 8, pf = Math.max(0, Math.min(1, d.progress || 0));
    x.fillStyle = 'rgba(255,255,255,0.13)'; cvRR(x, bx, by, bw, bh, 4); x.fill();
    x.fillStyle = '#6fb0dd'; cvRR(x, bx, by, Math.max(bh, bw * pf), bh, 4); x.fill();
    x.fillStyle = '#eef4fb'; x.save(); x.translate(bx + bw * pf, by + bh / 2); x.beginPath();
    x.moveTo(9, 0); x.lineTo(-7, -6); x.lineTo(-3, 0); x.lineTo(-7, 6); x.closePath(); x.fill(); x.restore();
    // stat cards, 2x2
    const cells = [['TIME TO GO', d.remaining || '—'], ['ALTITUDE', d.alt || '—'], ['ARRIVAL', `${d.eta || '—'} ${d.etaZone || ''}`.trim()], ['TIMER', d.timer || '—']];
    const cw = (W - 56 - 16) / 2, ch = 76, gx = 28, gy = 138;
    cells.forEach((c, i) => {
      const cx = gx + (i % 2) * (cw + 16), cy = gy + ((i / 2) | 0) * (ch + 14);
      cvRR(x, cx, cy, cw, ch, 10); x.fillStyle = 'rgba(255,255,255,0.045)'; x.fill();
      x.fillStyle = '#7f95ad'; x.font = '14px sans-serif'; x.fillText(c[0], cx + 16, cy + 14);
      x.fillStyle = '#eef4fb'; x.font = 'bold 30px sans-serif'; x.fillText(c[1], cx + 16, cy + 34);
    });
    if (this._dataTex) this._dataTex.needsUpdate = true;
  }

  #buildWindows() {
    const skyMat = new THREE.ShaderMaterial({ uniforms: this.sky, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.FrontSide });
    const trim = new THREE.MeshStandardMaterial({ color: 0xd0d4da, roughness: 0.7, metalness: 0.1, envMapIntensity: 0.6, side: THREE.DoubleSide });
    const winGeo = new THREE.ShapeGeometry(rrShape(0.13, 0.19, 0.115)); // tall, heavily-rounded oval window
    const frameShape = rrShape(0.165, 0.225, 0.15); frameShape.holes.push(rrHole(0.134, 0.194, 0.118));
    const frameIM = new THREE.InstancedMesh(new THREE.ShapeGeometry(frameShape), trim, ROWS * 2);
    const dummy = new THREE.Object3D();
    const ex = ellipseX(WIN_Y);
    let k = 0;
    for (let r = 1; r <= ROWS; r++) {
      for (const side of [-1, 1]) {
        const z = rowZ(r);
        const win = new THREE.Mesh(winGeo, skyMat);
        win.position.set((ex - 0.02) * side, WIN_Y, z); win.lookAt(0, WIN_Y, z);
        this.scene.add(win);
        dummy.position.set((ex - 0.03) * side, WIN_Y, z); dummy.lookAt(0, WIN_Y, z); dummy.updateMatrix();
        frameIM.setMatrixAt(k++, dummy.matrix);
      }
    }
    frameIM.instanceMatrix.needsUpdate = true;
    this.scene.add(frameIM);
  }

  #buildFurniture() {
    const pm = makePanelMaps(); pm.map.repeat.set(2, 34); pm.normal.repeat.set(2, 34);
    const panel = new THREE.MeshStandardMaterial({ color: 0xffffff, map: pm.map, normalMap: pm.normal, normalScale: new THREE.Vector2(0.3, 0.3), roughness: 0.82, envMapIntensity: 0.45 });
    const cm = makeCarpetMaps(); cm.map.repeat.set(6, 46); cm.normal.repeat.set(6, 46);
    const carpet = new THREE.MeshStandardMaterial({ color: 0xffffff, map: cm.map, normalMap: cm.normal, normalScale: new THREE.Vector2(0.5, 0.5), roughness: 1, envMapIntensity: 0.15 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(RADIUS * 2, CABIN_LEN), carpet);
    floor.rotation.x = -Math.PI / 2; floor.position.set(0, FLOOR_Y + 0.001, MID_Z);
    this.scene.add(floor);
    for (const side of [-1, 1]) {
      const bin = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.4, CABIN_LEN), panel);
      bin.position.set(side * 1.24, 0.86, MID_Z); bin.rotation.z = side * -0.32;
      this.scene.add(bin);
    }
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.03, CABIN_LEN),
      new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xe6eef7, emissiveIntensity: 0.9, roughness: 1 }));
    strip.position.set(0, V_RADIUS - 0.06, MID_Z);
    this.scene.add(strip);
  }

  #buildLights() {
    this.scene.add(new THREE.HemisphereLight(0xe4f1ff, 0x33383f, 0.85)); // retuned down for ACES + env light
    const sun = new THREE.DirectionalLight(0xfff3e2, 1.05); sun.position.set(1.0, 0.8, -0.5); this.scene.add(sun);
    const fill = new THREE.DirectionalLight(0xcdddef, 0.4); fill.position.set(-0.6, 0.4, 1.2); this.scene.add(fill);
    this.scene.add(new THREE.AmbientLight(0x515964, 0.45));
  }

  #buildOverlay() {
    const back = document.createElement('button');
    back.className = 'cabin-exit glass';
    back.innerHTML = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><circle cx="10" cy="10" r="7.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M2.5 10h15M10 2.5a11 11 0 0 1 0 15M10 2.5a11 11 0 0 0 0 15" fill="none" stroke="currentColor" stroke-width="1.1"/></svg><span>Earth view</span>';
    back.addEventListener('pointerdown', (e) => e.stopPropagation());
    back.addEventListener('click', () => this.onExit && this.onExit());
    this.container.appendChild(back);
    // "Window view" — swing the gaze to frame the window on your side
    const look = document.createElement('button');
    look.className = 'cabin-look glass';
    look.innerHTML = '<svg viewBox="0 0 20 20" width="15" height="15" aria-hidden="true"><rect x="5.5" y="2.5" width="9" height="15" rx="4.5" fill="none" stroke="currentColor" stroke-width="1.3"/><path d="M6.6 12.2c1.9-2.4 5-2.4 6.9 0" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="13" cy="6.6" r="1.5" fill="currentColor"/></svg><span>Window view</span>';
    look.addEventListener('pointerdown', (e) => e.stopPropagation());
    look.addEventListener('click', () => this.lookOutWindow());
    this.container.appendChild(look);
    this.tag = document.createElement('span');
    this.tag.className = 'cabin-tag glass';
    this.container.appendChild(this.tag);
  }

  #bindDrag() {
    let down = false, px = 0, py = 0;
    const el = this.container;
    el.addEventListener('pointerdown', (e) => { down = true; px = e.clientX; py = e.clientY; try { el.setPointerCapture(e.pointerId); } catch (_) {} });
    el.addEventListener('pointermove', (e) => {
      if (!down) return;
      // "grab the world" feel: drag left → look right (reverse of look-style controls)
      this.tYaw = THREE.MathUtils.clamp(this.tYaw + (e.clientX - px) * 0.0038, -3.1, 3.1);
      this.tPitch = THREE.MathUtils.clamp(this.tPitch + (e.clientY - py) * 0.0038, -0.85, 0.9);
      px = e.clientX; py = e.clientY;
    });
    const up = () => { down = false; };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up);
  }

  #resize() {
    const w = this.container.clientWidth || window.innerWidth, h = this.container.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  #render() {
    this.camera.quaternion.setFromEuler(new THREE.Euler(this.pitch, this.yaw, 0, 'YXZ'));
    this.renderer.render(this.scene, this.camera);
  }

  _loop() {
    if (!this.active) { this.raf = 0; return; }
    this.raf = requestAnimationFrame(this._loop);
    this.sky.uTime.value = (performance.now() - this.t0) / 1000;
    this.yaw += (this.tYaw - this.yaw) * 0.08;   // gentler easing = smoother look-around
    this.pitch += (this.tPitch - this.pitch) * 0.08;
    this.#render();
  }

  setFlightData(d) { this._data = d; if (this.ready) this.#drawData(); }

  // aim the gaze straight at your window so it fills the frame (eased in _loop)
  lookOutWindow() {
    if (!this._winTarget) return;
    const p = this.camera.position, t = this._winTarget;
    const dx = t.x - p.x, dy = t.y - p.y, dz = t.z - p.z;
    const len = Math.hypot(dx, dy, dz) || 1;
    this.tYaw = THREE.MathUtils.clamp(Math.atan2(-dx, -dz), -3.1, 3.1);
    this.tPitch = THREE.MathUtils.clamp(Math.asin(dy / len), -0.85, 0.9);
  }

  // put the live data screen on the seat ahead of you, and hide that seat's generic screen
  #placeDataScreen(row, L) {
    if (this._hidden) { this._hidden.im.setMatrixAt(this._hidden.idx, this._hidden.mtx); this._hidden.im.instanceMatrix.needsUpdate = true; this._hidden = null; }
    const ci = COLS.indexOf(L);
    if (row <= 1) {
      // front row: the seat ahead is the bulkhead, so mount the data screen on it
      this.dataScreen.position.set(SEAT_X[L], SCREEN_Y, this._frontZ + 0.03);
      this.#hideScreen(this.bulkIM, ci);
    } else {
      this.dataScreen.position.set(SEAT_X[L], SCREEN_Y, rowZ(row) - ROW_PITCH + BACK_FACE_Z + 0.008);
      this.#hideScreen(this.screenIM, (row - 2) * COLS.length + ci);
    }
    this.dataScreen.visible = true;
  }
  #hideScreen(im, idx) {
    const mtx = new THREE.Matrix4();
    im.getMatrixAt(idx, mtx);
    this._hidden = { im, idx, mtx };
    im.setMatrixAt(idx, new THREE.Matrix4().makeScale(0, 0, 0));
    im.instanceMatrix.needsUpdate = true;
  }

  // seat is e.g. "14A" — place the eye at that seat and look out toward its window
  enter(seat = '14A') {
    this.#init();
    this.container.hidden = false;
    const mt = String(seat).match(/^(\d+)\s*([A-Fa-f])/);
    let row = mt ? parseInt(mt[1], 10) : 14;
    let L = mt ? mt[2].toUpperCase() : 'A';
    row = Math.min(ROWS, Math.max(1, row));
    if (SEAT_X[L] === undefined) L = 'A';
    const windowLeft = L === 'A' || L === 'B' || L === 'C';
    this.camera.position.set(SEAT_X[L], EYE_Y, rowZ(row) - 0.05);
    // the window on your side of the fuselage — the "Window view" button aims here
    this._winTarget = new THREE.Vector3((ellipseX(WIN_Y) - 0.02) * (windowLeft ? -1 : 1), WIN_Y, rowZ(row));
    this.yaw = this.tYaw = windowLeft ? 0.5 : -0.5;
    this.pitch = this.tPitch = -0.02;
    this.tag.textContent = `Seat ${row}${L} · drag to look around`;
    this.#placeDataScreen(row, L);
    this.active = true;
    this.t0 = performance.now();
    this.#resize(); this.#render();
    if (!this.raf) this.raf = requestAnimationFrame(this._loop);
  }

  exit() {
    this.active = false;
    if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; }
    this.container.hidden = true;
  }

  renderView(yaw = 0, pitch = 0, t = 6) { this.#init(); this.sky.uTime.value = t; this.yaw = this.tYaw = yaw; this.pitch = this.tPitch = pitch; this.#render(); }
}
