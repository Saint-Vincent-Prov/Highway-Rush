// Endless road centre-line: sampled every DS metres, generated ahead on demand.
// Each sample: heading h (rad, 0 = -Z), curvature k, position x/y/z.
import { mulberry32, clamp } from './config.js';

export const DS = 2;

export class Track {
  constructor(seed) {
    this.rng = mulberry32(seed);
    this.base = 0;               // index of pts[0] (old samples are trimmed)
    this.pts = [];
    this.sec = null;
    this.phase = [this.rng() * 100, this.rng() * 100, this.rng() * 100];
    this.h = 0; this.x = 0; this.z = 0; this.k = 0;
    this.push();
  }
  elev(s) {
    const ramp = clamp((s - 150) / 400, 0, 1);
    const p = this.phase;
    return ramp * (7 * Math.sin(s / 310 + p[0]) + 3.6 * Math.sin(s / 137 + p[1]) + 1.1 * Math.sin(s / 61 + p[2]));
  }
  newSection() {
    const r = this.rng;
    const startStraight = this.pts.length + this.base < 150;
    if (startStraight || r() < 0.35) this.sec = { len: 150 + r() * 350, k: 0 };
    else {
      const radius = 480 + r() * 1400;
      this.sec = { len: 180 + r() * 520, k: (r() < 0.5 ? -1 : 1) / radius };
    }
    this.sec.pos = 0; this.sec.k0 = this.k;
  }
  push() {
    const s = (this.base + this.pts.length) * DS;
    this.pts.push({ s, x: this.x, y: this.elev(s), z: this.z, h: this.h, k: this.k });
  }
  step() {
    if (!this.sec || this.sec.pos >= this.sec.len) this.newSection();
    const sc = this.sec, t = sc.pos / sc.len;
    // ease curvature in over the first 30 % and out over the last 30 %
    const ein = Math.min(1, t / 0.3), eout = Math.min(1, (1 - t) / 0.3);
    const blend = sc.k === 0 ? 0 : Math.min(ein, eout);
    const target = sc.k * (blend * blend * (3 - 2 * blend));
    this.k = sc.k === 0 ? sc.k0 * Math.max(0, 1 - sc.pos / 60) : (t < 0.3 ? sc.k0 + (target - sc.k0) * ein : target);
    sc.pos += DS;
    this.h += this.k * DS;
    this.x += Math.sin(this.h) * DS;
    this.z -= Math.cos(this.h) * DS;
    this.push();
  }
  ensure(sMax) { while ((this.base + this.pts.length - 1) * DS < sMax) this.step(); }
  trim(sMin) {
    const drop = Math.floor(sMin / DS) - this.base - 2;
    if (drop > 500) { this.pts.splice(0, drop); this.base += drop; }
  }
  // Interpolated frame at distance s: position, heading, grade.
  frame(s, out) {
    const f = s / DS - this.base;
    let i = Math.floor(f); i = clamp(i, 0, this.pts.length - 2);
    const t = clamp(f - i, 0, 1), a = this.pts[i], b = this.pts[i + 1];
    out.x = a.x + (b.x - a.x) * t; out.y = a.y + (b.y - a.y) * t; out.z = a.z + (b.z - a.z) * t;
    out.h = a.h + (b.h - a.h) * t; out.k = a.k + (b.k - a.k) * t;
    out.g = (b.y - a.y) / DS;
    return out;
  }
  // World point at distance s, lateral offset d (m, + = right), height above road yo.
  point(s, d, yo, out) {
    const f = this.frame(s, out);
    const c = Math.cos(f.h), sn = Math.sin(f.h);
    out.x = f.x + c * d; out.z = f.z + sn * d; out.y = f.y + (yo || 0);
    return out;
  }
}
