/* V15 音浪尖塔 · WebAudio 全合成音效 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V15 = root.V15 || {};
  Object.assign(root.V15, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const R = typeof self !== 'undefined' ? self : globalThis;
  const { LANE_FREQ } = R.V15 || {};
  let ctx = null, master = null;
  let volume = 0.7;

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
  function getVolume() { return volume; }

  // 基础音：type 波形 / freq 频率 / dur 时长 / vol 音量 / slide 频率滑向
  function tone(freq, dur, opts = {}) {
    const c = ensure(); if (!c) return;
    const t0 = c.currentTime;
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
    const t0 = c.currentTime;
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

  const LANE_F = LANE_FREQ || [261.63, 293.66, 329.63, 349.23, 392, 440, 493.88];
  const SFX = {
    // 轨道唱名短音（放置/预演）
    lane(lane, oct = 0, dur = 0.15) { tone(LANE_F[lane] * Math.pow(2, oct), dur, { vol: 0.22, attack: dur > 0.3 ? 0.02 : 0.008 }); },
    // 对撞爆炸
    boom() { noise(0.18, { vol: 0.4, freq: 700 }); tone(90, 0.15, { type: 'square', vol: 0.12, slide: 40 }); },
    // 连锁 combo：上行音阶爬升
    combo(n) {
      const base = LANE_F[0] * Math.pow(2, (n * 2) / 12);
      tone(base, 0.12, { type: 'triangle', vol: 0.26 });
      tone(base * 1.5, 0.1, { type: 'sine', vol: 0.14 });
    },
    // 漏网打英雄：低频 thud
    thud() { tone(70, 0.22, { type: 'sine', vol: 0.5, slide: 45 }); noise(0.1, { vol: 0.15, freq: 300 }); },
    // 冲线打 Boss：金光直击
    strike() { tone(880, 0.12, { type: 'square', vol: 0.18 }); tone(1320, 0.18, { type: 'sine', vol: 0.2, slide: 1760 }); },
    // 共振大字
    resonate() { [0, 4, 7, 12].forEach((st, i) => setTimeout(() => tone(440 * Math.pow(2, st / 12), 0.35, { vol: 0.22 }), i * 70)); },
    // 毒/燃烧
    poison() { tone(220, 0.2, { type: 'sawtooth', vol: 0.1, slide: 160 }); },
    burn() { noise(0.22, { vol: 0.18, freq: 1600, filter: 'highpass' }); },
    // 胜利 do-mi-so-do 琶音
    victory() { [261.63, 329.63, 392, 523.25].forEach((f, i) => setTimeout(() => tone(f, 0.4, { vol: 0.26 }), i * 130)); },
    // 败北
    defeat() { [392, 311.13, 261.63, 196].forEach((f, i) => setTimeout(() => tone(f, 0.5, { type: 'triangle', vol: 0.22 }), i * 200)); },
    // 按钮/UI
    ui() { tone(660, 0.06, { type: 'sine', vol: 0.12 }); },
    // Boss 阶段横幅
    phase() { tone(110, 0.6, { type: 'sawtooth', vol: 0.2 }); tone(220, 0.5, { type: 'square', vol: 0.1 }); },
    // 敌音起飞
    takeoff() { tone(500, 0.1, { type: 'sine', vol: 0.1, slide: 900 }); },
  };

  return { ensure, setVolume, getVolume, SFX };
});
