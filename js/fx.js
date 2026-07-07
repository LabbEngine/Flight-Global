// Small shared visual helpers.
import * as THREE from '../vendor/three/three.module.js';

// Soft radial glow texture in a given color, for sprites and particles.
export function makeGlowTexture(hex, inner = '#ffffff') {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const ctx = c.getContext('2d');
  const col = new THREE.Color(hex);
  const rgb = `${Math.round(col.r * 255)},${Math.round(col.g * 255)},${Math.round(col.b * 255)}`;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, inner);
  g.addColorStop(0.18, `rgba(${rgb},0.85)`);
  g.addColorStop(0.5, `rgba(${rgb},0.22)`);
  g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 128, 128);
  return new THREE.CanvasTexture(c);
}

export function makeGlowSprite(hex, scale) {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
    map: makeGlowTexture(hex), transparent: true, depthWrite: false,
    blending: THREE.AdditiveBlending,
  }));
  sprite.scale.setScalar(scale);
  return sprite;
}

// Project a world position to CSS pixels. Returns null when behind the camera.
const _v = new THREE.Vector3();
export function worldToScreen(pos, camera, width, height) {
  _v.copy(pos).project(camera);
  if (_v.z > 1) return null;
  return { x: (_v.x * 0.5 + 0.5) * width, y: (-_v.y * 0.5 + 0.5) * height };
}

// Is a point on/near the globe surface facing the camera (not over the horizon)?
export function facesCamera(pos, camera, margin = 0.02) {
  const camDist = camera.position.length();
  const horizon = 1 / camDist; // cos of the angle to the horizon for r=1
  const d = pos.clone().normalize().dot(camera.position.clone().normalize());
  return d > horizon - margin;
}

export function disposeObject(root) {
  root.traverse((o) => {
    o.geometry?.dispose();
    const mats = Array.isArray(o.material) ? o.material : o.material ? [o.material] : [];
    for (const m of mats) { m.map?.dispose(); m.dispose(); }
  });
  root.parent?.remove(root);
}
