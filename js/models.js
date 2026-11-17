// Procedural vehicle and roadside models. Car local axes: +X right, +Y up, +Z forward.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { mulberry32 } from './config.js';
import { makePlateTexture, makeShadowTexture } from './textures.js';

// ---------------------------------------------------------------- geometry helpers
function clean(g) {
  g = g.index ? g.toNonIndexed() : g;
  for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) g.deleteAttribute(k);
  if (!g.attributes.normal) g.computeVertexNormals();
  if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
  g.clearGroups();
  return g;
}
function merge(list) {
  const arr = list.filter(Boolean).map(clean);
  const hasColor = arr.some(g => g.attributes.color);
  if (hasColor) for (const g of arr) if (!g.attributes.color) g.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 3).fill(1), 3));
  return arr.length ? mergeGeometries(arr, false) : null;
}
function box(w, h, d, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z); return g;
}
function cyl(r1, r2, h, seg, x, y, z, rx = 0, ry = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(r1, r2, h, seg);
  if (rx || ry || rz) g.applyMatrix4(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(rx, ry, rz)));
  g.translate(x, y, z); return g;
}
// Extrude a side profile (shape x = length along +Z, y = height) across the car width.
function extrudeSide(shape, width, bt, bs, segs = 3, curveSegs = 10) {
  const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.01, width - 2 * bt), bevelEnabled: true, bevelThickness: bt, bevelSize: bs, bevelSegments: segs, curveSegments: curveSegs, steps: 1 });
  g.translate(0, 0, bt); g.rotateY(-Math.PI / 2); g.translate(width / 2, 0, 0);
  return g;
}
function colorize(g, c) {
  const col = new THREE.Color(c), n = g.attributes.position.count, a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { a[i * 3] = col.r; a[i * 3 + 1] = col.g; a[i * 3 + 2] = col.b; }
  g.setAttribute('color', new THREE.BufferAttribute(a, 3)); return g;
}
function jitter(g, amt, seed) {
  g = g.index ? g.toNonIndexed() : g;
  // displace shared positions consistently so faces stay closed
  const p = g.attributes.position, r = mulberry32(seed), map = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!map.has(key)) map.set(key, [(r() - 0.5) * amt, (r() - 0.5) * amt, (r() - 0.5) * amt]);
    const o = map.get(key); p.setXYZ(i, p.getX(i) + o[0], p.getY(i) + o[1], p.getZ(i) + o[2]);
  }
  g.computeVertexNormals(); return g;
}

// ---------------------------------------------------------------- vehicles
export const PROFILES = {
  sedan:  { L:4.72, W:1.84, wr:0.33, wb:1.42, clr:0.20, noseH:0.64, tailH:0.88, beltF:0.93, beltR:1.00, cabF:0.95, cabR:-1.15, roofF:0.28, roofR:-0.55, roofH:1.44 },
  hatch:  { L:4.15, W:1.78, wr:0.31, wb:1.27, clr:0.18, noseH:0.66, tailH:0.98, beltF:0.92, beltR:1.00, cabF:0.80, cabR:-1.86, roofF:0.12, roofR:-1.62, roofH:1.47 },
  suv:    { L:4.75, W:1.93, wr:0.38, wb:1.43, clr:0.28, noseH:0.86, tailH:1.08, beltF:1.12, beltR:1.16, cabF:0.92, cabR:-2.12, roofF:0.25, roofR:-1.98, roofH:1.76 },
  van:    { L:5.05, W:1.99, wr:0.34, wb:1.62, clr:0.22, noseH:0.86, tailH:1.25, beltF:1.12, beltR:1.15, cabF:1.60, cabR:-2.18, roofF:1.05, roofR:-2.1, roofH:2.08 },
  coupe:  { L:4.55, W:1.84, wr:0.33, wb:1.38, clr:0.15, noseH:0.58, tailH:0.86, beltF:0.86, beltR:0.95, cabF:0.75, cabR:-1.35, roofF:0.00, roofR:-0.62, roofH:1.30 },
  muscle: { L:4.85, W:1.92, wr:0.35, wb:1.48, clr:0.16, noseH:0.72, tailH:0.88, beltF:0.93, beltR:0.98, cabF:0.55, cabR:-1.75, roofF:-0.15, roofR:-0.78, roofH:1.33 },
  super:  { L:4.55, W:1.98, wr:0.34, wb:1.36, clr:0.12, noseH:0.46, tailH:0.82, beltF:0.80, beltR:0.92, cabF:1.00, cabR:-1.05, roofF:0.05, roofR:-0.58, roofH:1.15 },
  hyper:  { L:4.70, W:2.02, wr:0.35, wb:1.42, clr:0.10, noseH:0.40, tailH:0.86, beltF:0.74, beltR:0.90, cabF:1.15, cabR:-0.95, roofF:0.10, roofR:-0.50, roofH:1.10 },
};

function bodyShape(p, cut) {
  const { L, wr, wb, clr, noseH, tailH, beltF, beltR, cabF, cabR } = p;
  const s = new THREE.Shape();
  const R = wr + 0.07, a0 = Math.asin(Math.max(-1, Math.min(1, (clr - wr) / R)));
  s.moveTo(-L / 2 + 0.06, clr);
  s.lineTo(-L / 2 - 0.02, clr + 0.22);
  s.lineTo(-L / 2, tailH - 0.05);
  s.quadraticCurveTo(-L / 2 + 0.02, beltR, -L / 2 + 0.16, beltR);
  s.lineTo(cabR, beltR);
  if (cut) {   // open cabin tub for the player's own car (so the interior isn't filled in)
    const floor = clr + 0.32;
    s.lineTo(cabR + 0.04, floor); s.lineTo(cabF - 0.08, floor);
  }
  s.lineTo(cabF, beltF);
  const hoodMid = cabF + (L / 2 - cabF) * 0.55;
  s.quadraticCurveTo(hoodMid, beltF - 0.02, L / 2 - 0.16, noseH + 0.08);
  s.quadraticCurveTo(L / 2 + 0.02, noseH + 0.02, L / 2 + 0.02, noseH - 0.12);
  s.lineTo(L / 2 + 0.03, clr + 0.18);
  s.lineTo(L / 2 - 0.08, clr);
  s.lineTo(wb + R * Math.cos(a0), clr);
  s.absarc(wb, wr, R, a0, Math.PI - a0, false);
  s.lineTo(-wb + R * Math.cos(a0), clr);
  s.absarc(-wb, wr, R, a0, Math.PI - a0, false);
  s.lineTo(-L / 2 + 0.06, clr);
  return s;
}
function glassShape(p) {
  const s = new THREE.Shape();
  s.moveTo(p.cabR, p.beltR - 0.04);
  s.lineTo(p.roofR, p.roofH - 0.02);
  s.lineTo(p.roofF, p.roofH);
  s.lineTo(p.cabF, p.beltF - 0.04);
  s.lineTo(p.cabR, p.beltR - 0.04);
  return s;
}
function roofShape(p) {
  const s = new THREE.Shape(), d = 0.035;
  const slopeR = (p.roofH - p.beltR) / (p.roofR - p.cabR), slopeF = (p.roofH - p.beltF) / (p.cabF - p.roofF);
  s.moveTo(p.roofR - 0.12, p.roofH - 0.12 * slopeR - 0.04);
  s.lineTo(p.roofR, p.roofH + d);
  s.lineTo(p.roofF, p.roofH + d + 0.005);
  s.lineTo(p.roofF + 0.12, p.roofH - 0.12 * slopeF - 0.04);
  s.lineTo(p.roofR - 0.12, p.roofH - 0.12 * slopeR - 0.04);
  return s;
}

// Round the extruded slab into a car: tuck the shoulders in, curve the flanks, round the corners in plan view.
function sculpt(g, p, kind) {
  const pos = g.attributes.position, { L, W, beltF, beltR, clr } = p;
  for (let i = 0; i < pos.count; i++) {
    let x = pos.getX(i); const y = pos.getY(i), z = pos.getZ(i);
    const belt = beltR + (beltF - beltR) * ((z + L / 2) / L);
    let k = 1;
    if (kind === 'body') {
      const sh = Math.min(1, Math.max(0, (y - (belt - 0.32)) / 0.32));
      k -= 0.075 * sh * sh;                                           // shoulder tuck toward the belt line
      const mid = (clr + belt) / 2, bulge = 1 - Math.min(1, Math.abs(y - mid) / (belt - clr));
      k += 0.012 * bulge;                                              // slight flank curvature
      const e = Math.max(0, Math.abs(z) - (L / 2 - 0.55)) / 0.55;
      k -= 0.11 * e * e;                                               // rounded nose and tail in plan view
    } else {
      const e = Math.max(0, y - (belt + 0.05)) / Math.max(0.2, p.roofH - belt);
      k -= 0.1 * e;                                                    // greenhouse leans in toward the roof
    }
    pos.setX(i, x * k);
  }
  g.computeVertexNormals();
  return g;
}
const geoCache = new Map();
function carGeometry(type, stripes, cut) {
  const key = type + (stripes ? ':s' : '') + (cut ? ':c' : '');
  if (geoCache.has(key)) return geoCache.get(key);
  const p = PROFILES[type], { L, W, wr, wb, clr, noseH, tailH, beltF, beltR, roofH } = p;
  const G = { paint: [], glass: [], trim: [], chrome: [], tire: [], plate: [], tail: [], head: [], blinkL: [], blinkR: [], stripe: [] };
  G.paint.push(sculpt(extrudeSide(bodyShape(p, cut), W, 0.1, 0.06, 4, 14), p, 'body'));
  if (!cut) {
    G.glass.push(sculpt(extrudeSide(glassShape(p), W * 0.86, 0.05, 0.025, 2, 2), p, 'glass'));
    G.paint.push(sculpt(extrudeSide(roofShape(p), W * 0.8, 0.04, 0.02, 2, 2), p, 'glass'));
    // B-pillar and window trim
    const bx = (p.roofF + p.roofR) / 2 - 0.05;
    G.trim.push(box(W * 0.85 + 0.02, roofH - beltR, 0.09, 0, (roofH + beltR) / 2 - 0.02, bx));
    G.trim.push(box(W * 0.86, 0.03, Math.abs(p.cabF - p.cabR) * 0.98, 0, (beltF + beltR) / 2 - 0.035, (p.cabF + p.cabR) / 2));
  }
  // wheels
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    G.tire.push(cyl(wr, wr, 0.24, 28, sx * (W / 2 - 0.16), wr, sz * wb, 0, 0, Math.PI / 2));
    G.chrome.push(cyl(wr * 0.64, wr * 0.64, 0.03, 20, sx * (W / 2 - 0.035), wr, sz * wb, 0, 0, Math.PI / 2));
    for (let k = 0; k < 5; k++) { const a = k / 5 * Math.PI * 2; G.trim.push(box(0.02, wr * 0.95, 0.05, sx * (W / 2 - 0.02), wr, sz * wb, a, 0, 0)); }
    G.trim.push(cyl(wr * 0.12, wr * 0.12, 0.04, 10, sx * (W / 2 - 0.015), wr, sz * wb, 0, 0, Math.PI / 2));
  }
  // rear: lights, plate, bumper, exhaust
  const zr = -L / 2 - 0.05, ly = tailH - 0.12;
  G.tail.push(box(0.42, 0.13, 0.06, -(W / 2 - 0.3), ly, zr)); G.tail.push(box(0.42, 0.13, 0.06, W / 2 - 0.3, ly, zr));
  G.trim.push(box(W * 0.42, 0.06, 0.05, 0, ly, zr + 0.01));
  G.blinkL.push(box(0.12, 0.13, 0.065, -(W / 2 - 0.08), ly, zr)); G.blinkR.push(box(0.12, 0.13, 0.065, W / 2 - 0.08, ly, zr));
  G.plate.push(box(0.52, 0.12, 0.02, 0, clr + 0.42, zr - 0.02));
  G.trim.push(box(W * 0.94, 0.17, 0.1, 0, clr + 0.1, -L / 2 + 0.01));
  G.chrome.push(cyl(0.045, 0.045, 0.16, 12, W / 2 - 0.42, clr + 0.08, -L / 2 - 0.02, Math.PI / 2, 0, 0));
  // front: lamps, grille, mirrors
  const zf = L / 2 + 0.0, hy = noseH - 0.12;
  G.head.push(box(0.4, 0.1, 0.12, -(W / 2 - 0.32), hy, zf)); G.head.push(box(0.4, 0.1, 0.12, W / 2 - 0.32, hy, zf));
  G.trim.push(box(W * 0.42, 0.14, 0.08, 0, hy - 0.06, zf + 0.0));
  G.trim.push(box(W * 0.9, 0.13, 0.08, 0, clr + 0.1, L / 2 - 0.04));
  for (const sx of [-1, 1]) {   // door mirrors: body-colour housing, arm and a reflective face looking back
    G.paint.push(box(0.21, 0.12, 0.09, sx * (W / 2 + 0.09), beltF + 0.08, p.cabF - 0.14));
    G.trim.push(box(0.1, 0.04, 0.06, sx * (W / 2 + 0.0), beltF + 0.03, p.cabF - 0.1));
    G.chrome.push(box(0.18, 0.095, 0.01, sx * (W / 2 + 0.09), beltF + 0.08, p.cabF - 0.19));
  }
  if (stripes) {
    // twin racing stripes over hood, roof and tail
    for (const sx of [-0.16, 0.16]) {
      const st = extrudeSide(bodyShape(p, cut), 0.2, 0.0001, 0.0005, 1, 14); st.scale(1, 1.008, 1.003); st.translate(sx, -0.004, 0);
      const rf = extrudeSide(roofShape(p), 0.2, 0.0001, 0.0005, 1, 2); rf.scale(1, 1.004, 1); rf.translate(sx, 0.012, 0);
      G.stripe.push(st, rf);
    }
  }
  const out = {};
  for (const k in G) out[k] = merge(G[k]);
  out.dims = { L: L + 0.1, W, H: roofH };
  geoCache.set(key, out);
  return out;
}

function truckGeometry() {
  if (geoCache.has('truck')) return geoCache.get('truck');
  const G = { paint: [], glass: [], trim: [], chrome: [], tire: [], plate: [], tail: [], head: [], blinkL: [], blinkR: [], trailer: [] };
  const W = 2.5;
  const cab = new THREE.Shape();
  cab.moveTo(5.9, 0.6); cab.lineTo(5.9, 3.45); cab.lineTo(7.55, 3.5); cab.quadraticCurveTo(7.95, 3.45, 8.0, 2.9);
  cab.lineTo(8.1, 1.3); cab.lineTo(8.05, 0.6); cab.lineTo(5.9, 0.6);
  G.paint.push(extrudeSide(cab, W, 0.12, 0.08, 3, 6));
  G.glass.push(box(W * 0.9, 0.95, 0.06, 0, 2.55, 8.07, -0.08, 0, 0));
  G.trailer.push(box(2.55, 3.45, 13.3, 0, 0.78 + 1.725, -1.2));
  G.trim.push(box(2.3, 0.35, 13.4, 0, 0.62, -1.2));          // chassis
  G.trim.push(box(2.0, 0.6, 0.4, 0, 0.8, 5.7));               // cab back
  G.trim.push(box(2.56, 0.04, 0.05, 0, 0.78 + 3.45, -7.85));  // rear door frame
  G.trim.push(box(0.05, 3.4, 0.05, 0, 0.78 + 1.72, -7.87));
  for (const sx of [-1, 1]) G.trim.push(box(0.06, 0.25, 9.0, sx * 1.22, 0.62, -0.5)); // side guards
  for (const z of [-6.4, -5.2, -4.0, 6.9]) for (const sx of [-1, 1]) {
    G.tire.push(cyl(0.5, 0.5, 0.5, 24, sx * 1.0, 0.5, z, 0, 0, Math.PI / 2));
    G.chrome.push(cyl(0.3, 0.3, 0.03, 16, sx * 1.255, 0.5, z, 0, 0, Math.PI / 2));
  }
  G.trim.push(box(2.5, 0.22, 0.18, 0, 0.42, -7.95)); // under-run bar
  for (let i = 0; i < 8; i++) G[i % 2 ? 'tail' : 'chrome'].push(box(0.28, 0.06, 0.03, -1.1 + i * 0.31, 0.6, -8.06));
  G.tail.push(box(0.36, 0.16, 0.06, -1.0, 0.9, -7.92)); G.tail.push(box(0.36, 0.16, 0.06, 1.0, 0.9, -7.92));
  G.blinkL.push(box(0.14, 0.16, 0.065, -1.22, 0.9, -7.92)); G.blinkR.push(box(0.14, 0.16, 0.065, 1.22, 0.9, -7.92));
  G.plate.push(box(0.52, 0.12, 0.02, 0, 0.88, -7.96));
  G.head.push(box(0.4, 0.18, 0.08, -0.85, 1.05, 8.1)); G.head.push(box(0.4, 0.18, 0.08, 0.85, 1.05, 8.1));
  G.trim.push(box(1.3, 0.8, 0.06, 0, 1.6, 8.11));
  for (const sx of [-1, 1]) G.trim.push(box(0.08, 0.45, 0.2, sx * 1.42, 2.6, 7.4));
  const out = {};
  for (const k in G) out[k] = merge(G[k]);
  out.dims = { L: 16.2, W: 2.55, H: 4.25 };
  geoCache.set('truck', out);
  return out;
}

// Shared materials ("kit"); emissive strengths are tuned per theme by setNight().
export function makeKit() {
  const plate = makePlateTexture(), shadow = makeShadowTexture();
  const kit = {
    paints: new Map(),
    glass: new THREE.MeshPhysicalMaterial({ color: 0x0c1118, metalness: 0.05, roughness: 0.04, envMapIntensity: 1.6, clearcoat: 1, clearcoatRoughness: 0.02 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x0f1012, roughness: 0.5, metalness: 0.25 }),
    tire: new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.92 }),
    chrome: new THREE.MeshStandardMaterial({ color: 0xdadde2, roughness: 0.16, metalness: 1 }),
    plate: new THREE.MeshStandardMaterial({ map: plate, roughness: 0.35 }),
    head: new THREE.MeshStandardMaterial({ color: 0xf2f2f2, emissive: 0xfff1d8, emissiveIntensity: 0.3, roughness: 0.15 }),
    blink: new THREE.MeshStandardMaterial({ color: 0x5a3500, emissive: 0xffa000, emissiveIntensity: 3 }),
    trailers: new Map(),
    shadow: new THREE.MeshBasicMaterial({ map: shadow, transparent: true, depthWrite: false, opacity: 0.75, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }),
    night: false,
  };
  kit.paint = (color, metal = 0.5) => {
    const k = color + ':' + metal;
    if (!kit.paints.has(k)) kit.paints.set(k, new THREE.MeshPhysicalMaterial({ color, metalness: metal, roughness: 0.32 + (1 - metal) * 0.12, clearcoat: 1, clearcoatRoughness: 0.05 }));
    return kit.paints.get(k);
  };
  kit.trailer = color => {
    if (!kit.trailers.has(color)) kit.trailers.set(color, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1 }));
    return kit.trailers.get(color);
  };
  kit.setNight = night => { kit.night = night; kit.head.emissiveIntensity = night ? 6 : 0.4; };
  return kit;
}

// Build one vehicle. Returns { group, tail (own material), blinkL, blinkR, dims }.
export function makeVehicle(type, color, kit, opts = {}) {
  const G = type === 'truck' ? truckGeometry() : carGeometry(type, !!opts.stripes, !!opts.cabinCut);
  const grp = new THREE.Group();
  const add = (geo, mat, cast) => { if (!geo) return null; const m = new THREE.Mesh(geo, mat); m.castShadow = !!cast; m.receiveShadow = true; grp.add(m); return m; };
  const paint = kit.paint(color, opts.metal ?? 0.5);
  add(G.paint, paint, true);
  if (G.trailer) add(G.trailer, kit.trailer(opts.trailerColor ?? 0xeeeeee), true);
  add(G.glass, kit.glass);
  add(G.trim, kit.trim);
  add(G.tire, kit.tire);
  add(G.chrome, kit.chrome);
  add(G.plate, kit.plate);
  add(G.head, kit.head);
  if (G.stripe) add(G.stripe, kit.paint(opts.stripes, 0.2));
  const tail = new THREE.MeshStandardMaterial({ color: 0x5c0606, emissive: 0xff1508, emissiveIntensity: 0.35, roughness: 0.2 });
  add(G.tail, tail);
  const blinkL = add(G.blinkL, kit.blink), blinkR = add(G.blinkR, kit.blink);
  blinkL.visible = blinkR.visible = false;
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(G.dims.W * 1.35, G.dims.L * 1.12), kit.shadow);
  sh.rotation.x = -Math.PI / 2; sh.position.y = 0.03; sh.renderOrder = -1;
  grp.add(sh);
  // +X is the car's left side, so the "blinkR" geometry (built at +X) is the left indicator
  return { group: grp, tail, blinkL: blinkR, blinkR: blinkL, dims: G.dims, shadow: sh };
}

// ---------------------------------------------------------------- roadside props (merged, vertex-coloured)
const propCache = new Map();
export function propGeometry(kind) {
  if (propCache.has(kind)) return propCache.get(kind);
  const r = mulberry32(kind.length * 31 + 7);
  let g;
  if (kind === 'pine' || kind === 'snowpine') {
    const parts = [colorize(cyl(0.16, 0.26, 3.2, 8, 0, 1.6, 0), 0x4a3324)];
    const tiers = 6;
    for (let i = 0; i < tiers; i++) {
      const t = i / tiers, rad = 2.6 * (1 - t * 0.78), h = 3.2 * (1 - t * 0.35);
      const cone = jitter(new THREE.ConeGeometry(rad, h, 9, 2), 0.35, i * 13 + 5);
      cone.translate(0, 2.4 + i * 1.55 + h / 2, 0);
      const base = new THREE.Color().setHSL(0.36 + r() * 0.04, 0.42, 0.13 + r() * 0.05);
      colorize(cone, base);
      if (kind === 'snowpine') {   // snow settles on upward faces
        const n = cone.attributes.normal, c = cone.attributes.color;
        for (let k = 0; k < n.count; k++) if (n.getY(k) > 0.45) c.setXYZ(k, 0.92, 0.95, 1.0);
      }
      parts.push(cone);
    }
    g = merge(parts);
  } else if (kind === 'oak') {
    const parts = [colorize(cyl(0.22, 0.38, 4.2, 8, 0, 2.1, 0), 0x4b3626)];
    parts.push(colorize(cyl(0.12, 0.18, 2.2, 6, 0.6, 4.2, 0, 0, 0, -0.5), 0x4b3626));
    for (let i = 0; i < 7; i++) {
      const b = jitter(new THREE.IcosahedronGeometry(1.6 + r() * 1.2, 1), 0.7, i * 7 + 1);
      b.scale(1, 0.85, 1);
      b.translate((r() - 0.5) * 3.2, 5.6 + r() * 2.6, (r() - 0.5) * 3.2);
      parts.push(colorize(b, new THREE.Color().setHSL(0.24 + r() * 0.06, 0.45, 0.17 + r() * 0.08)));
    }
    g = merge(parts);
  } else if (kind === 'bush') {
    const parts = [];
    for (let i = 0; i < 4; i++) {
      const b = jitter(new THREE.IcosahedronGeometry(0.7 + r() * 0.5, 1), 0.35, i * 3 + 2);
      b.translate((r() - 0.5) * 1.6, 0.5 + r() * 0.4, (r() - 0.5) * 1.6);
      parts.push(colorize(b, new THREE.Color().setHSL(0.25 + r() * 0.05, 0.4, 0.16 + r() * 0.06)));
    }
    g = merge(parts);
  } else if (kind === 'cactus') {
    const green = 0x3f6b35, parts = [];
    const ribbed = (rad, h, x, y, z, rz = 0) => {
      const c = cyl(rad, rad * 1.05, h, 14, x, y, z, 0, 0, rz);
      const col = new Float32Array(c.attributes.position.count * 3), cc = new THREE.Color(green);
      for (let i = 0; i < c.attributes.position.count; i++) { const k = (Math.floor(Math.atan2(c.attributes.position.getZ(i) - z, c.attributes.position.getX(i) - x) / (Math.PI * 2) * 14 + 14) % 2) ? 0.82 : 1; col[i * 3] = cc.r * k; col[i * 3 + 1] = cc.g * k; col[i * 3 + 2] = cc.b * k; }
      c.setAttribute('color', new THREE.BufferAttribute(col, 3)); return c;
    };
    parts.push(ribbed(0.32, 5.2, 0, 2.6, 0));
    parts.push(colorize(new THREE.SphereGeometry(0.32, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2).translate(0, 5.2, 0), green));
    parts.push(ribbed(0.22, 1.0, -0.55, 2.2, 0, Math.PI / 2)); parts.push(ribbed(0.22, 1.8, -1.05, 3.0, 0));
    parts.push(colorize(new THREE.SphereGeometry(0.22, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(-1.05, 3.9, 0), green));
    parts.push(ribbed(0.2, 0.9, 0.5, 3.0, 0, Math.PI / 2)); parts.push(ribbed(0.2, 1.4, 0.95, 3.6, 0));
    parts.push(colorize(new THREE.SphereGeometry(0.2, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2).translate(0.95, 4.3, 0), green));
    g = merge(parts);
  } else if (kind === 'rock') {
    const b = jitter(new THREE.DodecahedronGeometry(1.4, 1), 0.9, 3); b.scale(1.3, 0.7, 1.1); b.translate(0, 0.4, 0);
    g = merge([colorize(b, 0x8a5e44)]);
  } else if (kind === 'lamp') {
    const grey = 0x8d939b;
    g = merge([
      colorize(cyl(0.09, 0.13, 10, 10, 0, 5, 0), grey),
      colorize(cyl(0.055, 0.055, 2.4, 8, 1.1, 9.95, 0, 0, 0, Math.PI / 2 - 0.12), grey),
      colorize(box(0.7, 0.16, 0.32, 2.25, 9.95, 0), 0x3a3d42),
      colorize(cyl(0.22, 0.25, 0.5, 10, 0, 0.25, 0), 0x6f747b),
    ]);
  } else if (kind === 'lampHead') {
    g = merge([box(0.6, 0.04, 0.26, 2.25, 9.86, 0)]);
  } else if (kind === 'pylon') {
    const t = new THREE.TorusGeometry(4, 0.16, 6, 3); t.rotateZ(Math.PI / 2); t.translate(0, 3.2, 0);
    g = merge([t]);
  } else if (kind === 'post') {
    g = merge([box(0.12, 0.85, 0.16, 0, 0.42, 0)]);
  }
  propCache.set(kind, g);
  return g;
}
