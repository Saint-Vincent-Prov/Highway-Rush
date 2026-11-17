import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { THEMES, CARS, BASE_MAX, PAVE_HALF, ROAD_HALF, laneX, clamp, lerp } from './config.js';
import { World, frameBasis } from './world.js';
import { makeKit, makeVehicle, PROFILES } from './models.js';
import { Cockpit } from './cockpit.js';
import { Traffic } from './traffic.js';
import { Sfx, store } from './audio.js';

// ============================================================ renderer
const canvas = document.getElementById('game');
const hud = document.getElementById('hud'), hctx = hud.getContext('2d');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
const MAX_PR = Math.min(window.devicePixelRatio || 1, 1.5);
let pixelRatio = MAX_PR;
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
const kit = makeKit();
const world = new World(renderer, scene, kit);
const cockpit = new Cockpit(kit);
scene.add(cockpit.group);
const traffic = new Traffic(scene, kit);
let composer = null, bloomPass = null;
let W = 0, H = 0, DPR = 1;
function resize() {
  W = window.innerWidth; H = window.innerHeight; DPR = Math.min(2, window.devicePixelRatio || 1);
  renderer.setSize(W, H);
  hud.width = Math.round(W * DPR); hud.height = Math.round(H * DPR);
  cockpit.setAspect(W / H);
  if (composer) composer.setSize(W, H);
}
window.addEventListener('resize', resize);
Object.assign(window, { renderer, scene });

// ============================================================ state
const fmt = n => Math.floor(n).toLocaleString('en-US');
let theme = THEMES[0], carDef = CARS[0];
let state = 'loading';
let pS = 30, playerX = laneX(2), speed = 0, steer = 0, latV = 0;
let score = 0, distance = 0, playTime = 0, diff = 0, nearMisses = 0, combo = 0, comboT = 0;
let runDistC = 0, runCpC = 0, runNearC = 0, nextCp = 1;
const runCoins = () => Math.floor(runDistC + runCpC + runNearC);
const moneyMul = () => carDef.mult * theme.mult;
let shake = 0, flash = 0, crashT = 0, cracks = null, time = 0, popups = [], scraping = 0, onRumble = false, engineRpm = 0.12, gear = 1;
let best = 0, seed = (Math.random() * 1e9) | 0;

// ============================================================ save (account-backed with local copy)
const DEFAULT_SAVE = { v: 1, coins: 0, cars: ['rookie'], roads: ['sunset'], car: 'rookie', road: 'sunset', best: 0, bestKm: 0, runs: 0, updated: 0 };
function normalizeSave(src) {
  const d = JSON.parse(JSON.stringify(DEFAULT_SAVE));
  if (!src || typeof src !== 'object') return d;
  const num = v => (Number.isFinite(+v) && +v >= 0 ? Math.floor(+v) : 0);
  d.coins = num(src.coins); d.best = num(src.best); d.runs = num(src.runs); d.updated = num(src.updated);
  d.bestKm = Number.isFinite(+src.bestKm) ? Math.max(0, +src.bestKm) : 0;
  const ids = (arr, list, first) => { const ok = new Set([first]); if (Array.isArray(arr)) for (const x of arr) if (list.some(i => i.id === x)) ok.add(x); return [...ok]; };
  d.cars = ids(src.cars, CARS, 'rookie'); d.roads = ids(src.roads, THEMES, 'sunset');
  d.car = d.cars.includes(src.car) ? src.car : 'rookie';
  d.road = d.roads.includes(src.road) ? src.road : 'sunset';
  return d;
}
let save = normalizeSave(store.get('hr_save', null));
best = save.best;
const Cloud = {
  ref: null, writing: false, dirty: false, status: 'local',
  async init() {
    try {
      if (!window.claude || typeof window.claude.use !== 'function') return;
      const [user, db] = await Promise.all([window.claude.use('user'), window.claude.use('db')]);
      if (!user || !db) return;
      const id = await user.id();
      if (!id) return;
      this.ref = db.doc('data/users/' + id + '/save');
      const snap = await Promise.race([this.ref.get(), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000))]);
      this.status = 'cloud';
      if (snap && snap.exists) {
        const remote = normalizeSave(snap.data());
        if (remote.updated > save.updated) {
          save = remote; store.set('hr_save', save); best = Math.max(best, save.best);
          if (state === 'menu' || state === 'over') applySelections();
        } else if (save.updated > remote.updated) this.push();
      } else if (save.updated > 0) this.push();
      refreshUI();
    } catch (e) { this.ref = null; this.status = 'local'; }
  },
  push() {
    if (!this.ref) return;
    if (this.writing) { this.dirty = true; return; }
    this.writing = true;
    this.ref.set(JSON.parse(JSON.stringify(save)))
      .catch(e => { if (e && (e.code === 'invalid_argument' || e.code === 'revoked' || e.code === 'not_granted')) { this.ref = null; this.status = 'local'; refreshUI(); } })
      .finally(() => { this.writing = false; if (this.dirty && this.ref) { this.dirty = false; this.push(); } });
  },
};
function persist() { save.updated = Date.now(); store.set('hr_save', save); Cloud.push(); }

function setupComposer() {
  if (composer) { composer.dispose(); composer = null; bloomPass = null; }
  if (!theme.bloom) return;
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, cockpit.camera));
  bloomPass = new UnrealBloomPass(new THREE.Vector2(W, H), theme.bloom, 0.4, 0.9);
  composer.addPass(bloomPass);
  composer.addPass(new OutputPass());
  composer.setSize(W, H);
}
function applySelections() {
  const newCar = CARS.find(c => c.id === save.car) || CARS[0];
  const newTheme = THEMES.find(t => t.id === save.road) || THEMES[0];
  const themeChanged = newTheme !== theme || !world.track;
  carDef = newCar; theme = newTheme;
  if (themeChanged) { world.setTheme(theme, seed); setupComposer(); }
  cockpit.build(carDef, theme);
  resetRun(true);
  if (state === 'over') state = 'menu';
}

// ============================================================ run lifecycle
function resetRun(attract) {
  seed = (Math.random() * 1e9) | 0;
  world.reset(seed);
  traffic.clear();
  pS = 30; playerX = laneX(2); speed = attract ? 20 : 0; steer = 0; latV = 0;
  score = 0; distance = 0; playTime = 0; diff = 0; nearMisses = 0; combo = 0; comboT = 0;
  runDistC = 0; runCpC = 0; runNearC = 0; nextCp = 1;
  shake = 0; flash = 0; crashT = 0; cracks = null; popups = []; scraping = 0;
  world.update(0, pS, cockpit.camera.getWorldPosition(new THREE.Vector3()), 0);
  // initial traffic spread ahead and a few behind
  const n = Math.round(20 * theme.traffic);
  for (let i = 0; i < n; i++) {
    const s = pS + 70 + Math.random() * 1150, lane = (Math.random() * 4) | 0;
    if (traffic.cars.some(c => Math.abs(c.s - s) < 45 && c.lane === lane)) continue;
    traffic.spawn(s, lane, theme, false);
  }
}

// ============================================================ input
const keys = { left: false, right: false, up: false, down: false };
const touch = { left: false, right: false, brake: false };
let touchMode = false;
const KEYMAP = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right', ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', Space: 'down' };
window.addEventListener('keydown', e => {
  const k = KEYMAP[e.code];
  if (k) { keys[k] = true; e.preventDefault(); }
  if (e.repeat) return;
  if (e.code === 'KeyM') { toggleMute(); return; }
  if (shopOpen) { if (e.code === 'Escape' || e.code === 'KeyG') closeShop(); return; }
  if (e.code === 'KeyG' && (state === 'menu' || state === 'over')) { openShop(); return; }
  if (e.code === 'Enter' || (e.code === 'Space' && state === 'over')) {
    if (state === 'menu' || state === 'over') startGame();
    else if (state === 'paused') resume();
  }
  if (e.code === 'KeyP' || e.code === 'Escape') { if (state === 'play') pause(); else if (state === 'paused') resume(); }
});
window.addEventListener('keyup', e => { const k = KEYMAP[e.code]; if (k) { keys[k] = false; e.preventDefault(); } });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; if (state === 'play') pause(); });
document.addEventListener('visibilitychange', () => { if (document.hidden && state === 'play') pause(); });
function bindTouch(id, prop) {
  const el = document.getElementById(id);
  const on = e => { e.preventDefault(); touch[prop] = true; el.classList.add('down'); if (el.setPointerCapture) try { el.setPointerCapture(e.pointerId); } catch (_) {} };
  const off = e => { e.preventDefault(); touch[prop] = false; el.classList.remove('down'); };
  el.addEventListener('pointerdown', on);
  el.addEventListener('pointerup', off); el.addEventListener('pointercancel', off); el.addEventListener('lostpointercapture', off);
}
bindTouch('tl', 'left'); bindTouch('tr', 'right'); bindTouch('tb', 'brake');
function enableTouch() { if (touchMode) return; touchMode = true; document.getElementById('touch').classList.add('on'); }
if (window.matchMedia && matchMedia('(pointer: coarse)').matches) enableTouch();
window.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') enableTouch(); }, { passive: true });

// ============================================================ UI
const $ = id => document.getElementById(id);
const menuEl = $('menu'), pauseEl = $('pause'), overEl = $('over'), shopEl = $('shop');
let shopOpen = false, shopTab = 'cars';
function nextUnlock() {
  return CARS.filter(c => !save.cars.includes(c.id)).map(c => ({ ...c, kind: 'car' }))
    .concat(THEMES.filter(t => !save.roads.includes(t.id)).map(t => ({ ...t, kind: 'road' })))
    .sort((a, b) => a.price - b.price)[0] || null;
}
function refreshUI() {
  $('menuWallet').textContent = `$ ${fmt(save.coins)}`;
  $('menuSel').textContent = `Car: ${carDef.name} · Road: ${theme.name} · Pay ×${moneyMul().toFixed(2)}`;
  $('menuBest').textContent = best > 0 ? `Best score: ${fmt(best)} · Best distance: ${save.bestKm.toFixed(2)} km` : '';
  $('shopWallet').textContent = `$ ${fmt(save.coins)}`;
  $('saveNote').textContent = Cloud.status === 'cloud' ? 'Progress is saved to your account.' : 'Progress is saved in this browser.';
  const n = nextUnlock(), el = $('oNext');
  if (!n) el.innerHTML = '🏆 You own every car and road!';
  else if (save.coins >= n.price) el.innerHTML = `🔓 You can buy the <b>${n.name}</b> now. Open the Garage!`;
  else el.innerHTML = `Next unlock: <b>${n.name}</b> (${n.kind}) · $${fmt(n.price - save.coins)} to go<div class="bar"><i style="width:${Math.min(100, save.coins / n.price * 100).toFixed(1)}%"></i></div>`;
}
function startGame() {
  if (shopOpen) return;
  Sfx.init();
  resetRun(false);
  state = 'play';
  menuEl.classList.add('hidden'); overEl.classList.add('hidden'); pauseEl.classList.add('hidden');
}
function pause() { state = 'paused'; pauseEl.classList.remove('hidden'); Sfx.engine(0, 0, false, 0); Sfx.scrape(0, 1000); }
function resume() { Sfx.init(); state = 'play'; pauseEl.classList.add('hidden'); }
function toggleMute() { Sfx.setMuted(!Sfx.muted); $('mute').textContent = Sfx.muted ? '🔇' : '🔊'; }
function openShop() { Sfx.init(); shopOpen = true; menuEl.classList.add('hidden'); overEl.classList.add('hidden'); shopEl.classList.remove('hidden'); renderShop(); }
function closeShop() { shopOpen = false; shopEl.classList.add('hidden'); refreshUI(); (state === 'over' ? overEl : menuEl).classList.remove('hidden'); }

// ---- garage previews: cars rendered in 3D in a small studio
let studio = null;
function studioRender(def) {
  if (!studio) {
    const r = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    r.setSize(480, 270, false); r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.0; r.shadowMap.enabled = true;
    const sc = new THREE.Scene(); sc.background = new THREE.Color(0x10131c); sc.fog = new THREE.Fog(0x10131c, 9, 16);
    const pm = new THREE.PMREMGenerator(r); sc.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture; sc.environmentIntensity = 0.75;
    const floor = new THREE.Mesh(new THREE.CircleGeometry(9, 48), new THREE.MeshStandardMaterial({ color: 0x0c0e14, roughness: 0.45, metalness: 0.3 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; sc.add(floor);
    const key = new THREE.DirectionalLight(0xffffff, 2.2); key.position.set(-4, 7, -3); key.castShadow = true; key.shadow.mapSize.set(1024, 1024);
    const ksc = key.shadow.camera; ksc.left = ksc.bottom = -4; ksc.right = ksc.top = 4; sc.add(key);
    const cam = new THREE.PerspectiveCamera(28, 16 / 9, 0.1, 100); cam.position.set(-4.6, 1.7, -5.2); cam.lookAt(0, 0.5, -0.1);
    studio = { r, sc, cam, car: null };
  }
  if (studio.car) studio.sc.remove(studio.car.group);
  const v = makeVehicle(def.body, def.paint, kit, { stripes: def.stripes, metal: def.metal });
  v.group.traverse(o => { if (o.isMesh) o.castShadow = true; });
  studio.sc.add(v.group); studio.car = v;
  const wasNight = kit.night; kit.setNight(false);
  studio.r.render(studio.sc, studio.cam);
  kit.setNight(wasNight);
  return studio.r.domElement;
}
const ROAD_PREVIEW = {
  sunset: ['#3d5aa8', '#f2a07a', '#4f7a3a'], desert: ['#3f86d6', '#f3d7a8', '#d0ab7a'], night: ['#03050d', '#262b55', '#16181f'],
  snow: ['#7d93b5', '#e8edf3', '#eef2f7'], neon: ['#07021a', '#c0237a', '#1e0632'],
};
function drawRoadPreview(cv, t) {
  const w = cv.width = 480, h = cv.height = 270, c = cv.getContext('2d'), [top, hor, ground] = ROAD_PREVIEW[t.id];
  const hy = h * 0.5, g = c.createLinearGradient(0, 0, 0, hy); g.addColorStop(0, top); g.addColorStop(1, hor);
  c.fillStyle = g; c.fillRect(0, 0, w, hy);
  c.fillStyle = ground; c.fillRect(0, hy, w, h - hy);
  if (t.id === 'night') { c.fillStyle = '#0c1020'; for (let i = 0; i < 24; i++) { const bw = 14 + (i * 37) % 26, bh = 20 + (i * 53) % 70; c.fillRect(i * 21, hy - bh, bw, bh); } c.fillStyle = '#ffd27a'; for (let i = 0; i < 160; i++) c.fillRect((i * 97) % w, hy - ((i * 31) % 70), 2, 2); }
  if (t.id === 'snow' || t.id === 'sunset' || t.id === 'desert') { c.fillStyle = t.id === 'snow' ? '#dfe7f1' : t.id === 'desert' ? '#b9704e' : '#6e6290'; c.beginPath(); c.moveTo(0, hy); for (let x = 0; x <= w; x += 12) c.lineTo(x, hy - 18 - 22 * Math.abs(Math.sin(x / 47) + Math.sin(x / 19) * 0.4)); c.lineTo(w, hy); c.fill(); }
  if (t.id === 'neon') { c.fillStyle = '#ffd319'; c.beginPath(); c.arc(w / 2, hy - 8, 40, Math.PI, 0); c.fill(); c.strokeStyle = '#ff2a8a'; c.lineWidth = 1; for (let y = hy; y < h; y += 10) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); } }
  c.fillStyle = t.id === 'neon' ? '#17121f' : '#3d3d40';
  c.beginPath(); c.moveTo(w * 0.47, hy); c.lineTo(w * 0.53, hy); c.lineTo(w * 0.95, h); c.lineTo(w * 0.05, h); c.fill();
  c.strokeStyle = t.id === 'neon' ? '#40f4ff' : '#eee'; c.lineWidth = 2; c.setLineDash([10, 14]);
  for (const o of [-0.5, 0, 0.5]) { c.beginPath(); c.moveTo(w / 2 + o * w * 0.03, hy); c.lineTo(w / 2 + o * w * 0.45, h); c.stroke(); }
  c.setLineDash([]);
}
function statBar(label, frac) { return `<span>${label}</span><div class="b"><i style="width:${Math.round(clamp(frac, 0.05, 1) * 100)}%"></i></div>`; }
function renderShop() {
  $('shopWallet').textContent = `$ ${fmt(save.coins)}`;
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === shopTab));
  const grid = $('shopGrid'); grid.innerHTML = '';
  const isCar = shopTab === 'cars', list = isCar ? CARS : THEMES;
  const owned = isCar ? save.cars : save.roads, cur = isCar ? save.car : save.road;
  for (const it of list) {
    const card = document.createElement('div');
    card.className = 'card' + (it.id === cur ? ' selected' : '');
    const cv = document.createElement('canvas'); card.appendChild(cv);
    if (isCar) { cv.width = 480; cv.height = 270; try { cv.getContext('2d').drawImage(studioRender(it), 0, 0); } catch (e) { /* preview optional */ } }
    else drawRoadPreview(cv, it);
    const info = document.createElement('div');
    let tags = `<span class="tag gold">Pay ×${it.mult.toFixed(2)}</span>`;
    if (!isCar) {
      tags += `<span class="tag">Traffic ${it.traffic > 1 ? '+' + Math.round((it.traffic - 1) * 100) + '%' : 'normal'}</span>`;
      if (it.grip < 1) tags += `<span class="tag">❄ Slippery</span>`;
      if (it.night) tags += `<span class="tag">🌙 Night</span>`;
    }
    info.innerHTML = `<h3>${it.name}</h3><div class="d">${it.desc}</div>` +
      (isCar ? `<div class="st">${statBar('Top speed', it.top / 1.45)}${statBar('Accel', it.accel / 1.8)}${statBar('Handling', it.handling / 1.5)}</div>` : '') +
      `<div class="tagrow" style="margin-top:6px">${tags}</div>`;
    card.appendChild(info);
    const btn = document.createElement('button');
    const have = owned.includes(it.id);
    if (have && it.id === cur) { btn.textContent = '✓ SELECTED'; btn.disabled = true; }
    else if (have) { btn.textContent = 'SELECT'; btn.className = 'pick'; }
    else { btn.textContent = `BUY  $${fmt(it.price)}`; btn.className = 'buy'; btn.disabled = save.coins < it.price; }
    btn.addEventListener('click', () => {
      if (!owned.includes(it.id)) { if (save.coins < it.price) return; save.coins -= it.price; owned.push(it.id); Sfx.cash(); }
      if (isCar) save.car = it.id; else save.road = it.id;
      persist(); applySelections(); renderShop();
    });
    card.appendChild(btn);
    if (!have && save.coins < it.price) { const nd = document.createElement('div'); nd.className = 'need'; nd.textContent = `$${fmt(it.price - save.coins)} more needed`; card.appendChild(nd); }
    grid.appendChild(card);
  }
}
document.querySelectorAll('.tab').forEach(t => t.addEventListener('click', () => { shopTab = t.dataset.tab; renderShop(); }));
$('shopBack').addEventListener('click', closeShop);
$('menuShopBtn').addEventListener('click', openShop);
$('overShopBtn').addEventListener('click', openShop);
$('startBtn').addEventListener('click', startGame);
$('restartBtn').addEventListener('click', startGame);
$('resumeBtn').addEventListener('click', resume);
$('mute').addEventListener('click', e => { e.stopPropagation(); Sfx.init(); toggleMute(); e.currentTarget.blur(); });
$('mute').textContent = Sfx.muted ? '🔇' : '🔊';

function showGameOver() {
  state = 'over';
  const isNew = Math.floor(score) > best && score >= 1;
  if (isNew) best = Math.floor(score);
  const earned = runCoins();
  save.coins += earned; save.runs++; save.best = Math.max(save.best, Math.floor(best));
  save.bestKm = Math.max(save.bestKm, Math.round(distance) / 1000);
  persist();
  $('oScore').textContent = fmt(score); $('oBest').textContent = fmt(best);
  $('oDist').textContent = (distance / 1000).toFixed(2) + ' km'; $('oNear').textContent = nearMisses;
  $('oNew').textContent = isNew ? '★ New best score! ★' : '';
  $('oEarn').textContent = `+$${fmt(earned)}`;
  $('oEarnBreak').textContent = `Distance $${fmt(runDistC)} · Checkpoints $${fmt(runCpC)} · Close calls $${fmt(runNearC)}`;
  $('oWallet').textContent = `Wallet: $${fmt(save.coins)}`;
  refreshUI();
  overEl.classList.remove('hidden');
}

// ============================================================ simulation
function crash(car) {
  state = 'crashing'; crashT = 0; shake = 1; flash = 1;
  Sfx.crash(); Sfx.scrape(0, 1000);
  car.base = 0; car.speed *= 0.3;
  const cx = W / 2 - clamp(car.x - playerX, -3, 3) * W * 0.12, cy = H * (0.3 + Math.random() * 0.1);
  const rays = [], rings = [], nr = 13 + (Math.random() * 5 | 0);
  for (let i = 0; i < nr; i++) {
    let a = (i / nr) * Math.PI * 2 + Math.random() * 0.3, r = 0, x = cx, y = cy;
    const pts = [[x, y]], maxR = Math.max(W, H) * (0.25 + Math.random() * 0.45);
    while (r < maxR) { r += 18 + Math.random() * 40; a += (Math.random() - 0.5) * 0.35; x = cx + Math.cos(a) * r; y = cy + Math.sin(a) * r; pts.push([x, y]); }
    rays.push(pts);
  }
  for (let k = 1; k <= 3; k++) { const rr = k * (30 + Math.random() * 20); for (let i = 0; i < nr; i++) if (Math.random() < 0.7) { const a0 = (i / nr) * Math.PI * 2, a1 = ((i + 1) / nr) * Math.PI * 2; rings.push([cx + Math.cos(a0) * rr, cy + Math.sin(a0) * rr * 0.9, cx + Math.cos(a1) * rr * 1.05, cy + Math.sin(a1) * rr]); } }
  cracks = { cx, cy, rays, rings };
}

const _f = {}, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _yaw = new THREE.Quaternion(), UP = new THREE.Vector3(0, 1, 0), _cam = new THREE.Vector3();
function update(dt) {
  time += dt;
  const p = PROFILES[carDef.body], pL = p.L, pW = p.W;
  if (state === 'play') {
    playTime += dt; diff = Math.min(1, playTime / 150);
    const gas = keys.up || (touchMode && !touch.brake && !keys.down), brake = keys.down || touch.brake;
    const maxSpeed = BASE_MAX * carDef.top * (1 + 0.25 * diff);
    if (brake) speed -= 13 * dt;
    else if (gas) speed += (speed < BASE_MAX * 0.5 ? 7.5 : 4.2) * carDef.accel * dt;
    else speed -= 1.6 * dt;
    if (speed > maxSpeed) speed = Math.max(maxSpeed, speed - 6 * dt);
    speed = Math.max(0, speed);
    const target = ((keys.left || touch.left) ? -1 : 0) + ((keys.right || touch.right) ? 1 : 0);
    steer += (target - steer) * Math.min(1, dt * 8 * theme.grip);
    const sp = speed / BASE_MAX;
    latV = steer * 6.8 * (0.7 + 0.3 * carDef.handling) * Math.min(1, 0.3 + sp);
    playerX += latV * dt;
    const lim = PAVE_HALF - pW / 2 - 0.12;
    scraping = 0;
    if (Math.abs(playerX) > lim) { playerX = Math.sign(playerX) * lim; latV = 0; if (speed > 3) { scraping = 1; speed -= speed * 0.9 * dt; shake = Math.max(shake, 0.35); } }
    const wl = Math.abs(playerX) + pW / 2 - 0.2;
    onRumble = wl > ROAD_HALF + 0.1 && Math.abs(playerX) - pW / 2 + 0.2 < ROAD_HALF + 0.6 && speed > 3;
    if (onRumble) shake = Math.max(shake, 0.22);
    score += speed * dt * 0.42;
    distance += speed * dt;
    runDistC += speed * dt * 0.06 * (1 + 0.15 * distance / 1000) * moneyMul();
    if (distance >= nextCp * 1000) {
      const bonus = Math.round(25 * nextCp * moneyMul());
      runCpC += bonus; popups.push({ text: `${nextCp} KM CHECKPOINT`, sub: `+$${bonus}`, t: 0, gold: true }); Sfx.cash(); nextCp++;
    }
    comboT -= dt; if (comboT <= 0) combo = 0;
    for (const car of traffic.cars) {
      const r = car.s - pS, half = (car.len + pL) / 2;
      if (r > 0 && r < 500) car.wasAhead = true;
      const gapX = Math.abs(car.x - playerX) - (car.w + pW) / 2;
      if (Math.abs(r) < half - 0.25 && gapX < -0.12) { crash(car); break; }
      if (car.wasAhead && r < -half) {
        car.wasAhead = false;
        if (gapX < 0.8 && speed > car.speed + 5) {
          nearMisses++; combo++; comboT = 3;
          const bonus = Math.round((100 + 150 * sp) * combo / 10) * 10, cash = Math.round(5 * combo * moneyMul());
          score += bonus; runNearC += cash;
          popups.push({ text: combo > 1 ? `CLOSE CALL ×${combo}` : 'CLOSE CALL', sub: `+${bonus} pts · +$${cash}`, t: 0 });
          Sfx.whoosh(); Sfx.beep();
        }
      }
    }
  } else if (state === 'crashing') {
    crashT += dt; speed = Math.max(0, speed - 40 * dt); steer *= 0.9; latV *= 0.9;
    if (crashT > 1.2) showGameOver();
  } else if (state === 'menu' || state === 'loading') {
    speed += (22 - speed) * Math.min(1, dt * 0.5); latV = 0; steer *= 0.9;
  }
  if (state !== 'paused') {
    traffic.update(dt, { pS, playerX, playerSpeed: speed, playerLen: pL, diff, theme });
    pS += speed * dt;
  }
  // place the player's car on the road
  const f = world.track.frame(pS, _f);
  frameBasis(f, _m); _q.setFromRotationMatrix(_m);
  _yaw.setFromAxisAngle(UP, -Math.atan2(latV, Math.max(speed, 6)) * 0.7); _q.multiply(_yaw);
  cockpit.group.position.set(f.x + Math.cos(f.h) * playerX, f.y, f.z + Math.sin(f.h) * playerX);
  cockpit.group.quaternion.copy(_q);
  cockpit.camera.getWorldPosition(_cam);
  world.update(dt, pS, _cam, time);
  traffic.manage({ pS, playerSpeed: speed, diff, theme, fogFar: theme.fog.far }, world.track, time);
  shake = Math.max(0, shake - dt * (state === 'crashing' ? 0.8 : 2.5));
  flash = Math.max(0, flash - dt * 2.2);
  for (const pp of popups) pp.t += dt;
  popups = popups.filter(pp => pp.t < 1.3);
  // engine + gauges
  const sf = speed / (BASE_MAX * carDef.top), gearW = 0.2;
  gear = Math.min(6, Math.floor(sf / gearW) + 1);
  const rpm = speed < 1 ? 0.1 : clamp(0.25 + 0.75 * ((sf - (gear - 1) * gearW) / gearW), 0, 1);
  engineRpm = lerp(engineRpm, rpm, Math.min(1, dt * 10));
  const live = state === 'play';
  Sfx.engine(engineRpm, (keys.up || touchMode) && live ? 1 : 0.2, live, sf);
  Sfx.scrape(live ? (scraping ? 0.45 : onRumble ? 0.18 : 0) : 0, scraping ? 2600 : 180);
  cockpit.update(dt, { steer, kmh: speed * 3.6, rpm: engineRpm * 0.95, gear: speed < 1 ? 'N' : String(gear), km: distance / 1000,
    shake: shake * 3, crash: state === 'crashing' ? Math.max(0, 1 - crashT) : 0, time, speedFrac: speed / BASE_MAX, lateral: latV / 6.8 });
}

// ============================================================ HUD (2D overlay)
function drawHud() {
  const c = hctx;
  c.setTransform(DPR, 0, 0, DPR, 0, 0); c.clearRect(0, 0, W, H);
  if (cracks) {
    c.save(); c.lineJoin = 'round';
    for (const [lw, col] of [[3.2, 'rgba(0,0,0,.35)'], [1.3, 'rgba(240,248,255,.9)']]) {
      c.lineWidth = lw; c.strokeStyle = col; c.beginPath();
      for (const r of cracks.rays) { c.moveTo(r[0][0], r[0][1]); for (let i = 1; i < r.length; i++) c.lineTo(r[i][0], r[i][1]); }
      for (const sg of cracks.rings) { c.moveTo(sg[0], sg[1]); c.lineTo(sg[2], sg[3]); }
      c.stroke();
    }
    c.restore();
  }
  if (flash > 0) { c.fillStyle = `rgba(255,255,255,${flash * 0.7})`; c.fillRect(0, 0, W, H); }
  if (state === 'menu' || state === 'loading') return;
  const fs = clamp(Math.min(W, H) / 26, 13, 26), y = 14;
  c.textBaseline = 'top'; c.shadowColor = 'rgba(0,0,0,.7)'; c.shadowBlur = 6;
  c.textAlign = 'left'; c.font = `800 italic ${fs}px system-ui`; c.fillStyle = '#fff'; c.fillText(fmt(score), 16, y);
  c.font = `600 ${fs * 0.5}px system-ui`; c.fillStyle = '#ffd9a8'; c.fillText('SCORE', 16, y + fs * 1.1);
  c.font = `800 ${fs * 0.85}px system-ui`; c.fillStyle = '#ffd36b'; c.fillText(`$ ${fmt(runCoins())}`, 16, y + fs * 1.85);
  c.font = `600 ${fs * 0.45}px system-ui`; c.fillStyle = '#e8d9b8'; c.fillText(`×${(moneyMul() * (1 + 0.15 * distance / 1000)).toFixed(2)} PAY RATE`, 16, y + fs * 2.85);
  c.textAlign = 'right'; c.font = `800 italic ${fs}px system-ui`; c.fillStyle = '#fff'; c.fillText((distance / 1000).toFixed(1) + ' km', W - 62, y);
  c.font = `600 ${fs * 0.5}px system-ui`; c.fillStyle = '#ffd9a8'; c.fillText(`BEST ${fmt(Math.max(best, score))}`, W - 62, y + fs * 1.1);
  for (const pp of popups) {
    const a = 1 - pp.t / 1.3, py = H * 0.22 - pp.t * 40;
    c.globalAlpha = Math.min(1, a * 2); c.textAlign = 'center';
    c.font = `900 italic ${fs * 1.2}px system-ui`; c.fillStyle = '#ffd36b'; c.fillText(pp.text, W / 2, py);
    c.font = `800 ${fs * 0.8}px system-ui`; c.fillStyle = pp.gold ? '#ffe9a8' : '#fff'; c.fillText(pp.sub, W / 2, py + fs * 1.35);
  }
  c.globalAlpha = 1;
  if (state === 'play' && playTime < 4) {
    c.globalAlpha = Math.min(1, 4 - playTime); c.textAlign = 'center'; c.font = `700 ${fs * 0.7}px system-ui`; c.fillStyle = '#fff';
    c.fillText(touchMode ? 'Steer with ◀ ▶ · hold BRAKE to slow' : 'Hold ↑ to accelerate · ← → to steer', W / 2, H * 0.14);
    c.globalAlpha = 1;
  }
  c.shadowBlur = 0;
}

// ============================================================ loop
const timer = new THREE.Timer(); timer.connect(document);
let frameAvg = 16, prTimer = 0;
function frame() {
  timer.update();
  const dt = Math.min(Math.max(timer.getDelta(), 0), 0.05);
  if (state !== 'loading' || world.track) update(dt);
  cockpit.renderMirror(renderer, scene);
  if (composer) composer.render(); else renderer.render(scene, cockpit.camera);
  drawHud();
  // adaptive resolution: keep the frame rate up on slower devices
  frameAvg = lerp(frameAvg, dt * 1000, 0.05); prTimer += dt;
  if (prTimer > 2) {
    prTimer = 0;
    if (frameAvg > 28 && pixelRatio > 0.6) { pixelRatio = Math.max(0.6, pixelRatio - 0.15); renderer.setPixelRatio(pixelRatio); if (composer) composer.setPixelRatio(pixelRatio); }
    else if (frameAvg < 15 && pixelRatio < MAX_PR) { pixelRatio = Math.min(MAX_PR, pixelRatio + 0.1); renderer.setPixelRatio(pixelRatio); if (composer) composer.setPixelRatio(pixelRatio); }
  }
}

// ============================================================ boot
resize();
try {
  applySelections();
  state = 'menu';
  $('loading').classList.add('hidden'); menuEl.classList.remove('hidden');
} catch (e) {
  $('loadMsg').textContent = 'Could not start 3D graphics on this device: ' + (e && e.message ? e.message : e);
  throw e;
}
refreshUI();
Cloud.init();
renderer.setAnimationLoop(frame);
window.__hr = { get pS() { return pS; }, get state() { return state; }, get speed() { return speed; }, get cars() { return traffic.cars.length; }, get score() { return score; },
  get coins() { return runCoins(); }, get distance() { return distance; }, get save() { return save; }, keys,
  get info() { return { calls: renderer.info.render.calls, tris: renderer.info.render.triangles, pr: pixelRatio, frameAvg }; } };
