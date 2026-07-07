// The centerpiece: a plain backdrop sphere (the satellite tile layer in tiles.js
// is the real surface), drifting clouds, an atmospheric halo, and a star field.
import * as THREE from '../vendor/three/three.module.js';
import { latLngToVec3, subsolarPoint } from './geo.js';

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
  const earthGeo = new THREE.SphereGeometry(1, 128, 128);
  const uniforms = {
    uBrightness: { value: 1 },
    sunDir: { value: new THREE.Vector3(1, 0, 0) },
  };
  // No baked Earth texture — the satellite tile layer is the only surface. This
  // plain sphere is just a backdrop for the poles and the first-load frame.
  const earth = new THREE.Mesh(earthGeo, new THREE.MeshBasicMaterial({ color: 0x0e2136 }));
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
    get brightness() { return uniforms.uBrightness.value; },
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
      sunTimer += dt;
      if (sunTimer > 30) { // terminator creeps in real time
        sunTimer = 0;
        setSun(new Date());
      }
    },
  };
}
