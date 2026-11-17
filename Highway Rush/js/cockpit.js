// The player's car: exterior body (hood seen through the windshield), interior, wheel, hands, gauges, mirror.
// Car local axes: +Z forward, +Y up, +X = car's LEFT (driver side, left-hand drive).
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { makeVehicle, PROFILES } from './models.js';
import { makeLeatherBump, makeSkinTexture } from './textures.js';
import { clamp } from './config.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const Y = V(0, 1, 0);
function capsule(a, b, r, segs = 10) {
  const dir = b.clone().sub(a), len = dir.length();
  const g = new THREE.CapsuleGeometry(r, Math.max(0.0005, len), 5, segs);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(Y, dir.normalize()));
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}
function ellipsoid(center, ax, ay, az, rx, ry, rz) {   // axes (unit vectors) with radii
  const g = new THREE.SphereGeometry(1, 24, 16);
  const m = new THREE.Matrix4().makeBasis(ax.clone().multiplyScalar(rx), ay.clone().multiplyScalar(ry), az.clone().multiplyScalar(rz));
  m.setPosition(center); g.applyMatrix4(m); return g;
}
const _lm = new THREE.Matrix4();
function faceTo(obj, target) {   // lookAt in the parent's local space (the car may be anywhere in the world)
  _lm.lookAt(target, obj.position, Y); obj.quaternion.setFromRotationMatrix(_lm);
}
const prep = g => { g = g.index ? g.toNonIndexed() : g; for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k); return g; };
const mergeAll = list => mergeGeometries(list.map(prep), false);

// One hand gripping the rim at angle th (wheel-local; rim in XY plane, driver on the -Z side).
// The back of the hand sits on the outside of the rim facing the driver, fingers curl over the far
// side of the rim and the fingertips show on the inside, the thumb lies along the near face.
function handGeometry(R, tube, th, isLeft, elbowLocal) {
  const r = V(Math.cos(th), Math.sin(th), 0), t = V(-Math.sin(th), Math.cos(th), 0), n = V(0, 0, -1);
  const tu = t.clone().multiplyScalar(isLeft ? 1 : -1);      // "up the wheel" for this hand
  const P = r.clone().multiplyScalar(R);
  const rho = tube + 0.0088;
  const onRim = (phi, off, extra = 0) => {                      // point around the rim tube
    const a = th + off / R * (isLeft ? 1 : -1);
    const c = V(Math.cos(a), Math.sin(a), 0), base = c.clone().multiplyScalar(R);
    return base.add(c.multiplyScalar(Math.cos(phi) * (rho + extra))).add(n.clone().multiplyScalar(Math.sin(phi) * (rho + extra)));
  };
  const parts = [];
  // fingers: index (up the wheel) → little finger
  const F = [[0.027, 0.0092, 1.0], [0.0085, 0.0096, 1.06], [-0.0095, 0.0091, 1.0], [-0.026, 0.008, 0.86]];
  for (const [off, rad, len] of F) {
    const k0 = onRim(0.55, off, 0.004), k1 = onRim(-0.35, off, 0.002), k2 = onRim(-1.45 * len, off), k3 = onRim(-2.35 * len, off), tip = onRim(-2.85 * len, off * 0.95, -0.001);
    parts.push(capsule(k0, k1, rad * 1.04), capsule(k1, k2, rad), capsule(k2, k3, rad * 0.93), capsule(k3, tip, rad * 0.86));
    parts.push(new THREE.SphereGeometry(rad * 1.1, 14, 10).translate(k1.x, k1.y, k1.z));     // knuckle
  }
  // back of the hand: from the knuckle row toward the wrist (outside of the rim, toward the driver)
  const knuck = onRim(0.5, 0, 0.012);
  const toElbow = elbowLocal.clone().sub(P).normalize();
  const along = toElbow.clone().multiplyScalar(0.75).add(r.clone().multiplyScalar(0.25)).add(n.clone().multiplyScalar(0.2)).normalize();
  const wrist = knuck.clone().add(along.clone().multiplyScalar(0.088));
  const thick = new THREE.Vector3().crossVectors(along, tu).normalize();
  const tuw = new THREE.Vector3().crossVectors(thick, along).normalize();
  parts.push(ellipsoid(knuck.clone().lerp(wrist, 0.42), tuw, along, thick, 0.041, 0.048, 0.017));
  // thumb along the near (driver) face of the rim, curving up toward the spoke
  const t0 = onRim(0.85, -0.018, 0.016);
  const t1 = onRim(1.2, 0.004, 0.006);
  const t2 = onRim(1.45, 0.024, 0.002);
  const t3 = onRim(1.6, 0.04, 0.0);
  parts.push(capsule(t0, t1, 0.0125), capsule(t1, t2, 0.011), capsule(t2, t3, 0.0098));
  parts.push(ellipsoid(t0.clone().lerp(wrist, 0.45), tuw, along, thick, 0.024, 0.036, 0.017)); // thenar pad
  // wrist
  const wEnd = wrist.clone().add(along.clone().multiplyScalar(0.035));
  parts.push(capsule(wrist.clone().sub(along.clone().multiplyScalar(0.02)), wEnd, 0.024));
  return { geo: mergeAll(parts), wristEnd: wEnd, along };
}

function drawGauges(c, W, H, kmh, rpm, gear, accent, km) {
  c.clearRect(0, 0, W, H);
  const bg = c.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#07080b'); bg.addColorStop(1, '#0d0f14');
  c.fillStyle = bg; c.fillRect(0, 0, W, H);
  const dial = (x, y, r, frac, labels, red, title) => {
    const a0 = Math.PI * 0.75, a1 = Math.PI * 2.25;
    c.lineWidth = r * 0.03; c.strokeStyle = '#2a2f3a'; c.beginPath(); c.arc(x, y, r, 0, 7); c.stroke();
    if (red < 1) { c.strokeStyle = '#ff3b30'; c.lineWidth = r * 0.06; c.beginPath(); c.arc(x, y, r * 0.86, a0 + (a1 - a0) * red, a1); c.stroke(); }
    for (let i = 0; i <= 40; i++) {
      const a = a0 + (a1 - a0) * i / 40, major = i % 5 === 0;
      c.strokeStyle = major ? '#f2f2f2' : '#9aa0aa'; c.lineWidth = major ? r * 0.025 : r * 0.012;
      const ri = r * (major ? 0.8 : 0.86);
      c.beginPath(); c.moveTo(x + Math.cos(a) * ri, y + Math.sin(a) * ri); c.lineTo(x + Math.cos(a) * r * 0.93, y + Math.sin(a) * r * 0.93); c.stroke();
    }
    c.fillStyle = '#e9ecf2'; c.font = `500 ${r * 0.13}px Helvetica,Arial`; c.textAlign = 'center'; c.textBaseline = 'middle';
    labels.forEach((t, i) => { const a = a0 + (a1 - a0) * i / (labels.length - 1); c.fillText(t, x + Math.cos(a) * r * 0.64, y + Math.sin(a) * r * 0.64); });
    c.fillStyle = '#8a909c'; c.font = `500 ${r * 0.09}px Helvetica,Arial`; c.fillText(title, x, y + r * 0.42);
    const a = a0 + (a1 - a0) * clamp(frac, 0, 1);
    c.shadowColor = accent; c.shadowBlur = 12;
    c.strokeStyle = '#ff5a2a'; c.lineWidth = r * 0.035; c.lineCap = 'round';
    c.beginPath(); c.moveTo(x - Math.cos(a) * r * 0.12, y - Math.sin(a) * r * 0.12); c.lineTo(x + Math.cos(a) * r * 0.86, y + Math.sin(a) * r * 0.86); c.stroke();
    c.shadowBlur = 0; c.lineCap = 'butt';
    c.fillStyle = '#1b1e25'; c.beginPath(); c.arc(x, y, r * 0.09, 0, 7); c.fill();
  };
  dial(W * 0.2, H * 0.52, H * 0.44, kmh / 300, ['0', '40', '80', '120', '160', '200', '240', '280'].slice(0, 8), 1, 'km/h');
  dial(W * 0.8, H * 0.52, H * 0.44, rpm, ['0', '1', '2', '3', '4', '5', '6', '7', '8'], 0.8, 'x1000 rpm');
  // centre display
  c.fillStyle = '#0a0d12'; c.fillRect(W * 0.37, H * 0.12, W * 0.26, H * 0.76);
  c.strokeStyle = '#1f2530'; c.lineWidth = 2; c.strokeRect(W * 0.37, H * 0.12, W * 0.26, H * 0.76);
  c.fillStyle = accent; c.font = `700 ${H * 0.3}px Helvetica,Arial`; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText(String(Math.round(kmh)), W * 0.5, H * 0.42);
  c.fillStyle = '#9aa0aa'; c.font = `500 ${H * 0.08}px Helvetica,Arial`; c.fillText('km/h', W * 0.5, H * 0.6);
  c.fillStyle = '#e9ecf2'; c.font = `600 ${H * 0.1}px Helvetica,Arial`; c.fillText(`${gear}   ·   ${km.toFixed(1)} km`, W * 0.5, H * 0.76);
}

export class Cockpit {
  constructor(kit) {
    this.kit = kit;
    this.group = new THREE.Group();
    this.camera = new THREE.PerspectiveCamera(52, 1, 0.04, 8000);
    this.mirrorCam = new THREE.PerspectiveCamera(22, 3.4, 0.5, 900);
    this.mirrorRT = new THREE.WebGLRenderTarget(512, 150, { samples: 2 });
    this.mirrorRT.texture.colorSpace = THREE.SRGBColorSpace;
    this.gaugeCanvas = document.createElement('canvas'); this.gaugeCanvas.width = 1024; this.gaugeCanvas.height = 384;
    this.gaugeTex = new THREE.CanvasTexture(this.gaugeCanvas); this.gaugeTex.colorSpace = THREE.SRGBColorSpace; this.gaugeTex.anisotropy = 8;
    this.leather = makeLeatherBump(); this.skin = makeSkinTexture();
    this.steerAngle = 0; this.frame = 0;
    this.lights = [];
  }

  build(carDef, theme) {
    // clear previous
    for (const c of [...this.group.children]) { this.group.remove(c); c.traverse(o => { if (o.geometry && !o.userData.shared) o.geometry.dispose(); }); }
    const p = PROFILES[carDef.body];
    this.p = p;
    const veh = makeVehicle(carDef.body, carDef.paint, this.kit, { stripes: carDef.stripes, metal: carDef.metal, cabinCut: true });
    veh.shadow.visible = true;
    veh.group.traverse(o => { if (o.isMesh) o.userData.shared = true; });
    this.vehicle = veh; this.group.add(veh.group);
    const W = p.W, eyeY = Math.max(p.roofH - 0.26, p.beltF + 0.2), eyeZ = p.roofF - 0.62, eyeX = 0.37;
    this.eye = V(eyeX, eyeY, eyeZ);
    const dashY = p.beltF + 0.01;
    const I = new THREE.Group(); this.group.add(I); this.interior = I;
    const soft = new THREE.MeshStandardMaterial({ color: 0x151619, roughness: 0.8, metalness: 0.05, bumpMap: this.leather, bumpScale: 0.3 });
    const softLight = new THREE.MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.75 });
    const fabric = new THREE.MeshStandardMaterial({ color: 0x8e8b85, roughness: 1 });
    const gloss = new THREE.MeshStandardMaterial({ color: 0x08090b, roughness: 0.12, metalness: 0.4 });
    const alu = new THREE.MeshStandardMaterial({ color: 0xb8bcc2, roughness: 0.3, metalness: 1 });
    const accent = new THREE.Color(carDef.accent);
    // dashboard: profile across the cabin
    {
      const s = new THREE.Shape();
      const zc = p.cabF, zd = Math.min(eyeZ + 0.74, zc - 0.25);
      s.moveTo(zc + 0.06, dashY - 0.05);
      s.lineTo(zc - 0.08, dashY + 0.005);
      s.quadraticCurveTo((zc + zd) / 2, dashY + 0.035, zd + 0.06, dashY + 0.0);
      s.quadraticCurveTo(zd - 0.04, dashY - 0.03, zd - 0.02, dashY - 0.14);
      const floorY = p.clr + 0.42;
      s.lineTo(zd + 0.08, dashY - 0.4);
      s.lineTo(zd + 0.32, floorY);
      s.lineTo(zc + 0.06, floorY);
      const g = new THREE.ExtrudeGeometry(s, { depth: W - 0.22, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.015, bevelSegments: 2, curveSegments: 12 });
      g.translate(0, 0, 0.02); g.rotateY(-Math.PI / 2); g.translate((W - 0.22) / 2 + 0.0, 0, 0);
      I.add(new THREE.Mesh(g, soft));
      // instrument binnacle
      // instrument hood (visor) over the gauges
      const vs = new THREE.Shape();
      vs.moveTo(0.02, 0); vs.quadraticCurveTo(0.0, 0.085, -0.13, 0.09); vs.lineTo(-0.13, 0.075); vs.quadraticCurveTo(-0.012, 0.07, 0.0, 0.0); vs.lineTo(0.02, 0);
      void vs;
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.014, 0.13), soft);
      brow.position.set(eyeX, dashY + 0.05, zd - 0.03); brow.rotation.x = -0.12; I.add(brow);
      const surround = new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.02), gloss);
      surround.position.set(eyeX, dashY - 0.03, zd - 0.022); faceTo(surround, this.eye); I.add(surround);
      // gauge face
      const gp = new THREE.Mesh(new THREE.PlaneGeometry(0.36, 0.135), new THREE.MeshBasicMaterial({ map: this.gaugeTex, toneMapped: false }));
      gp.position.set(eyeX, dashY - 0.03, zd - 0.034); faceTo(gp, this.eye); I.add(gp);
      // centre screen + vents
      const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.24, 0.14), new THREE.MeshStandardMaterial({ color: 0x050608, emissive: accent.clone().multiplyScalar(0.25), roughness: 0.1, metalness: 0.2 }));
      scr.position.set(-0.02, dashY - 0.05, zd + 0.08); faceTo(scr, V(-0.02, eyeY, eyeZ)); I.add(scr);
      for (const vx of [eyeX + 0.33, -0.02 + 0.1, -0.02 - 0.1, -eyeX - 0.3]) {
        const v = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.045, 0.02), gloss); v.position.set(vx, dashY - 0.12, zd + 0.02); I.add(v);
        for (let k = 0; k < 4; k++) { const sl = new THREE.Mesh(new THREE.BoxGeometry(0.11, 0.004, 0.022), alu); sl.position.set(vx, dashY - 0.135 + k * 0.01, zd + 0.012); I.add(sl); }
      }
    }
    // A-pillars, roof liner, door tops, mirror
    for (const sx of [-1, 1]) {
      const a = V(sx * (W / 2 - 0.13), p.beltF - 0.02, p.cabF + 0.02), b = V(sx * (W / 2 - 0.17), p.roofH - 0.03, p.roofF - 0.02);
      const pill = new THREE.Mesh(capsule(a, b, 0.045, 8), softLight); I.add(pill);
      const sill = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, Math.abs(p.cabF - eyeZ) + 1.0), soft);
      sill.position.set(sx * (W / 2 - 0.12), p.beltF - 0.02, (p.cabF + eyeZ) / 2 - 0.4); I.add(sill);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.5), soft);
      door.position.set(sx * (W / 2 - 0.1), p.beltF - 0.28, eyeZ + 0.1); door.rotation.y = sx > 0 ? -Math.PI / 2 : Math.PI / 2; I.add(door);
    }
    const carpet = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.2, 2.6), new THREE.MeshStandardMaterial({ color: 0x111214, roughness: 1 }));
    carpet.rotation.x = -Math.PI / 2; carpet.position.set(0, p.clr + 0.425, eyeZ - 0.2); I.add(carpet);
    const liner = new THREE.Mesh(new THREE.PlaneGeometry(W - 0.25, 2.2), fabric);
    liner.rotation.x = Math.PI / 2; liner.position.set(0, p.roofH - 0.035, p.roofF - 1.0); I.add(liner);
    const header = new THREE.Mesh(new THREE.BoxGeometry(W - 0.2, 0.06, 0.12), softLight); header.position.set(0, p.roofH - 0.05, p.roofF + 0.02); I.add(header);
    // rear-view mirror with a live view behind
    const mw = 0.25, mh = 0.072;
    const mirrorMat = new THREE.MeshBasicMaterial({ map: this.mirrorRT.texture, toneMapped: true });
    this.mirrorRT.texture.wrapS = THREE.RepeatWrapping; this.mirrorRT.texture.repeat.x = -1; this.mirrorRT.texture.offset.x = 1;
    const mPos = V(0.02, p.roofH - 0.14, p.roofF + 0.0);
    const housing = new THREE.Mesh(new THREE.BoxGeometry(mw + 0.025, mh + 0.022, 0.035), gloss); housing.position.copy(mPos); faceTo(housing, this.eye); I.add(housing);
    const mirror = new THREE.Mesh(new THREE.PlaneGeometry(mw, mh), mirrorMat); mirror.position.copy(mPos).add(this.eye.clone().sub(mPos).normalize().multiplyScalar(0.019)); faceTo(mirror, this.eye); I.add(mirror);
    for (const sx of [-1, 1]) {   // door mirrors reuse the rear view
      const dm = new THREE.Mesh(new THREE.PlaneGeometry(0.17, 0.088), mirrorMat);
      dm.position.set(sx * (W / 2 + 0.09), p.beltF + 0.08, p.cabF - 0.198); dm.rotation.y = Math.PI; I.add(dm);
    }
    const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.09), gloss); stem.position.set(0.02, p.roofH - 0.07, p.roofF - 0.0); I.add(stem);
    this.mirrorCam.position.set(0, p.roofH - 0.05, p.roofF - 0.6);
    this.mirrorCam.rotation.set(0.02, 0, 0);   // looks along -Z = backwards
    this.group.add(this.mirrorCam);
    // steering wheel
    const wheel = new THREE.Group();
    const wc = V(eyeX, eyeY - 0.34, eyeZ + 0.6);
    wheel.position.copy(wc); wheel.rotation.x = 0.42;
    const spin = new THREE.Group(); wheel.add(spin); this.wheelSpin = spin;
    const R = 0.185, tube = 0.0175;
    const leather = new THREE.MeshStandardMaterial({ color: 0x18181a, roughness: 0.58, bumpMap: this.leather, bumpScale: 0.6 });
    spin.add(new THREE.Mesh(new THREE.TorusGeometry(R, tube, 18, 96), leather));
    const stitch = new THREE.Mesh(new THREE.TorusGeometry(R, tube * 1.02, 4, 96, Math.PI * 0.22), new THREE.MeshStandardMaterial({ color: accent, roughness: 0.6 }));
    stitch.rotation.z = Math.PI / 2 - Math.PI * 0.11; stitch.scale.z = 0.25; spin.add(stitch);
    const spokeMat = new THREE.MeshStandardMaterial({ color: 0x232428, roughness: 0.45, metalness: 0.5 });
    for (const sx of [-1, 1]) {
      const sp = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.038, 0.022), spokeMat); sp.position.set(sx * 0.125, -0.012, 0.005); spin.add(sp);
      const tr = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.006, 0.024), alu); tr.position.set(sx * 0.12, 0.002, 0.004); spin.add(tr);
    }
    const sb = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.022), spokeMat); sb.position.set(0, -0.12, 0.005); spin.add(sb);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(0.068, 0.074, 0.055, 40), new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.55 }));
    hub.rotation.x = Math.PI / 2; hub.position.z = -0.02; hub.scale.set(1.15, 1, 0.9); spin.add(hub);
    const logo = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.004, 24), alu); logo.rotation.x = Math.PI / 2; logo.position.z = -0.049; spin.add(logo);
    const col = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 0.3, 16), new THREE.MeshStandardMaterial({ color: 0x141518, roughness: 0.7 }));
    col.rotation.x = Math.PI / 2; col.position.z = 0.16; wheel.add(col);
    I.add(wheel); this.wheel = wheel;
    // hands (children of the spinning wheel so they turn with it)
    const skinMat = new THREE.MeshPhysicalMaterial({ color: 0xb98067, map: this.skin, roughness: 0.62, sheen: 0.25, sheenColor: new THREE.Color(0xc77a66), sheenRoughness: 0.7, envMapIntensity: 0.6 });
    const sleeveMat = new THREE.MeshStandardMaterial({ color: 0x1f2633, roughness: 0.95 });
    const cuffMat = new THREE.MeshStandardMaterial({ color: 0x171c26, roughness: 1 });
    this.arms = [];
    wheel.updateMatrix();
    const toWheel = new THREE.Matrix4().copy(wheel.matrix).invert();
    for (const [th, isLeft] of [[0.62, true], [Math.PI - 0.62, false]]) {
      const elbow = V(isLeft ? eyeX + 0.36 : eyeX - 0.34, eyeY - 0.78, eyeZ + 0.12);
      const h = handGeometry(R, tube, th, isLeft, elbow.clone().applyMatrix4(toWheel));
      const hm = new THREE.Mesh(h.geo, skinMat); spin.add(hm);
      const wristMarker = new THREE.Object3D(); wristMarker.position.copy(h.wristEnd); spin.add(wristMarker);
      if (isLeft) {   // wristwatch
        const w0 = h.wristEnd.clone().sub(h.along.clone().multiplyScalar(0.035));
        const band = new THREE.Mesh(new THREE.TorusGeometry(0.027, 0.006, 8, 24), new THREE.MeshStandardMaterial({ color: 0x2a1d14, roughness: 0.7 }));
        band.position.copy(w0); band.quaternion.setFromUnitVectors(V(0, 0, 1), h.along); spin.add(band);
        const face = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, 0.008, 24), alu);
        const outward = V(Math.cos(th), Math.sin(th), 0);
        face.position.copy(w0).add(outward.clone().multiplyScalar(0.026)); face.quaternion.setFromUnitVectors(Y, outward); spin.add(face);
      }
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.047, 0.056, 1, 20, 1, true), sleeveMat);
      const cuff = new THREE.Mesh(new THREE.TorusGeometry(0.046, 0.009, 8, 24), cuffMat);
      I.add(sleeve, cuff);
      this.arms.push({ wristMarker, sleeve, cuff, elbow });
    }
    // camera
    this.camera.position.copy(this.eye); this.camera.rotation.set(-0.075, Math.PI, 0, 'YXZ');
    this.group.add(this.camera);
    // headlights for night roads
    for (const l of this.lights) this.group.remove(l, l.target);
    this.lights = [];
    if (theme.headlights) {
      for (const sx of [-0.62, 0.62]) {
        const sl = new THREE.SpotLight(0xfff1dc, 150, 150, 0.42, 0.6, 1.55);
        sl.position.set(sx, p.noseH, p.L / 2 + 0.1); sl.target.position.set(sx * 0.6, 0, 45);
        this.group.add(sl, sl.target); this.lights.push(sl);
      }
    }
    // soft cabin light so the dash and hands stay readable on night roads
    if (this.cabinLight) this.group.remove(this.cabinLight);
    this.cabinLight = null;
    if (theme.night) {
      const cl = new THREE.PointLight(theme.synth ? 0xff9ad0 : 0xffd9b0, 0.9, 1.6, 1.2);
      cl.position.set(eyeX - 0.05, eyeY + 0.05, eyeZ + 0.35); this.group.add(cl); this.cabinLight = cl;
    }
    this.carDef = carDef;
  }

  setAspect(aspect) {
    // keep a natural horizontal field of view on narrow screens
    const vfov = aspect >= 1.45 ? 52 : THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(72) / 2) / aspect));
    this.camera.fov = Math.min(vfov, 100); this.camera.aspect = aspect; this.camera.updateProjectionMatrix();
  }

  update(dt, { steer, kmh, rpm, gear, km, shake, crash, time, speedFrac, lateral }) {
    const target = steer * 0.85 + (crash ? Math.sin(time * 40) * 0.25 * crash : 0);
    this.steerAngle += (target - this.steerAngle) * Math.min(1, dt * 10);
    this.wheelSpin.rotation.z = this.steerAngle;
    // forearms from fixed elbows to the hands
    this.group.updateMatrixWorld(true);
    const inv = new THREE.Matrix4().copy(this.interior.matrixWorld).invert();
    for (const a of this.arms) {
      const w = a.wristMarker.getWorldPosition(new THREE.Vector3()).applyMatrix4(inv);
      const dir = w.clone().sub(a.elbow), len = dir.length();
      a.sleeve.position.copy(a.elbow).add(dir.clone().multiplyScalar(0.5 - 0.02 / len));
      a.sleeve.quaternion.setFromUnitVectors(Y, dir.clone().normalize());
      a.sleeve.scale.set(1, len - 0.04, 1);
      a.cuff.position.copy(w).sub(dir.clone().normalize().multiplyScalar(0.03));
      a.cuff.quaternion.setFromUnitVectors(V(0, 0, 1), dir.clone().normalize());
    }
    // head: subtle vibration, lean into lane changes
    const bob = Math.sin(time * 31) * 0.0012 * speedFrac + (Math.random() - 0.5) * 0.002 * shake;
    this.camera.position.set(this.eye.x + (Math.random() - 0.5) * 0.004 * shake - lateral * 0.012, this.eye.y + bob, this.eye.z);
    this.camera.rotation.set(-0.075, Math.PI, -lateral * 0.012, 'YXZ');
    if ((this.frame++ & 1) === 0) {
      drawGauges(this.gaugeCanvas.getContext('2d'), 1024, 384, kmh, rpm, gear, this.carDef.accent, km);
      this.gaugeTex.needsUpdate = true;
    }
  }

  renderMirror(renderer, scene) {
    if (this.frame % 2) return;
    const prevAuto = renderer.shadowMap.autoUpdate; renderer.shadowMap.autoUpdate = false;
    this.interior.visible = false;
    renderer.setRenderTarget(this.mirrorRT); renderer.render(scene, this.mirrorCam); renderer.setRenderTarget(null);
    this.interior.visible = true; renderer.shadowMap.autoUpdate = prevAuto;
  }
}
