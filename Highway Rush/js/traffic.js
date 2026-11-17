// Traffic: lane-keeping AI with following distance, overtaking, signalled lane changes and brake lights.
import * as THREE from 'three';
import { laneX, LANES, BASE_MAX, TRAFFIC_COLORS, TRUCK_COLORS } from './config.js';
import { makeVehicle } from './models.js';
import { frameBasis } from './world.js';

const pick = a => a[(Math.random() * a.length) | 0];
const _f = {}, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _yaw = new THREE.Quaternion(), _p = new THREE.Vector3(), UP = new THREE.Vector3(0, 1, 0);

export class Traffic {
  constructor(scene, kit) {
    this.scene = scene; this.kit = kit; this.cars = []; this.pool = new Map();
  }
  clear() { for (const c of this.cars) this.release(c); this.cars = []; }
  release(c) { this.scene.remove(c.model.group); if (!this.pool.has(c.type)) this.pool.set(c.type, []); this.pool.get(c.type).push(c.model); }
  model(type, color, trailer) {
    const list = this.pool.get(type);
    let m = list && list.pop();
    if (!m) m = makeVehicle(type, color, this.kit, { trailerColor: trailer, metal: 0.45 });
    m.group.children[0].material = this.kit.paint(color, 0.45);
    if (type === 'truck') m.group.children[1].material = this.kit.trailer(trailer);
    this.scene.add(m.group);
    return m;
  }
  spawn(s, lane, theme, behindFast) {
    const truck = Math.random() < (theme.trucks || 0.15);
    const type = truck ? 'truck' : pick(['sedan', 'sedan', 'sedan', 'hatch', 'hatch', 'hatch', 'suv', 'suv', 'van']);
    const color = truck ? pick([0xf2f2f2, 0x1e2f4f, 0xb81e1e, 0xe8b018]) : pick(TRAFFIC_COLORS);
    const model = this.model(type, color, truck ? pick(TRUCK_COLORS) : 0);
    let base = BASE_MAX * (truck ? 0.38 + Math.random() * 0.08 : 0.44 + (LANES - 1 - lane) * 0.07 + Math.random() * 0.1);
    if (behindFast) base = Math.max(base, BASE_MAX * 0.62);
    const c = {
      s, lane, targetLane: lane, x: laneX(lane), base, speed: base, type, model,
      len: model.dims.L, w: model.dims.W, blink: 0, moving: false, changing: false,
      cooldown: 2 + Math.random() * 5, braking: false, wasAhead: false, latV: 0, wheelPhase: 0,
    };
    this.cars.push(c);
    return c;
  }
  laneClear(car, lane, objs) {
    const off = laneX(lane);
    for (const o of objs) {
      if (o === car) continue;
      const inLane = Math.abs(o.x - off) < 2.6 || (o.changing && o.targetLane === lane);
      if (!inLane) continue;
      const d = o.s - car.s, half = (car.len + o.len) / 2;
      const closing = Math.max(0, o.speed - car.speed) * (o.isPlayer ? 1.9 : 1.3);
      if (d < half + 8 && d > -(half + 8 + closing)) return false;
    }
    return true;
  }
  tryLane(car, objs, random) {
    const opts = [car.lane - 1, car.lane + 1].filter(l => l >= 0 && l < LANES);
    if (Math.random() < 0.5) opts.reverse();
    for (const l of opts) if (this.laneClear(car, l, objs)) { car.targetLane = l; car.changing = true; car.moving = false; car.blink = random ? 1.3 : 0.9; return; }
    car.cooldown = 0.8;
  }
  update(dt, g) {
    const { pS, playerX, playerSpeed, playerLen, diff, theme, aiOnly } = g;
    const pobj = { isPlayer: true, s: pS, len: playerLen, x: playerX, speed: playerSpeed, changing: false };
    const objs = this.cars.concat(pobj);
    for (const car of this.cars) {
      let ahead = null, gap = Infinity;
      const tx = laneX(car.targetLane);
      for (const o of objs) {
        if (o === car) continue;
        if (Math.abs(o.x - car.x) > 2.3 && !(car.moving && Math.abs(o.x - tx) < 2.3)) continue;
        const d = (o.s - o.len / 2) - (car.s + car.len / 2);
        if (d > -car.len * 0.5 && d < 80 && d < gap) { gap = d; ahead = o; }
      }
      let desired = car.base;
      if (ahead) {
        if (ahead.speed < car.speed + 1 && !car.changing && car.cooldown <= 0 && gap < 70) this.tryLane(car, objs, false);
        if (gap < 55) desired = Math.min(car.base, ahead.speed + (gap - 9) * 0.55);
      }
      desired = Math.max(0, desired);
      car.braking = desired < car.speed - 0.6 || car.speed < 0.5;
      car.speed = car.speed < desired ? Math.min(desired, car.speed + 2.6 * dt) : Math.max(desired, car.speed - 9 * dt);
      car.cooldown -= dt;
      if (!car.changing && car.cooldown <= 0 && Math.random() < dt * (0.03 + 0.12 * diff)) this.tryLane(car, objs, true);
      let lat = 0;
      if (car.changing) {
        if (!car.moving) {
          car.blink -= dt;
          if (car.blink <= 0) { if (this.laneClear(car, car.targetLane, objs)) car.moving = true; else { car.changing = false; car.cooldown = 1.5; } }
        } else {
          const step = (car.type === 'truck' ? 1.0 : 1.55) * dt;
          if (Math.abs(tx - car.x) <= step) { car.x = tx; car.lane = car.targetLane; car.moving = false; car.changing = false; car.cooldown = 3 + Math.random() * 6; }
          else { lat = Math.sign(tx - car.x) * step / dt; car.x += Math.sign(tx - car.x) * step; }
        }
      }
      car.latV += (lat - car.latV) * Math.min(1, dt * 4);
      car.s += car.speed * dt;
    }
    void aiOnly;
  }
  // Remove cars far away, keep density, place meshes on the road.
  manage(g, track, time) {
    const { pS, playerSpeed, diff, theme, fogFar } = g;
    for (let i = this.cars.length - 1; i >= 0; i--) {
      const c = this.cars[i];
      if (c.s < pS - 260 || c.s > pS + 1400) { this.release(c); this.cars.splice(i, 1); }
    }
    const target = Math.round((16 + 24 * diff) * theme.traffic * 1.45);
    let tries = 0;
    while (this.cars.length < target && tries++ < 6) {
      const behind = playerSpeed < 22 && Math.random() < 0.35;
      const s = behind ? pS - 200 - Math.random() * 40 : pS + 900 + Math.random() * 380;
      const lane = (Math.random() * LANES) | 0;
      if (this.cars.some(c => Math.abs(c.s - s) < 45 && Math.abs(c.x - laneX(lane)) < 2.5)) continue;
      this.spawn(s, lane, theme, behind);
    }
    for (const c of this.cars) {
      const vis = c.s - pS < fogFar + 30 && c.s - pS > -240;
      c.model.group.visible = vis;
      if (!vis) continue;
      const f = track.frame(c.s, _f);
      frameBasis(f, _m);
      _q.setFromRotationMatrix(_m);
      _yaw.setFromAxisAngle(UP, -Math.atan2(c.latV, Math.max(c.speed, 4)));
      _q.multiply(_yaw);
      _p.set(f.x + Math.cos(f.h) * c.x, f.y, f.z + Math.sin(f.h) * c.x);
      c.model.group.position.copy(_p); c.model.group.quaternion.copy(_q);
      const on = c.changing && (time * 2.6) % 1 < 0.55;
      const left = c.targetLane < c.lane;
      c.model.blinkL.visible = on && left; c.model.blinkR.visible = on && !left;
      c.model.tail.emissiveIntensity = c.braking ? 5 : (theme.night ? 1.6 : 0.3);
    }
  }
}
