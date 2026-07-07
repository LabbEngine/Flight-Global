// Spherical math shared by every module. The globe has radius 1 in scene units.
import * as THREE from '../vendor/three/three.module.js';

export const EARTH_RADIUS_KM = 6371;
export const DEG = Math.PI / 180;

// Maps lat/lng to a point on the sphere, matching how an equirectangular
// texture wraps a three.js SphereGeometry.
export function latLngToVec3(lat, lng, r = 1) {
  const phi = (90 - lat) * DEG;
  const theta = (lng + 180) * DEG;
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
    r * Math.cos(phi),
    r * Math.sin(phi) * Math.sin(theta)
  );
}

export function vec3ToLatLng(v) {
  const r = v.length() || 1;
  const lat = 90 - Math.acos(THREE.MathUtils.clamp(v.y / r, -1, 1)) / DEG;
  let lng = Math.atan2(v.z, -v.x) / DEG - 180;
  if (lng < -180) lng += 360;
  if (lng > 180) lng -= 360;
  return { lat, lng };
}

export function haversineKm(a, b) {
  const dLat = (b.lat - a.lat) * DEG;
  const dLng = (b.lng - a.lng) * DEG;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a.lat * DEG) * Math.cos(b.lat * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function angularDistance(a, b) {
  return haversineKm(a, b) / EARTH_RADIUS_KM;
}

// Exact great-circle curve between two surface points, lifted above the
// surface with a sine profile so routes arc over the planet.
export class GreatCircleCurve extends THREE.Curve {
  constructor(fromLatLng, toLatLng, altitude) {
    super();
    this.a = latLngToVec3(fromLatLng.lat, fromLatLng.lng, 1);
    this.b = latLngToVec3(toLatLng.lat, toLatLng.lng, 1);
    this.alt = altitude;
    this.theta = this.a.angleTo(this.b);
    // Antipodal points have no unique great circle - nudge one end a hair.
    if (this.theta > Math.PI - 0.005) {
      this.b = latLngToVec3(toLatLng.lat + 0.25, toLatLng.lng, 1);
      this.theta = this.a.angleTo(this.b);
    }
  }
  getPoint(t, target = new THREE.Vector3()) {
    const { a, b, theta } = this;
    if (theta < 1e-8) return target.copy(a);
    const sinT = Math.sin(theta);
    const w1 = Math.sin((1 - t) * theta) / sinT;
    const w2 = Math.sin(t * theta) / sinT;
    target.set(
      a.x * w1 + b.x * w2,
      a.y * w1 + b.y * w2,
      a.z * w1 + b.z * w2
    ).normalize();
    return target.multiplyScalar(1 + this.alt * Math.sin(Math.PI * t));
  }
}

// A pleasing arc height: longer routes fly higher.
export function arcAltitude(angular) {
  return 0.012 + angular * 0.075;
}

// Where the sun is directly overhead right now. Declination approximation
// is within ~1 degree, plenty for lighting.
export function subsolarPoint(date) {
  const start = Date.UTC(date.getUTCFullYear(), 0, 0);
  const doy = (date.getTime() - start) / 86400000;
  const lat = -23.44 * Math.cos((2 * Math.PI * (doy + 10)) / 365.24);
  const utcHours =
    date.getUTCHours() + date.getUTCMinutes() / 60 + date.getUTCSeconds() / 3600;
  let lng = 180 - utcHours * 15;
  lng = ((lng + 540) % 360) - 180;
  return { lat, lng };
}

export function formatLatLng(lat, lng) {
  const ns = lat >= 0 ? 'N' : 'S';
  const ew = lng >= 0 ? 'E' : 'W';
  return `${Math.abs(lat).toFixed(2)}°${ns} ${Math.abs(lng).toFixed(2)}°${ew}`;
}

// Ray/sphere intersection (sphere at origin). Returns the hit point or null.
export function raySphere(origin, dir, radius = 1) {
  const b = origin.dot(dir);
  const c = origin.dot(origin) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  if (t < 0) return null;
  return origin.clone().addScaledVector(dir, t);
}
