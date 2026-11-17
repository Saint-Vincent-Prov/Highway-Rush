// Synthesised engine, wind, scrape and crash sounds (Web Audio, no files).
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} },
};
export { store };
export const Sfx = {
  ac: null, master: null, muted: store.get('hr_muted', false),
  init() {
    if (this.ac) { if (this.ac.state === 'suspended') this.ac.resume().catch(() => {}); return; }
    try { this.ac = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; }
    const ac = this.ac;
    this.master = ac.createGain(); this.master.gain.value = this.muted ? 0 : 0.7; this.master.connect(ac.destination);
    // engine
    this.o1 = ac.createOscillator(); this.o1.type = 'sawtooth';
    this.o2 = ac.createOscillator(); this.o2.type = 'square';
    this.ef = ac.createBiquadFilter(); this.ef.type = 'lowpass'; this.ef.Q.value = 3;
    this.eg = ac.createGain(); this.eg.gain.value = 0;
    const g2 = ac.createGain(); g2.gain.value = 0.5;
    this.o1.connect(this.ef); this.o2.connect(g2); g2.connect(this.ef); this.ef.connect(this.eg); this.eg.connect(this.master);
    this.o1.start(); this.o2.start();
    // noise
    const len = ac.sampleRate * 2, buf = ac.createBuffer(1, len, ac.sampleRate), d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
    // continuous scrape / rumble channel
    const ns = ac.createBufferSource(); ns.buffer = buf; ns.loop = true;
    this.sf = ac.createBiquadFilter(); this.sf.type = 'bandpass'; this.sf.frequency.value = 2400; this.sf.Q.value = 0.8;
    this.sg = ac.createGain(); this.sg.gain.value = 0;
    ns.connect(this.sf); this.sf.connect(this.sg); this.sg.connect(this.master); ns.start();
    // wind
    const ws = ac.createBufferSource(); ws.buffer = buf; ws.loop = true;
    this.wf = ac.createBiquadFilter(); this.wf.type = 'lowpass'; this.wf.frequency.value = 500;
    this.wg = ac.createGain(); this.wg.gain.value = 0;
    ws.connect(this.wf); this.wf.connect(this.wg); this.wg.connect(this.master); ws.start();
  },
  setMuted(m) {
    this.muted = m; store.set('hr_muted', m);
    if (this.master) this.master.gain.setTargetAtTime(m ? 0 : 0.7, this.ac.currentTime, 0.02);
  },
  engine(rpm, load, on, sp) {
    if (!this.ac) return;
    const t = this.ac.currentTime, f = 42 + rpm * 120;
    this.o1.frequency.setTargetAtTime(f, t, 0.04);
    this.o2.frequency.setTargetAtTime(f * 0.5, t, 0.04);
    this.ef.frequency.setTargetAtTime(300 + rpm * 1400 + load * 700, t, 0.05);
    this.eg.gain.setTargetAtTime(on ? 0.05 + 0.05 * load + 0.03 * rpm : 0, t, 0.08);
    this.wg.gain.setTargetAtTime(on ? sp * sp * 0.12 : 0, t, 0.2);
    this.wf.frequency.setTargetAtTime(300 + sp * 900, t, 0.2);
  },
  scrape(v, freq) {
    if (!this.ac) return;
    this.sg.gain.setTargetAtTime(v, this.ac.currentTime, 0.03);
    this.sf.frequency.setTargetAtTime(freq, this.ac.currentTime, 0.05);
  },
  burst(dur, type, f0, f1, vol, q) {
    const ac = this.ac, t = ac.currentTime;
    const s = ac.createBufferSource(); s.buffer = this.noise;
    const fl = ac.createBiquadFilter(); fl.type = type; fl.Q.value = q || 1;
    fl.frequency.setValueAtTime(f0, t); fl.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.04, dur * 0.2)); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    s.connect(fl); fl.connect(g); g.connect(this.master); s.start(t, Math.random()); s.stop(t + dur + 0.05);
  },
  whoosh() { if (this.ac) this.burst(0.4, 'bandpass', 500, 2600, 0.5, 1.2); },
  crash() {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime;
    this.burst(1.3, 'lowpass', 2200, 120, 1.2, 0.7);
    this.burst(0.6, 'highpass', 5000, 9000, 0.35, 0.5);
    const o = ac.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(30, t + 0.5);
    const g = ac.createGain(); g.gain.setValueAtTime(0.9, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.6);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.65);
  },
  cash() {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime;
    [1046, 1568].forEach((f, i) => {
      const o = ac.createOscillator(); o.type = 'square'; o.frequency.value = f;
      const g = ac.createGain(); g.gain.setValueAtTime(0.0001, t + i * 0.08); g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.08 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.08 + 0.18);
      o.connect(g); g.connect(this.master); o.start(t + i * 0.08); o.stop(t + i * 0.08 + 0.2);
    });
  },
  beep() {
    if (!this.ac) return;
    const ac = this.ac, t = ac.currentTime;
    const o = ac.createOscillator(); o.type = 'triangle'; o.frequency.setValueAtTime(880, t); o.frequency.setValueAtTime(1320, t + 0.07);
    const g = ac.createGain(); g.gain.setValueAtTime(0.12, t); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + 0.22);
  },
};
