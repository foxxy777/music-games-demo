/* V16 防空版 · WebAudio：探测波扫频音（音画同步）/ 炮火 / 旋律播放（mp3 优先、合成回退） */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V16 = root.V16 || {};
  Object.assign(root.V16, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const R = typeof self !== 'undefined' ? self : globalThis;
  const midiFreq = m => 440 * Math.pow(2, (m - 69) / 12);

  let ctx = null, master = null, volume = 0.7;
  function ensure() {
    if (!ctx) {
      const AC = R.AudioContext || R.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
      master = ctx.createGain();
      master.gain.value = volume;
      master.connect(ctx.destination);
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  function setVolume(v) { volume = v; if (master) master.gain.value = v; }

  function tone(freq, dur, opts = {}) {
    const c = ensure(); if (!c) return;
    const t0 = c.currentTime + (opts.delay || 0);
    const o = c.createOscillator(), g = c.createGain();
    o.type = opts.type || 'sine';
    o.frequency.setValueAtTime(freq, t0);
    if (opts.slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, opts.slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(opts.vol || 0.25, t0 + (opts.attack || 0.008));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.02);
  }
  function noise(dur, opts = {}) {
    const c = ensure(); if (!c) return;
    const t0 = c.currentTime + (opts.delay || 0);
    const len = Math.max(1, (dur * c.sampleRate) | 0);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource(); src.buffer = buf;
    const g = c.createGain(); g.gain.value = opts.vol || 0.3;
    const f = c.createBiquadFilter();
    f.type = opts.filter || 'lowpass'; f.frequency.value = opts.freq || 900;
    src.connect(f); f.connect(g); g.connect(master);
    src.start(t0);
  }

  // ===== 探测波扫频音：每个扫描波一条持续振幅音，freq 每帧跟 scannerY =====
  const sweepVoices = new Map(); // sweep对象 → {osc, gain, type}
  function sweepStart(sweep) {
    const c = ensure(); if (!c) return;
    sweepStop(sweep);
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = sweep.mode === 'track' ? 'sawtooth' : 'triangle';
    osc.frequency.value = 300;
    g.gain.value = 0.0001;
    osc.connect(g); g.connect(master);
    osc.start();
    sweepVoices.set(sweep, { osc, g });
  }
  // 音画同步铁律：扫到哪听到哪（y=分数格，来自与显形判定同一个 scannerY）
  function sweepUpdate(sweep, cellFrac, active) {
    const v = sweepVoices.get(sweep);
    if (!v) return;
    const f = R.V16.cellFreqF ? R.V16.cellFreqF(cellFrac) : 440;
    v.osc.frequency.setTargetAtTime(Math.max(80, Math.min(2000, f)), ctx.currentTime, 0.02);
    v.g.gain.setTargetAtTime(active ? 0.06 : 0.0001, ctx.currentTime, 0.05);
  }
  function sweepStop(sweep) {
    const v = sweepVoices.get(sweep);
    if (!v) return;
    try { v.g.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.03); v.osc.stop(ctx.currentTime + 0.15); } catch (e) {}
    sweepVoices.delete(sweep);
  }
  function sweepStopAll() { for (const s of [...sweepVoices.keys()]) sweepStop(s); }

  // ===== 旋律播放：预渲染 mp3 优先，加载失败回退 WebAudio 合成 =====
  let melSource = null, melOnEnd = null;
  function stopMelody() {
    if (melSource) { try { melSource.stop(); } catch (e) {} melSource = null; }
    melOnEnd = null;
  }
  function playMelody(url, notes, beatSec, onEnd) {
    stopMelody();
    const c = ensure(); if (!c) return;
    const finish = () => { if (melOnEnd) { const f = melOnEnd; melOnEnd = null; f(); } };
    melOnEnd = onEnd || null;
    if (url && typeof fetch === 'function') {
      fetch(url).then(r => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
        .then(ab => c.decodeAudioData(ab))
        .then(buf => {
          if (melSource) return; // 已被重听打断
          const src = c.createBufferSource();
          src.buffer = buf;
          src.connect(master);
          src.onended = () => { if (melSource === src) { melSource = null; finish(); } };
          src.start();
          melSource = src;
        })
        .catch(() => synthMelody(notes, beatSec));
    } else {
      synthMelody(notes, beatSec);
    }
  }
  function synthMelody(notes, beatSec) {
    for (const n of notes) {
      tone(midiFreq(n.m), n.w * beatSec * 0.9, { type: 'triangle', vol: 0.2, delay: n.b * beatSec });
      tone(midiFreq(n.m) / 2, n.w * beatSec * 0.9, { type: 'sine', vol: 0.06, delay: n.b * beatSec });
    }
    const end = (notes.length ? Math.max(...notes.map(n => n.b + n.w)) : 4) * beatSec;
    setTimeout(() => { if (melOnEnd) { const f = melOnEnd; melOnEnd = null; f(); } }, end * 1000 + 50);
  }

  // ===== 事件音效 =====
  const SFX = {
    shot() { noise(0.06, { vol: 0.22, freq: 2400, filter: 'highpass' }); tone(660, 0.05, { type: 'square', vol: 0.08 }); },
    kill(cell) { tone(midiFreq(60 + 12), 0.14, { type: 'square', vol: 0.16, slide: midiFreq(72) / 2 }); noise(0.1, { vol: 0.18, freq: 1400 }); },
    breach() { tone(70, 0.3, { type: 'sine', vol: 0.5, slide: 40 }); noise(0.25, { vol: 0.4, freq: 500 }); },
    reveal() { tone(1568, 0.08, { type: 'sine', vol: 0.08 }); },
    deploy() { tone(220, 0.2, { type: 'sawtooth', vol: 0.1, slide: 440 }); },
    aim() { tone(880, 0.06, { type: 'square', vol: 0.08 }); },
    buy() { tone(1318, 0.1, { vol: 0.2 }); tone(1760, 0.14, { vol: 0.16, delay: 0.08 }); },
    deny() { tone(180, 0.15, { type: 'square', vol: 0.12 }); },
    win() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.35, { vol: 0.24, delay: i * 0.13 })); },
    lose() { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.4, { type: 'triangle', vol: 0.22, delay: i * 0.16 })); },
    tick() { tone(1200, 0.03, { vol: 0.05 }); },
  };

  return {
    ensure, setVolume, getVolume: () => volume,
    tone, noise, SFX,
    sweepStart, sweepUpdate, sweepStop, sweepStopAll,
    playMelody, stopMelody, synthMelody,
  };
});
