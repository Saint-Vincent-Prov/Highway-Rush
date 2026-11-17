// The world around the road: sky, light, fog, terrain, rails, lamps, props — streamed in chunks.
import * as THREE from 'three';
import { Sky } from 'three/addons/objects/Sky.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Track, DS } from './track.js';
import { PAVE_HALF, ROAD_HALF, RAIL_X, ROAD_TEX_LEN, mulberry32, fbm, clamp, lerp } from './config.js';
import { makeRoadTextures, makeGroundTexture, makeWindowsTexture, makeFacadeTexture, makeRadial } from './textures.js';
import { propGeometry } from './models.js';

const CH = 120;                          // chunk length (m)
const AHEAD = 1150, BEHIND = 260;
const TERRAIN_D = [PAVE_HALF, RAIL_X + 0.7, 12.5, 15.5, 21, 30, 44, 66, 100, 150, 230, 340];
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const _f = {}, _p = {}, _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _v = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

export function frameBasis(f, out) {   // car/prop orientation from a track frame (z = forward incl. grade)
  const F = _v.set(Math.sin(f.h), f.g, -Math.cos(f.h)).normalize();
  const X = new THREE.Vector3().crossVectors(UP, F).normalize();
  const Y = new THREE.Vector3().crossVectors(F, X);
  return out.makeBasis(X, Y, F.clone());
}

const SKY_FRAG = `
uniform vec3 top; uniform vec3 horizon; uniform vec3 glow; uniform vec3 sunDir; uniform float synth; uniform float time;
varying vec3 vDir;
float hash(vec3 p){ p = fract(p*0.3183099+.1); p *= 17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
void main(){
  vec3 d = normalize(vDir);
  float h = clamp(d.y, -0.2, 1.0);
  vec3 col = mix(horizon, top, pow(clamp(h*1.6, 0.0, 1.0), 0.55));
  float g = exp(-abs(h)*7.0);
  col += glow * g * 0.8;
  // stars
  vec3 sp = floor(d*420.0);
  float st = step(0.9975, hash(sp)) * smoothstep(0.02, 0.25, h);
  col += vec3(st) * (0.6 + 0.4*hash(sp+3.0));
  float sd = dot(d, normalize(sunDir));
  if (synth > 0.5) {
    float disc = smoothstep(0.9935, 0.9945, sd);
    vec3 sun = mix(vec3(1.0,0.16,0.55), vec3(1.0,0.86,0.2), clamp((d.y - sunDir.y + 0.11) * 4.5, 0.0, 1.0));
    float bands = step(0.5, fract((d.y - sunDir.y) * 60.0)) + step(0.0, d.y - sunDir.y + 0.01);
    col = mix(col, sun * 2.2, disc * clamp(bands, 0.0, 1.0));
    col += vec3(1.0,0.3,0.6) * pow(max(sd,0.0), 60.0) * 0.6;
  } else {
    float moon = smoothstep(0.99955, 0.9997, sd);
    col = mix(col, vec3(0.95,0.95,0.88)*1.6, moon);
    col += vec3(0.4,0.45,0.6) * pow(max(sd,0.0), 400.0) * 0.5;
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const SKY_VERT = `varying vec3 vDir; void main(){ vDir = (modelMatrix * vec4(position,0.0)).xyz; vec4 p = projectionMatrix * modelViewMatrix * vec4(position,1.0); gl_Position = p.xyww; }`;

function makeNightSky(cfg, sunDir) {
  const mat = new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color(cfg.top) }, horizon: { value: new THREE.Color(cfg.horizon) }, glow: { value: new THREE.Color(cfg.glow) },
      sunDir: { value: sunDir.clone() }, synth: { value: cfg.kind === 'synth' ? 1 : 0 }, time: { value: 0 } },
    vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), mat);
  m.scale.setScalar(6000); m.frustumCulled = false; m.renderOrder = -10;
  return m;
}

export class World {
  constructor(renderer, scene, kit) {
    this.renderer = renderer; this.scene = scene; this.kit = kit;
    this.root = new THREE.Group(); scene.add(this.root);
    this.chunks = new Map();
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6); scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 3);
    this.sun.castShadow = true;
    const sc = this.sun.shadow.camera; sc.near = 1; sc.far = 500; sc.left = -45; sc.right = 45; sc.top = 70; sc.bottom = -40;
    this.sun.shadow.mapSize.set(2048, 2048); this.sun.shadow.bias = -0.0004; this.sun.shadow.normalBias = 0.03;
    scene.add(this.sun); scene.add(this.sun.target);
    this.sunDir = new THREE.Vector3(0, 1, 0);
    this.glowTex = makeRadial('rgba(255,214,150,.55)', 'rgba(255,200,120,0)');
    this.track = null;
  }

  setTheme(theme, seed) {
    this.theme = theme;
    // ---------- dispose previous theme resources
    for (const ch of this.chunks.values()) this.disposeChunk(ch);
    this.chunks.clear();
    if (this.skyMesh) { this.scene.remove(this.skyMesh); this.skyMesh.geometry.dispose(); this.skyMesh.material.dispose(); }
    if (this.backdrop) { this.scene.remove(this.backdrop); this.backdrop.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); }); }
    if (this.snow) { this.scene.remove(this.snow); this.snow.geometry.dispose(); this.snow.material.dispose(); this.snow = null; }
    if (this.mats) for (const m of Object.values(this.mats)) if (m && m.dispose) { for (const k of ['map', 'bumpMap', 'emissiveMap']) if (m[k]) m[k].dispose(); m.dispose(); }
    if (this.scene.environment) this.scene.environment.dispose();

    const sk = theme.sky;
    if (sk.kind === 'atmo') this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(90 - sk.elevation), THREE.MathUtils.degToRad(sk.azimuth));
    else if (sk.kind === 'synth') this.sunDir.set(0, 0.06, -1).normalize();
    else this.sunDir.setFromSphericalCoords(1, THREE.MathUtils.degToRad(62), THREE.MathUtils.degToRad(140));

    // ---------- sky + environment lighting
    const envScene = new THREE.Scene();
    if (sk.kind === 'atmo') {
      const mk = () => { const s = new Sky(); s.scale.setScalar(7000); s.renderOrder = -10; const u = s.material.uniforms;
        u.turbidity.value = sk.turbidity; u.rayleigh.value = sk.rayleigh; u.mieCoefficient.value = sk.mie; u.mieDirectionalG.value = sk.mieG;
        u.sunPosition.value.copy(this.sunDir).multiplyScalar(450000); s.frustumCulled = false; return s; };
      this.skyMesh = mk();
      const envSky = mk(); envSky.material.uniforms.showSunDisc.value = false; envScene.add(envSky);
    } else {
      this.skyMesh = makeNightSky(sk, this.sunDir);
      envScene.add(makeNightSky(sk, this.sunDir));
      // a few bright panels so night paint still picks up reflections
      const lm = new THREE.MeshBasicMaterial({ color: theme.synth ? 0xff3aa0 : 0xffd8a0, side: THREE.DoubleSide });
      for (let i = 0; i < 6; i++) { const p = new THREE.Mesh(new THREE.PlaneGeometry(400, 60), lm); p.position.setFromSphericalCoords(1500, 1.3, i * 1.05); p.lookAt(0, 0, 0); envScene.add(p); }
    }
    // a ground below the horizon, so paint and glass reflect land instead of black
    const gcol = new THREE.Color(theme.hemi.ground).lerp(new THREE.Color(theme.fog.color), 0.35);
    const envGround = new THREE.Mesh(new THREE.CircleGeometry(4000, 32), new THREE.MeshBasicMaterial({ color: gcol }));
    envGround.rotation.x = -Math.PI / 2; envGround.position.y = -5; envScene.add(envGround);
    this.scene.add(this.skyMesh);
    const exp = this.renderer.toneMappingExposure;
    this.scene.environment = this.pmrem.fromScene(envScene, 0, 0.1, 5000).texture;
    this.renderer.toneMappingExposure = exp;
    this.scene.environmentIntensity = theme.env;
    envScene.traverse(o => { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });

    this.scene.fog = new THREE.Fog(theme.fog.color, theme.fog.near, theme.fog.far);
    this.scene.background = new THREE.Color(theme.fog.color);
    this.hemi.color.set(theme.hemi.sky); this.hemi.groundColor.set(theme.hemi.ground); this.hemi.intensity = theme.hemi.intensity;
    this.sun.color.set(theme.sun.color); this.sun.intensity = theme.sun.intensity;
    this.renderer.toneMappingExposure = theme.exposure;
    this.kit.setNight(!!theme.night);

    // ---------- materials
    const road = makeRoadTextures(theme.id);
    const grd = makeGroundTexture(theme.ground);
    this.mats = {
      road: new THREE.MeshStandardMaterial({ map: road.map, bumpMap: road.bump, bumpScale: 1.2, roughness: theme.id === 'snow' ? 0.55 : 0.88, metalness: 0,
        emissiveMap: road.emissive, emissive: road.emissive ? 0xffffff : 0x000000, emissiveIntensity: road.emissive ? 0.9 : 0 }),
      ground: new THREE.MeshStandardMaterial({ map: grd.map, vertexColors: true, roughness: theme.ground === 'snow' ? 0.75 : 0.97,
        emissiveMap: grd.emissive, emissive: grd.emissive ? 0xffffff : 0x000000, emissiveIntensity: grd.emissive ? 1.2 : 0 }),
      rail: theme.synth ? new THREE.MeshStandardMaterial({ color: 0x102030, emissive: 0x00e5ff, emissiveIntensity: 0.8, side: THREE.DoubleSide })
        : new THREE.MeshStandardMaterial({ color: 0xc4c9cf, metalness: 0.85, roughness: 0.38, side: THREE.DoubleSide }),
      post: new THREE.MeshStandardMaterial({ color: 0x8c9198, metalness: 0.7, roughness: 0.45 }),
      prop: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 }),
      lamp: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.6 }),
      lampHead: new THREE.MeshStandardMaterial({ color: 0xfff4d8, emissive: 0xffe2a8, emissiveIntensity: theme.night ? 8 : 0.6 }),
      pool: new THREE.MeshBasicMaterial({ map: this.glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, opacity: 0.55, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }),
      pylonA: new THREE.MeshStandardMaterial({ color: 0x220010, emissive: 0xff2a8a, emissiveIntensity: 1.6 }),
      pylonB: new THREE.MeshStandardMaterial({ color: 0x001820, emissive: 0x00e5ff, emissiveIntensity: 1.6 }),
    };
    if (theme.ground === 'city') {
      this.mats.building = new THREE.MeshStandardMaterial({ map: makeFacadeTexture(3), emissiveMap: makeWindowsTexture(11), emissive: 0xffffff, emissiveIntensity: 1.4, roughness: 0.6, metalness: 0.3 });
    }
    for (const t of [road.map, road.bump, road.emissive].filter(Boolean)) t.repeat.set(1, 1);
    this.buildBackdrop(theme);
    if (theme.snow) this.buildSnow();
    this.reset(seed);
  }

  reset(seed) {
    for (const ch of this.chunks.values()) this.disposeChunk(ch);
    this.chunks.clear();
    this.track = new Track(seed);
    this.track.ensure(AHEAD + 200);
  }

  // Ground height (world y) at track distance s, lateral offset d.
  groundY(s, d, wx, wz, roadY) {
    const a = Math.abs(d), amp = this.theme.terrainAmp;
    if (a <= PAVE_HALF + 0.01) return roadY;
    let y = roadY - 0.08 - (a - PAVE_HALF) * 0.04;
    y -= 0.85 * smooth(RAIL_X + 1.5, 13.5, a) * (1 - smooth(14.5, 19, a));
    if (amp > 0) {
      const ramp = smooth(16, 160, a);
      let n;
      if (this.theme.ground === 'sand') n = Math.abs(fbm(wx / 160, wz / 160, 4) - 0.5) * 2.4 - 0.25;
      else n = fbm(wx / 260, wz / 260, 5) - 0.32;
      y = lerp(y, roadY * 0.35, ramp * 0.6) + n * amp * ramp * (this.theme.snow ? 1 + smooth(120, 340, a) * 1.6 : 1);
    }
    return y;
  }

  buildBackdrop(theme) {
    const bd = theme.backdrop, seg = 256, R = 2600, grp = new THREE.Group();
    const fog = new THREE.Color(theme.fog.color), col = new THREE.Color(bd.color), r = mulberry32(bd.kind.length * 17);
    if (bd.kind === 'skyline') {
      const tex = makeWindowsTexture(21);
      const geos = [];
      for (let i = 0; i < 160; i++) {
        const a = i / 160 * Math.PI * 2 + r() * 0.01, w = 40 + r() * 80, h = 40 + r() * bd.height * (r() < 0.15 ? 2.2 : 1);
        const g = new THREE.BoxGeometry(w, h, 40);
        const uv = g.attributes.uv; for (let k = 0; k < uv.count; k++) uv.setXY(k, uv.getX(k) * w / 30, uv.getY(k) * h / 30);
        g.translate(0, h / 2 - 30, 0); g.rotateY(-a + Math.PI / 2); g.translate(Math.cos(a) * R * 0.8, 0, Math.sin(a) * R * 0.8);
        geos.push(g);
      }
      const mat = new THREE.MeshBasicMaterial({ color: 0x0b0e1c, map: tex, fog: false });
      mat.onBeforeCompile = sh => { sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', '#include <map_fragment>\n diffuseColor.rgb = mix(vec3(0.03,0.035,0.07), vec3(1.0,0.82,0.55), dot(diffuseColor.rgb, vec3(0.33)) * 1.2);'); };
      grp.add(new THREE.Mesh(mergeGeometries(geos.map(g => g.toNonIndexed()), false), mat)); geos.forEach(g => g.dispose());
    } else {
      const pos = [], colors = [], idx = [];
      for (let i = 0; i <= seg; i++) {
        const a = i / seg * Math.PI * 2, u = i / seg;
        let h;
        const x = Math.cos(a), z = Math.sin(a);
        if (bd.kind === 'mesas') h = bd.height * (fbm(x * 3 + 5, z * 3 + 5, 4) > 0.52 ? 0.75 + fbm(x * 9, z * 9, 2) * 0.35 : 0.08 + fbm(x * 6, z * 6, 3) * 0.25);
        else if (bd.kind === 'peaks') h = bd.height * Math.pow(fbm(x * 2.5 + 3, z * 2.5 + 3, 6), 1.7) * 2.2;
        else h = bd.height * (0.25 + fbm(x * 2.2 + 9, z * 2.2 + 9, 5) * 0.95);
        void u;
        pos.push(x * R, -40, z * R, x * R, h, z * R);
        const top = col.clone().lerp(fog, bd.kind === 'peaks' ? 0.25 : 0.45);
        if (bd.kind === 'peaks') top.lerp(new THREE.Color(0xffffff), 0.5);
        const bot = fog.clone();
        colors.push(bot.r, bot.g, bot.b, top.r, top.g, top.b);
        if (i < seg) { const k = i * 2; idx.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
      g.setIndex(idx);
      const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false, side: THREE.DoubleSide });
      grp.add(new THREE.Mesh(g, mat));
      if (bd.kind === 'wire') grp.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xff2a9a, wireframe: true, fog: false, transparent: true, opacity: 0.55 })));
    }
    grp.traverse(o => { o.frustumCulled = false; o.renderOrder = -5; });
    this.backdrop = grp; this.scene.add(grp);
  }

  buildSnow() {
    const n = 4000, p = new Float32Array(n * 3), r = mulberry32(5);
    for (let i = 0; i < n; i++) { p[i * 3] = (r() - 0.5) * 120; p[i * 3 + 1] = r() * 40; p[i * 3 + 2] = (r() - 0.5) * 120; }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    const m = new THREE.PointsMaterial({ color: 0xffffff, size: 0.09, map: makeRadial('rgba(255,255,255,1)', 'rgba(255,255,255,0)', 32), transparent: true, depthWrite: false, opacity: 0.9 });
    this.snow = new THREE.Points(g, m); this.snow.frustumCulled = false; this.scene.add(this.snow);
    this.snowOrigin = new THREE.Vector3();
  }

  // ---------------------------------------------------------------- chunks
  buildChunk(ci) {
    const T = this.track, th = this.theme, s0 = ci * CH, n = CH / DS + 1, grp = new THREE.Group();
    T.ensure(s0 + CH + 10);
    const r = mulberry32(ci * 7919 + 13);
    const rows = [];
    for (let i = 0; i < n; i++) { const s = s0 + i * DS; const f = T.frame(s, {}); rows.push({ s, f, c: Math.cos(f.h), sn: Math.sin(f.h) }); }
    const at = (row, d) => [row.f.x + row.c * d, row.f.z + row.sn * d];

    // road ribbon
    {
      const pos = [], uv = [], idx = [], vOff = (s0 / ROAD_TEX_LEN) % 1;
      rows.forEach((row, i) => {
        for (const [j, d] of [[0, -PAVE_HALF], [1, PAVE_HALF]]) { const [x, z] = at(row, d); pos.push(x, row.f.y, z); uv.push(j, (row.s - s0) / ROAD_TEX_LEN + vOff); }
        if (i < n - 1) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.mats.road); m.receiveShadow = true; grp.add(m);
    }
    // terrain (two grids, columns ordered left → right)
    for (const side of [-1, 1]) {
      const D = side < 0 ? TERRAIN_D.slice().reverse().map(d => -d) : TERRAIN_D;
      const cols = D.length, pos = [], uv = [], col = [], idx = [];
      const tint = new THREE.Color();
      rows.forEach((row, i) => {
        D.forEach((d, j) => {
          const [x, z] = at(row, d), y = this.groundY(row.s, d, x, z, row.f.y);
          pos.push(x, y, z); uv.push(x / 8, z / 8);
          const v = fbm(x / 90, z / 90, 3), v2 = fbm(x / 23 + 50, z / 23, 2);
          switch (th.ground) {
            case 'grass': tint.setRGB(0.78 + v * 0.5, 0.82 + v * 0.3, 0.6 + v2 * 0.3); if (v2 > 0.62) tint.multiplyScalar(1.15); break;
            case 'sand': tint.setRGB(0.92 + v * 0.2, 0.86 + v * 0.18, 0.78 + v2 * 0.16); break;
            case 'snow': tint.setRGB(0.92 + v * 0.1, 0.94 + v * 0.08, 1); if (Math.abs(d) > 100 && v2 > 0.66) tint.setRGB(0.5, 0.5, 0.55); break;
            default: tint.setRGB(0.8 + v * 0.3, 0.8 + v * 0.3, 0.85 + v * 0.3);
          }
          col.push(tint.r, tint.g, tint.b);
          if (i < n - 1 && j < cols - 1) { const a = i * cols + j, b = a + 1, c = a + cols, e = c + 1; idx.push(a, b, c, b, e, c); }
        });
      });
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setIndex(idx); g.computeVertexNormals();
      const m = new THREE.Mesh(g, this.mats.ground); m.receiveShadow = true; grp.add(m);
    }
    // guard rails (W-beam profile) + posts
    {
      const prof = [[-0.02, 0.55], [-0.11, 0.6], [-0.03, 0.685], [-0.11, 0.77], [-0.02, 0.82], [0.04, 0.82], [0.04, 0.55]];
      for (const side of [-1, 1]) {
        const pos = [], idx = [], P = prof.length;
        rows.forEach((row, i) => {
          prof.forEach(([px, py]) => { const d = side * (RAIL_X + px); const [x, z] = at(row, d); pos.push(x, row.f.y + py, z); });
          if (i < n - 1) for (let k = 0; k < P; k++) { const a = i * P + k, b = i * P + (k + 1) % P, c = a + P, e = b + P; idx.push(a, b, c, b, e, c); }
        });
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
        const m = new THREE.Mesh(g, this.mats.rail); m.castShadow = true; m.receiveShadow = true; grp.add(m);
      }
      const posts = new THREE.InstancedMesh(propGeometry('post'), this.mats.post, Math.ceil(CH / 4) * 2);
      let k = 0;
      for (let s = Math.ceil(s0 / 4) * 4; s < s0 + CH; s += 4) for (const side of [-1, 1]) {
        const f = T.frame(s, {}); const [x, z] = [f.x + Math.cos(f.h) * side * (RAIL_X + 0.1), f.z + Math.sin(f.h) * side * (RAIL_X + 0.1)];
        _m.makeRotationY(Math.PI - f.h).setPosition(x, f.y, z); posts.setMatrixAt(k++, _m);
      }
      posts.count = k; posts.castShadow = true; grp.add(posts);
    }
    // street lamps (+ light pools at night)
    if (th.props.lampEvery) {
      const le = th.props.lampEvery, list = [];
      for (let s = Math.ceil(s0 / le) * le; s < s0 + CH; s += le) list.push([s, -1], [s + le / 2, 1]);
      const lamps = new THREE.InstancedMesh(propGeometry('lamp'), this.mats.lamp, list.length);
      const heads = new THREE.InstancedMesh(propGeometry('lampHead'), this.mats.lampHead, list.length);
      const pools = th.night ? new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.mats.pool, list.length) : null;
      list.forEach(([s, side], i) => {
        const f = T.frame(s, {}); const d = side * (RAIL_X + 1.1);
        const x = f.x + Math.cos(f.h) * d, z = f.z + Math.sin(f.h) * d;
        const yaw = Math.PI - f.h + (side < 0 ? Math.PI : 0);
        _m.makeRotationY(yaw).setPosition(x, f.y, z); lamps.setMatrixAt(i, _m); heads.setMatrixAt(i, _m);
        if (pools) {
          const dp = side * (RAIL_X + 1.1 - 3.6); const px = f.x + Math.cos(f.h) * dp, pz = f.z + Math.sin(f.h) * dp;
          _m.compose(_s.set(px, f.y + 0.05, pz), _q.setFromAxisAngle(UP, Math.PI - f.h), new THREE.Vector3(20, 1, 26)); pools.setMatrixAt(i, _m);
        }
      });
      lamps.castShadow = true; grp.add(lamps, heads); if (pools) grp.add(pools);
    }
    // neon pylons
    if (th.props.pylonEvery) {
      const pe = th.props.pylonEvery;
      for (const [side, mat] of [[-1, this.mats.pylonA], [1, this.mats.pylonB]]) {
        const list = []; for (let s = Math.ceil(s0 / pe) * pe; s < s0 + CH; s += pe) list.push(s);
        const im = new THREE.InstancedMesh(propGeometry('pylon'), mat, Math.max(1, list.length));
        list.forEach((s, i) => { const f = T.frame(s, {}); const d = side * (RAIL_X + 5); _m.makeRotationY(Math.PI - f.h).setPosition(f.x + Math.cos(f.h) * d, f.y, f.z + Math.sin(f.h) * d); im.setMatrixAt(i, _m); });
        im.count = list.length; grp.add(im);
      }
    }
    // vegetation and rocks
    const kinds = Object.entries(th.props).filter(([k]) => ['pine', 'snowpine', 'oak', 'bush', 'cactus', 'rock'].includes(k));
    for (const [kind, dens] of kinds) {
      const count = Math.round(dens * 16 * 2);
      const im = new THREE.InstancedMesh(propGeometry(kind), this.mats.prop, count);
      let k = 0;
      for (let i = 0; i < count; i++) {
        const side = r() < 0.5 ? -1 : 1, s = s0 + r() * CH;
        const near = kind === 'bush' || kind === 'rock' ? 15 : 17;
        const d = side * (near + Math.pow(r(), 1.7) * 150);
        const f = T.frame(s, {}); const x = f.x + Math.cos(f.h) * d, z = f.z + Math.sin(f.h) * d;
        const y = this.groundY(s, d, x, z, f.y);
        const sc = 0.7 + r() * 0.7;
        _m.compose(_s.set(x, y - 0.15, z), _q.setFromAxisAngle(UP, r() * 6.28), new THREE.Vector3(sc, sc * (0.85 + r() * 0.3), sc));
        im.setMatrixAt(k++, _m);
      }
      im.count = k; im.castShadow = true; im.receiveShadow = true; grp.add(im);
    }
    // city buildings (merged per chunk)
    if (th.props.building) {
      const geos = [];
      for (const side of [-1, 1]) {
        let s = s0 + r() * 10;
        while (s < s0 + CH - 8) {
          const w = 14 + r() * 22, dep = 14 + r() * 20, h = 14 + Math.pow(r(), 2) * 90;
          const d = side * (24 + r() * 40 + dep / 2);
          const f = T.frame(s + w / 2, {});
          const g = new THREE.BoxGeometry(w, h, dep);
          const uv = g.attributes.uv;
          for (let q = 0; q < uv.count; q++) uv.setXY(q, uv.getX(q) * Math.max(w, dep) / 18, uv.getY(q) * h / 36);
          g.applyMatrix4(new THREE.Matrix4().makeRotationY(Math.PI / 2 + Math.PI - f.h));
          g.translate(f.x + Math.cos(f.h) * d, f.y + h / 2 - 1.5, f.z + Math.sin(f.h) * d);
          geos.push(g);
          s += w + 4 + r() * 16;
        }
      }
      if (geos.length) {
        const mg = mergeGeometries(geos.map(g => g.toNonIndexed()), false); geos.forEach(g => g.dispose());
        const m = new THREE.Mesh(mg, this.mats.building); m.castShadow = true; m.receiveShadow = true; grp.add(m);
      }
    }
    this.root.add(grp);
    return { ci, grp };
  }

  disposeChunk(ch) {
    this.root.remove(ch.grp);
    ch.grp.traverse(o => {
      if (o.isInstancedMesh) o.dispose();
      if (o.geometry && !o.isInstancedMesh) o.geometry.dispose();
    });
  }

  // Keep chunks around the player, move sky/backdrop/sun/snow with the camera.
  update(dt, pS, camPos, time) {
    const T = this.track;
    T.ensure(pS + AHEAD + CH + 20);
    const lo = Math.floor((pS - BEHIND) / CH), hi = Math.floor((pS + AHEAD) / CH);
    for (const [ci, ch] of this.chunks) if (ci < lo || ci > hi) { this.disposeChunk(ch); this.chunks.delete(ci); }
    let built = 0;
    for (let ci = Math.max(0, lo); ci <= hi; ci++) if (!this.chunks.has(ci)) {
      if (built >= 2 && this.chunks.size > 3) break;          // spread work over frames
      this.chunks.set(ci, this.buildChunk(ci)); built++;
    }
    T.trim(pS - BEHIND - CH * 2);
    this.skyMesh.position.copy(camPos);
    this.backdrop.position.set(camPos.x, 0, camPos.z);
    const f = T.frame(pS + 30, _f);
    this.sun.position.set(f.x + this.sunDir.x * 250, f.y + Math.max(40, this.sunDir.y * 250), f.z + this.sunDir.z * 250);
    this.sun.target.position.set(f.x, f.y, f.z);
    if (this.snow) {
      const p = this.snow.geometry.attributes.position, a = p.array;
      for (let i = 0; i < a.length; i += 3) {
        a[i + 1] -= dt * (2.2 + (i % 7) * 0.25);
        let x = a[i], y = a[i + 1], z = a[i + 2];
        const wx = x + this.snowOrigin.x - camPos.x, wz = z + this.snowOrigin.z - camPos.z;
        if (wx > 60) x -= 120; else if (wx < -60) x += 120;
        if (wz > 60) z -= 120; else if (wz < -60) z += 120;
        if (y + this.snowOrigin.y - camPos.y < -8) y += 40;
        a[i] = x; a[i + 1] = y; a[i + 2] = z;
      }
      p.needsUpdate = true;
      this.snow.position.copy(this.snowOrigin);
      if (this.snowOrigin.distanceTo(camPos) > 200) { this.snowOrigin.copy(camPos).y -= 10; }
    }
    void time;
  }
}
