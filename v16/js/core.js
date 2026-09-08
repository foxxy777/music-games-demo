/* V16 防空版 · 公共工具（浏览器 + Node TB 双端可用） */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V16 = root.V16 || {};
  Object.assign(root.V16, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 可播种随机（TB 复现 + 移调随机用）
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 14)) >>> 0) / 4294967296;
      return t;
    };
  }
  function makeRng(seed) {
    const f = mulberry32(seed);
    return {
      seed,
      next: f,
      int(min, max) { return min + Math.floor(f() * (max - min + 1)); },
      pick(arr) { return arr[Math.floor(f() * arr.length)]; },
    };
  }

  let _id = 0;
  function uid(prefix) { return (prefix || 'n') + (++_id) + '_' + Math.floor(Math.random() * 1e6); }
  function resetIds() { _id = 0; }
  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  // ===== 音高轴：两个八度、半音合并（do/升do 同格），14 格，格 0 在下 =====
  const CELLS = 14;
  // 一个八度 12 半音 → 7 格：C/C# 同格、D/D# 同格、E、F/F# 同格、G/G# 同格、A/A# 同格、B
  const CHROM2CELL = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  // 每格代表音（白键半音数，格内左边的白键），用于显示与扫描音高
  const CELL_SEMI = [0, 2, 4, 5, 7, 9, 11];
  const CELL_NAMES = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'];
  const GRID_BASE_MIDI = 48; // 格 0 = C3

  function midiToCell(m) {
    const oct = Math.floor(m / 12) - Math.floor(GRID_BASE_MIDI / 12);
    return oct * 7 + CHROM2CELL[((m % 12) + 12) % 12];
  }
  // 超出 14 格的音按八度折回（名曲音域可能 >2 个八度）
  function foldCell(c) {
    while (c < 0) c += 7;
    while (c >= CELLS) c -= 7;
    return c;
  }
  function cellToMidi(c) {
    return Math.floor(c / 7) * 12 + GRID_BASE_MIDI + CELL_SEMI[c % 7];
  }
  function midiFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  // 扫描音高：分数格在相邻两格白键频率间线性插值（探测音=扫到哪听到哪）
  function cellFreqF(c) {
    const lo = clamp(Math.floor(c), 0, CELLS - 1);
    const hi = Math.min(CELLS - 1, lo + 1);
    const f0 = midiFreq(cellToMidi(lo));
    const f1 = midiFreq(cellToMidi(hi));
    return f0 + (f1 - f0) * clamp(c - lo, 0, 1);
  }
  function cellName(c) {
    const oct = Math.floor(c / 7);
    return CELL_NAMES[c % 7] + (oct === 0 ? '˙' : oct === 1 ? '·' : '');
  }

  return {
    mulberry32, makeRng, uid, resetIds, clamp,
    CELLS, CHROM2CELL, CELL_SEMI, CELL_NAMES, GRID_BASE_MIDI,
    midiToCell, foldCell, cellToMidi, midiFreq, cellFreqF, cellName,
  };
});
