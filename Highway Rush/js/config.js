// Shared constants, roads (themes) and cars. Units: metres, seconds, radians.
export const LANE_W = 3.6, LANES = 4;
export const ROAD_HALF = LANE_W * LANES / 2;          // 7.2 m: asphalt edge
export const SHOULDER = 2.0;
export const PAVE_HALF = ROAD_HALF + SHOULDER;          // 9.2 m: paved edge
export const RAIL_X = PAVE_HALF + 0.35;                 // guard rail line
export const laneX = i => -ROAD_HALF + LANE_W * (i + 0.5);
export const BASE_MAX = 55;                             // m/s (198 km/h) for the starter car
export const ROAD_TEX_LEN = 12;                         // metres of road per texture repeat (3 m dash + 9 m gap)

export const THEMES = [
  { id:'sunset', name:'Sunset Highway', price:0, mult:1, traffic:1, grip:1, desc:'Golden-hour motorway through green hills. Calm traffic.',
    sky:{ kind:'atmo', elevation:4.5, azimuth:205, turbidity:7, rayleigh:2.6, mie:0.006, mieG:0.86 },
    fog:{ color:0xc7a58e, near:90, far:950 }, exposure:0.62, env:0.9,
    sun:{ color:0xffc49a, intensity:3.0 }, hemi:{ sky:0xa9b8e0, ground:0x4a4232, intensity:0.55 },
    ground:'grass', terrainAmp:26, backdrop:{ kind:'hills', color:0x6f6a8a, height:150 },
    props:{ pine:0.55, oak:0.6, bush:0.5, lampEvery:60 } },
  { id:'desert', name:'Desert Route', price:1000, mult:1.25, traffic:1.1, grip:1, trucks:0.3, desc:'Canyon road through the dunes. More trucks, more cash.',
    sky:{ kind:'atmo', elevation:38, azimuth:150, turbidity:3.2, rayleigh:0.9, mie:0.004, mieG:0.8 },
    fog:{ color:0xd9cbb0, near:120, far:1100 }, exposure:0.42, env:1.0,
    sun:{ color:0xfff1dc, intensity:3.6 }, hemi:{ sky:0x9cc4ff, ground:0x8a6a48, intensity:0.7 },
    ground:'sand', terrainAmp:14, backdrop:{ kind:'mesas', color:0xb26a45, height:220 },
    props:{ cactus:0.7, rock:0.6, lampEvery:120 } },
  { id:'night', name:'Night City', price:3000, mult:1.6, traffic:1.25, grip:1, night:true, desc:'City motorway after dark. Busier lanes, bigger pay.',
    sky:{ kind:'night', top:0x02040c, horizon:0x1c2348, glow:0x3a2c50 },
    fog:{ color:0x161a30, near:60, far:700 }, exposure:1.0, env:0.5,
    sun:{ color:0x8fa6ff, intensity:0.35 }, hemi:{ sky:0x30406a, ground:0x10121a, intensity:0.35 },
    ground:'city', terrainAmp:0, backdrop:{ kind:'skyline', color:0x0c1020, height:180 },
    props:{ building:1, lampEvery:32 }, bloom:0.5, headlights:true },
  { id:'snow', name:'Snowy Pass', price:7000, mult:2.0, traffic:1.3, grip:0.55, snow:true, desc:'Icy mountain pass. Slow-to-react steering, double cash.',
    sky:{ kind:'atmo', elevation:14, azimuth:170, turbidity:12, rayleigh:0.7, mie:0.008, mieG:0.75 },
    fog:{ color:0xc9d2de, near:40, far:520 }, exposure:0.4, env:0.85,
    sun:{ color:0xf2f4ff, intensity:2.2 }, hemi:{ sky:0xdde6f5, ground:0x8a96a8, intensity:0.9 },
    ground:'snow', terrainAmp:55, backdrop:{ kind:'peaks', color:0xe8eef7, height:420 },
    props:{ snowpine:1.1, lampEvery:80 } },
  { id:'neon', name:'Neon Grid', price:15000, mult:2.6, traffic:1.45, grip:1, night:true, synth:true, desc:'Retro-wave rush hour. Max traffic, max cash.',
    sky:{ kind:'synth', top:0x07021a, horizon:0xb0206e, glow:0xff6a3d },
    fog:{ color:0x2a0838, near:80, far:800 }, exposure:0.8, env:0.6,
    sun:{ color:0xff7ac0, intensity:0.5 }, hemi:{ sky:0x6a2a9a, ground:0x12041e, intensity:0.45 },
    ground:'grid', terrainAmp:0, backdrop:{ kind:'wire', color:0x1a0630, height:200 },
    props:{ pylonEvery:24 }, bloom:0.45, headlights:true },
];

// Body shapes for the player's cars (also used by traffic where noted).
export const CARS = [
  { id:'rookie', name:'Rookie Hatch', price:0, top:1.0, accel:1.0, handling:1.0, mult:1.0, desc:'Your trusty first ride.',
    body:'hatch', paint:0xb3121c, metal:0.35, accent:'#7ef0ff' },
  { id:'coupe', name:'Street Coupe', price:600, top:1.08, accel:1.15, handling:1.1, mult:1.1, desc:'Quicker and nimbler. A solid upgrade.',
    body:'coupe', paint:0x1a5fc2, metal:0.6, accent:'#9cf6ff' },
  { id:'muscle', name:'Muscle GT', price:1800, top:1.18, accel:1.35, handling:0.95, mult:1.2, desc:'Huge V8 punch, heavy steering.',
    body:'muscle', paint:0xe0a800, metal:0.3, stripes:0x0d0d0d, accent:'#ffd23f' },
  { id:'rally', name:'Rally Sport', price:4500, top:1.15, accel:1.3, handling:1.4, mult:1.3, desc:'Razor-sharp handling for tight weaving.',
    body:'hatch', paint:0xe9ecef, metal:0.15, stripes:0x1b52c6, accent:'#7effa8' },
  { id:'v12', name:'Super V12', price:10000, top:1.3, accel:1.55, handling:1.25, mult:1.45, desc:'Exotic supercar. Fast in every way.',
    body:'super', paint:0xe85a00, metal:0.55, accent:'#ffb36b' },
  { id:'hyper', name:'Hyper Prototype', price:25000, top:1.45, accel:1.8, handling:1.5, mult:1.7, desc:'The ultimate machine. Pure speed.',
    body:'hyper', paint:0x5a16b8, metal:0.8, stripes:0x00d8ff, accent:'#00f0ff' },
];

export const TRAFFIC_COLORS = [0x9a1018, 0x123f8c, 0xd8d8d4, 0x1c1d20, 0x5d6168, 0xa9aeb5, 0x204a33, 0x7a5a2a, 0xe0e2e4, 0x2b2f38, 0x6a0e1e, 0x3a6ea8, 0xc3b8a0];
export const TRUCK_COLORS = [0xeeeeee, 0xb32020, 0x223a5e, 0xe2b01c, 0x2f6d3a];

export const clamp = (v, a, b) => v < a ? a : v > b ? b : v;
export const lerp = (a, b, t) => a + (b - a) * t;
export function mulberry32(a) {
  return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
// Smooth 2D value noise (deterministic), used for terrain heights and colour patches.
const P = new Uint8Array(512);
{ const r = mulberry32(1337); const p = [...Array(256).keys()]; for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; [p[i], p[j]] = [p[j], p[i]]; } for (let i = 0; i < 512; i++) P[i] = p[i & 255]; }
const fade = t => t * t * (3 - 2 * t);
function vnoise(x, y) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (i, j) => P[(P[(xi + i) & 255] + yi + j) & 255] / 255;
  const u = fade(xf), v = fade(yf);
  return lerp(lerp(h(0, 0), h(1, 0), u), lerp(h(0, 1), h(1, 1), u), v);
}
export function fbm(x, y, oct = 4) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * vnoise(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
