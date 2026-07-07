// The centerpiece: Earth with a real-time day/night terminator, city lights,
// drifting clouds, an atmospheric halo, and a procedural star field.
import * as THREE from '../vendor/three/three.module.js';
import { latLngToVec3, subsolarPoint } from './geo.js';

const EARTH_VERT = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;
  void main() {
    vUv = uv;
    vNormal = normalize(mat3(modelMatrix) * normal);
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorldPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const EARTH_FRAG = /* glsl */ `
  uniform sampler2D dayMap;
  uniform sampler2D detailMap;
  uniform float detailAmt;
  uniform float uBrightness;
  uniform float uDaylit;
  uniform vec3 sunDir;
  varying vec2 vUv;
  varying vec3 vNormal;
  varying vec3 vWorldPos;

  void main() {
    vec3 n = normalize(vNormal);
    vec3 viewDir = normalize(cameraPosition - vWorldPos);
    vec3 day = texture2D(dayMap, vUv).rgb;
    // Fight magnification blur when zoomed in: an unsharp mask sharpens the
    // real texture (coastlines, terrain), and a touch of fine procedural
    // grain fills in below the texel scale.
    if (detailAmt > 0.001) {
      vec2 texel = vec2(1.0 / 8192.0, 1.0 / 4096.0);
      vec3 dBlur = (
        texture2D(dayMap, vUv + vec2(texel.x, 0.0)).rgb +
        texture2D(dayMap, vUv - vec2(texel.x, 0.0)).rgb +
        texture2D(dayMap, vUv + vec2(0.0, texel.y)).rgb +
        texture2D(dayMap, vUv - vec2(0.0, texel.y)).rgb) * 0.25;
      day = clamp(day + (day - dBlur) * detailAmt * 1.6, 0.0, 1.0);
      float d1 = texture2D(detailMap, vUv * vec2(340.0, 170.0)).r;
      float d2 = texture2D(detailMap, vUv * vec2(96.0, 48.0)).g;
      float det = d1 * 0.6 + d2 * 0.4;
      day *= mix(1.0, 0.86 + 0.28 * det, detailAmt);
    }

    float sunDot = dot(n, sunDir);
    float dayF = smoothstep(-0.15, 0.25, sunDot);

    vec3 dayLit = day * (0.28 + 0.85 * clamp(sunDot, 0.0, 1.0));
    vec3 col = mix(day * 0.05, dayLit, dayF); // real-sun shading (overridden while daylit)

    // warm band along the terminator (real day/night only)
    float twilight = smoothstep(-0.22, 0.02, sunDot) * (1.0 - smoothstep(0.02, 0.3, sunDot));
    col += vec3(0.55, 0.22, 0.06) * twilight * 0.22;

    // fully-daylit override: day texture, evenly lit everywhere so the flight's
    // dimming reads clearly against a bright globe
    vec3 flatDay = day * (0.95 + 0.12 * (sunDot * 0.5 + 0.5));
    col = mix(col, flatDay, uDaylit);
    float dayMask = mix(dayF, 1.0, uDaylit);

    // sun glint on water (oceans are the blue-dominant pixels)
    float water = smoothstep(0.04, 0.18, day.b - day.r);
    float spec = pow(clamp(dot(reflect(-sunDir, n), viewDir), 0.0, 1.0), 28.0);
    col += vec3(1.0, 0.93, 0.8) * spec * water * dayMask * 0.55;

    // atmosphere hugging the limb
    float fres = pow(1.0 - clamp(dot(n, viewDir), 0.0, 1.0), 2.8);
    col += vec3(0.28, 0.52, 0.95) * fres * (0.18 + 0.5 * dayMask);

    gl_FragColor = vec4(col * uBrightness, 1.0);
  }
`;

const HALO_VERT = /* glsl */ `
  varying vec3 vNormalV;
  varying vec3 vNormalW;
  void main() {
    vNormalV = normalize(normalMatrix * normal);
    vNormalW = normalize(mat3(modelMatrix) * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const HALO_FRAG = /* glsl */ `
  uniform vec3 sunDir;
  uniform float uBrightness;
  varying vec3 vNormalV;
  varying vec3 vNormalW;
  void main() {
    float rim = pow(0.68 - dot(vNormalV, vec3(0.0, 0.0, 1.0)), 3.5);
    float lit = 0.25 + 0.75 * smoothstep(-0.4, 0.4, dot(vNormalW, sunDir));
    vec3 col = mix(vec3(0.1, 0.3, 0.75), vec3(0.35, 0.62, 1.0), lit);
    gl_FragColor = vec4(col * rim * lit * uBrightness, 1.0);
  }
`;

// Tiling value-noise texture used for close-zoom terrain grain.
// Procedural, so the "single 8K texture" contract stays intact.
function makeDetailTexture() {
  const size = 512;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const rand = new Float32Array(64 * 64);
  for (let i = 0; i < rand.length; i++) rand[i] = Math.random();
  const sample = (x, y, freq) => {
    const fx = (x / size) * freq, fy = (y / size) * freq;
    const x0 = Math.floor(fx) % 64, y0 = Math.floor(fy) % 64;
    const x1 = (x0 + 1) % 64, y1 = (y0 + 1) % 64;
    const tx = fx - Math.floor(fx), ty = fy - Math.floor(fy);
    const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
    const a = rand[y0 * 64 + x0], b = rand[y0 * 64 + x1];
    const d = rand[y1 * 64 + x0], e = rand[y1 * 64 + x1];
    return a + (b - a) * sx + (d - a) * sy + (a - b - d + e) * sx * sy;
  };
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const r = sample(x, y, 10) * 0.42 + sample(x, y, 22) * 0.32 + sample(x, y, 46) * 0.26;
      const g = sample(x, y, 5) * 0.6 + sample(x, y, 15) * 0.4;
      const i = (y * size + x) * 4;
      img.data[i] = r * 255;
      img.data[i + 1] = g * 255;
      img.data[i + 2] = 0;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

function makeStarTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d');
  const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.9)');
  g.addColorStop(0.6, 'rgba(255,255,255,0.12)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

function makeStars() {
  const group = new THREE.Group();
  const sprite = makeStarTexture();
  const palettes = [
    [0.62, 0.02, 8000], // small dim stars: size, opacity share, count
    [1.35, 0.05, 1400],
    [2.6, 0.1, 180],
  ];
  for (const [size, , count] of palettes) {
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(52 + Math.random() * 6);
      pos.set([v.x, v.y, v.z], i * 3);
      // mostly white, a few warm and cool stars
      const t = Math.random();
      const c = t < 0.75 ? [1, 1, 1] : t < 0.88 ? [1, 0.82, 0.62] : [0.65, 0.78, 1];
      const dim = 0.45 + Math.random() * 0.55;
      col.set([c[0] * dim, c[1] * dim, c[2] * dim], i * 3);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.PointsMaterial({
      size, map: sprite, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true,
    });
    group.add(new THREE.Points(geo, mat));
  }
  return group;
}

export function buildGlobe(scene, textures, maxAnisotropy) {
  textures.day.anisotropy = maxAnisotropy;
  textures.day.colorSpace = THREE.NoColorSpace;

  const earthGeo = new THREE.SphereGeometry(1, 128, 128);
  const uniforms = {
    dayMap: { value: textures.day },
    detailMap: { value: makeDetailTexture() },
    detailAmt: { value: 0 },
    uBrightness: { value: 1 },
    uDaylit: { value: 1 }, // globe is fully daylit so the flight dimming is visible
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
  };
  const earth = new THREE.Mesh(
    earthGeo,
    new THREE.ShaderMaterial({ uniforms, vertexShader: EARTH_VERT, fragmentShader: EARTH_FRAG })
  );
  scene.add(earth);

  // clouds: the texture is white-on-black, so it doubles as its own alpha
  textures.clouds.anisotropy = Math.min(4, maxAnisotropy);
  const clouds = new THREE.Mesh(
    new THREE.SphereGeometry(1.008, 96, 96),
    new THREE.MeshLambertMaterial({
      color: 0xffffff, alphaMap: textures.clouds, transparent: true,
      opacity: 0.75, depthWrite: false,
    })
  );
  scene.add(clouds);

  const halo = new THREE.Mesh(
    new THREE.SphereGeometry(1.045, 96, 96),
    new THREE.ShaderMaterial({
      uniforms: { sunDir: uniforms.sunDir, uBrightness: uniforms.uBrightness },
      vertexShader: HALO_VERT, fragmentShader: HALO_FRAG,
      side: THREE.BackSide, blending: THREE.AdditiveBlending,
      transparent: true, depthWrite: false,
    })
  );
  scene.add(halo);

  scene.add(makeStars());

  // sun + ambient light the clouds and any standard materials (pins, plane).
  // With the globe fully daylit, ambient carries most of the scene so clouds
  // and the aircraft read evenly on every side.
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.3);
  scene.add(sun);
  scene.add(new THREE.AmbientLight(0x99a6bd, 0.95));

  function setSun(date) {
    const sp = subsolarPoint(date);
    const dir = latLngToVec3(sp.lat, sp.lng, 1).normalize();
    uniforms.sunDir.value.copy(dir);
    sun.position.copy(dir.clone().multiplyScalar(10));
  }
  setSun(new Date());

  let sunTimer = 0;
  return {
    earth, clouds,
    setSun,
    // Tween the whole globe's brightness (used to dim the map once a flight starts).
    setBrightness(v, dur = 1) {
      gsap.to(uniforms.uBrightness, { value: v, duration: dur, overwrite: true, ease: 'power2.inOut' });
    },
    update(dt, altitude = 2) {
      clouds.rotation.y += dt * 0.004;
      // descend below the cloud deck: clouds fade out, terrain grain fades in
      clouds.material.opacity = 0.75 * THREE.MathUtils.smoothstep(altitude, 0.05, 0.17) * uniforms.uBrightness.value;
      clouds.visible = clouds.material.opacity > 0.01;
      uniforms.detailAmt.value = 0.8 * (1 - THREE.MathUtils.smoothstep(altitude, 0.03, 0.65));
      sunTimer += dt;
      if (sunTimer > 30) { // terminator creeps in real time
        sunTimer = 0;
        setSun(new Date());
      }
    },
  };
}
