// Procedural canvas textures (no image files): asphalt with markings, ground tiles, plates, windows, glows.
import * as THREE from 'three';
import { PAVE_HALF, ROAD_HALF, LANE_W, LANES, ROAD_TEX_LEN, mulberry32, fbm } from './config.js';

const canvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
function tex(c, { srgb = true, repeat = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = aniso;
  t.needsUpdate = true;
  return t;
}
function grain(ctx, w, h, amt, seed, tile = true) {
  const img = ctx.getImageData(0, 0, w, h), d = img.data, r = mulberry32(seed);
  for (let i = 0; i < d.length; i += 4) {
    const n = (r() - 0.5) * amt;
    d[i] = Math.max(0, Math.min(255, d[i] + n)); d[i + 1] = Math.max(0, Math.min(255, d[i + 1] + n)); d[i + 2] = Math.max(0, Math.min(255, d[i + 2] + n));
  }
  ctx.putImageData(img, 0, 0);
}

// ---------------------------------------------------------------- road
// u: across the paved width (-PAVE_HALF..PAVE_HALF), v: ROAD_TEX_LEN metres along.
export function makeRoadTextures(style) {
  const W = 1024, H = 1024, r = mulberry32(77);
  const mx = m => (m + PAVE_HALF) / (PAVE_HALF * 2) * W;   // metres across → px
  const my = m => m / ROAD_TEX_LEN * H;                     // metres along → px
  const col = canvas(W, H), c = col.getContext('2d');
  const bump = canvas(W, H), b = bump.getContext('2d');
  const emi = style === 'neon' ? canvas(W, H) : null, e = emi && emi.getContext('2d');

  const base = { sunset:'#47474a', desert:'#58534d', night:'#3a3a3f', snow:'#434650', neon:'#17121f' }[style] || '#47474a';
  const shoulder = { sunset:'#55565a', desert:'#6a6359', night:'#46464b', snow:'#555963', neon:'#1d1626' }[style] || '#55565a';
  c.fillStyle = base; c.fillRect(0, 0, W, H);
  c.fillStyle = shoulder; c.fillRect(0, 0, mx(-ROAD_HALF), H); c.fillRect(mx(ROAD_HALF), 0, W - mx(ROAD_HALF), H);
  // tyre-polished wheel paths
  for (let l = 0; l < LANES; l++) {
    const cxm = -ROAD_HALF + LANE_W * (l + 0.5);
    for (const o of [-0.85, 0.85]) {
      const g = c.createLinearGradient(mx(cxm + o - 0.45), 0, mx(cxm + o + 0.45), 0);
      g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(0.5, style === 'neon' ? 'rgba(0,0,0,.25)' : 'rgba(10,10,12,.22)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = g; c.fillRect(mx(cxm + o - 0.45), 0, mx(cxm + o + 0.45) - mx(cxm + o - 0.45), H);
    }
    // faint oil stain line in lane centre
    c.fillStyle = 'rgba(15,12,10,.08)'; c.fillRect(mx(cxm - 0.25), 0, mx(cxm + 0.25) - mx(cxm - 0.25), H);
  }
  // patches and tar-snake cracks
  for (let i = 0; i < 6; i++) {
    c.fillStyle = `rgba(20,20,22,${0.08 + r() * 0.1})`;
    const px = mx(-ROAD_HALF + r() * ROAD_HALF * 2), py = r() * H;
    c.fillRect(px, py, 40 + r() * 140, 30 + r() * 120);
  }
  c.strokeStyle = 'rgba(12,12,14,.55)'; c.lineWidth = 2.2;
  for (let i = 0; i < 9; i++) {
    let x = mx(-ROAD_HALF + r() * ROAD_HALF * 2), y = r() * H;
    c.beginPath(); c.moveTo(x, y);
    for (let j = 0; j < 8; j++) { x += (r() - 0.5) * 40; y += 10 + r() * 22; c.lineTo(x, y); }
    c.stroke();
  }
  grain(c, W, H, style === 'neon' ? 10 : 34, 5);
  // aggregate speckles
  for (let i = 0; i < 9000; i++) {
    const v = 90 + r() * 90;
    c.fillStyle = `rgba(${v},${v},${v * 0.98},${0.25 + r() * 0.35})`;
    c.fillRect(r() * W, r() * H, 1 + r() * 1.6, 1 + r() * 1.6);
  }
  if (style === 'snow') {
    for (let i = 0; i < 700; i++) {
      const side = r() < 0.5 ? -1 : 1, m = side * (ROAD_HALF + 0.3 + r() * (PAVE_HALF - ROAD_HALF));
      c.fillStyle = `rgba(240,244,250,${0.35 + r() * 0.5})`;
      c.beginPath(); c.ellipse(mx(m), r() * H, 4 + r() * 18, 6 + r() * 30, 0, 0, Math.PI * 2); c.fill();
    }
  }
  // markings
  const paint = style === 'neon' ? '#40f4ff' : style === 'desert' ? '#f2eee2' : '#ecebe4';
  const paintEdge = style === 'neon' ? '#ff3a9a' : paint;
  const mark = (ctx2, color, x0, x1, y0, y1) => { ctx2.fillStyle = color; ctx2.fillRect(mx(x0), my(y0), mx(x1) - mx(x0), my(y1) - my(y0)); };
  const drawMarks = (ctx2, isBump) => {
    const cl = isBump ? '#ffffff' : paint, ce = isBump ? '#ffffff' : paintEdge;
    for (let l = 1; l < LANES; l++) { const xm = -ROAD_HALF + LANE_W * l; mark(ctx2, cl, xm - 0.075, xm + 0.075, 1.0, 4.0); }
    for (const s of [-1, 1]) { const xm = s * (ROAD_HALF - 0.25); mark(ctx2, ce, xm - 0.11, xm + 0.11, 0, ROAD_TEX_LEN); }
  };
  drawMarks(c, false);
  // paint wear
  for (let i = 0; i < 2500; i++) { c.fillStyle = `rgba(60,60,62,${r() * 0.5})`; const lx = (r() < 0.5 ? -1 : 1) * (ROAD_HALF - 0.25) + (r() - 0.5) * 0.25; c.fillRect(mx(lx), r() * H, 1.5, 1.5); }
  // rumble strip on the shoulders
  for (const s of [-1, 1]) for (let y = 0; y < ROAD_TEX_LEN; y += 0.3) {
    c.fillStyle = 'rgba(0,0,0,.25)'; const x0 = s * (ROAD_HALF + 0.15), x1 = s * (ROAD_HALF + 0.55);
    c.fillRect(mx(Math.min(x0, x1)), my(y), Math.abs(mx(x1) - mx(x0)), my(0.1));
    b.fillStyle = '#202020'; b.fillRect(mx(Math.min(x0, x1)), my(y), Math.abs(mx(x1) - mx(x0)), my(0.1));
  }
  // bump: grain + raised paint
  b.fillStyle = '#808080'; b.globalCompositeOperation = 'source-over';
  const bi = b.getImageData(0, 0, W, H), bd = bi.data;
  for (let i = 0; i < bd.length; i += 4) { const v = 128 + (r() - 0.5) * 90; bd[i] = bd[i + 1] = bd[i + 2] = v; bd[i + 3] = 255; }
  b.putImageData(bi, 0, 0);
  b.globalAlpha = 0.7; drawMarks(b, true); b.globalAlpha = 1;
  if (e) { e.fillStyle = '#000'; e.fillRect(0, 0, W, H); drawMarks(e, false); }
  return { map: tex(col, { aniso: 16 }), bump: tex(bump, { srgb: false, aniso: 16 }), emissive: e ? tex(emi, { aniso: 16 }) : null };
}

// ---------------------------------------------------------------- ground tiles (one tile = 8 m)
export function makeGroundTexture(kind) {
  const S = 512, cv = canvas(S, S), c = cv.getContext('2d'), r = mulberry32(kind.length * 99);
  let emissive = null;
  if (kind === 'grass') {
    c.fillStyle = '#4f6a2f'; c.fillRect(0, 0, S, S);
    for (let i = 0; i < 26000; i++) {
      const g = 70 + r() * 70, x = r() * S, y = r() * S;
      c.strokeStyle = `rgba(${g * 0.55 + r() * 30},${g + 20},${g * 0.35},${0.35 + r() * 0.4})`;
      c.lineWidth = 1; c.beginPath(); c.moveTo(x, y); c.lineTo(x + (r() - 0.5) * 3, y - 3 - r() * 5); c.stroke();
    }
    for (let i = 0; i < 60; i++) { c.fillStyle = `rgba(${140 + r() * 40},${130 + r() * 30},70,${0.05 + r() * 0.08})`; c.beginPath(); c.arc(r() * S, r() * S, 10 + r() * 40, 0, 7); c.fill(); }
  } else if (kind === 'sand') {
    c.fillStyle = '#c9a77a'; c.fillRect(0, 0, S, S);
    grain(c, S, S, 26, 3);
    for (let y = 0; y < S; y += 9) { c.strokeStyle = 'rgba(120,85,50,.12)'; c.lineWidth = 2; c.beginPath(); for (let x = 0; x <= S; x += 16) c.lineTo(x, y + Math.sin(x / 40 + y) * 3); c.stroke(); }
    for (let i = 0; i < 400; i++) { c.fillStyle = `rgba(90,70,50,${r() * 0.4})`; c.fillRect(r() * S, r() * S, 2, 2); }
  } else if (kind === 'snow') {
    c.fillStyle = '#e9eef5'; c.fillRect(0, 0, S, S);
    grain(c, S, S, 14, 4);
    for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(170,190,220,${0.05 + r() * 0.08})`; c.beginPath(); c.ellipse(r() * S, r() * S, 20 + r() * 60, 6 + r() * 14, r() * 3, 0, 7); c.fill(); }
  } else if (kind === 'city') {
    c.fillStyle = '#2a2b2e'; c.fillRect(0, 0, S, S);
    grain(c, S, S, 24, 6);
    c.strokeStyle = 'rgba(0,0,0,.4)'; c.lineWidth = 2;
    for (let i = 0; i <= S; i += 128) { c.beginPath(); c.moveTo(i, 0); c.lineTo(i, S); c.moveTo(0, i); c.lineTo(S, i); c.stroke(); }
  } else if (kind === 'grid') {
    c.fillStyle = '#0d0418'; c.fillRect(0, 0, S, S);
    const ec = canvas(S, S), e = ec.getContext('2d');
    e.fillStyle = '#000'; e.fillRect(0, 0, S, S);
    for (const g of [c, e]) { g.strokeStyle = '#ff2a8a'; g.lineWidth = 5; g.strokeRect(0, 0, S, S); }
    emissive = tex(ec);
  }
  return { map: tex(cv), emissive };
}

// ---------------------------------------------------------------- small helpers
export function makePlateTexture() {
  const cv = canvas(256, 56), c = cv.getContext('2d');
  c.fillStyle = '#f4f4f0'; c.fillRect(0, 0, 256, 56);
  c.fillStyle = '#1f3c9c'; c.fillRect(0, 0, 26, 56);
  c.fillStyle = '#ffd500'; c.font = 'bold 11px sans-serif'; c.fillText('★', 7, 22);
  c.fillStyle = '#fff'; c.font = 'bold 13px sans-serif'; c.fillText('F', 9, 47);
  c.fillStyle = '#151515'; c.font = 'bold 36px "Arial Narrow",Arial,sans-serif'; c.textBaseline = 'middle';
  c.fillText('HR-482-XT', 38, 30);
  c.strokeStyle = '#222'; c.lineWidth = 3; c.strokeRect(1.5, 1.5, 253, 53);
  return tex(cv, { repeat: false });
}
export function makeWindowsTexture(seed) {
  const cv = canvas(256, 512), c = cv.getContext('2d'), r = mulberry32(seed);
  c.fillStyle = '#05060a'; c.fillRect(0, 0, 256, 512);
  const warm = ['#ffd58a', '#ffe7b5', '#fff3d6', '#bcd6ff', '#ffc070'];
  for (let y = 8; y < 512; y += 16) for (let x = 6; x < 256; x += 14) {
    if (r() < 0.38) { c.fillStyle = warm[(r() * warm.length) | 0]; c.globalAlpha = 0.55 + r() * 0.45; c.fillRect(x, y, 9, 10); }
  }
  c.globalAlpha = 1;
  return tex(cv);
}
export function makeFacadeTexture(seed) {   // building colour map with dark glass grid
  const cv = canvas(256, 512), c = cv.getContext('2d'), r = mulberry32(seed + 5);
  const tone = 30 + r() * 30;
  c.fillStyle = `rgb(${tone},${tone + 2},${tone + 8})`; c.fillRect(0, 0, 256, 512);
  for (let y = 8; y < 512; y += 16) for (let x = 6; x < 256; x += 14) { c.fillStyle = '#0b0d14'; c.fillRect(x, y, 9, 10); }
  return tex(cv);
}
export function makeRadial(inner, outer, size = 128) {
  const cv = canvas(size, size), c = cv.getContext('2d');
  const g = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, inner); g.addColorStop(1, outer);
  c.fillStyle = g; c.fillRect(0, 0, size, size);
  return tex(cv, { repeat: false });
}
export function makeShadowTexture() {
  const cv = canvas(128, 128), c = cv.getContext('2d');
  const g = c.createRadialGradient(64, 64, 10, 64, 64, 64);
  g.addColorStop(0, 'rgba(0,0,0,.85)'); g.addColorStop(0.55, 'rgba(0,0,0,.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  c.fillStyle = g; c.fillRect(0, 0, 128, 128);
  return tex(cv, { repeat: false, srgb: false });
}
export function makeLeatherBump() {
  const S = 256, cv = canvas(S, S), c = cv.getContext('2d'), r = mulberry32(42);
  c.fillStyle = '#808080'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 5000; i++) { const v = 100 + r() * 60; c.fillStyle = `rgb(${v},${v},${v})`; c.beginPath(); c.arc(r() * S, r() * S, 1 + r() * 2.2, 0, 7); c.fill(); }
  return tex(cv, { srgb: false });
}
export function makeSkinTexture() {
  const S = 256, cv = canvas(S, S), c = cv.getContext('2d'), r = mulberry32(9);
  c.fillStyle = '#c88f6e'; c.fillRect(0, 0, S, S);
  for (let i = 0; i < 1400; i++) { c.fillStyle = `rgba(${150 + r() * 60},${80 + r() * 40},${60 + r() * 30},${r() * 0.18})`; c.beginPath(); c.arc(r() * S, r() * S, 1 + r() * 4, 0, 7); c.fill(); }
  for (let i = 0; i < 60; i++) { c.strokeStyle = `rgba(120,70,55,${0.08 + r() * 0.1})`; c.lineWidth = 0.8; c.beginPath(); const y = r() * S; c.moveTo(0, y); c.bezierCurveTo(S / 3, y + (r() - .5) * 20, S * 2 / 3, y + (r() - .5) * 20, S, y); c.stroke(); }
  return tex(cv);
}
