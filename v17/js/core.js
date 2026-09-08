/* V17 核心逻辑（纯函数，Node 可 require / 浏览器可 <script>）
 * 干扰卡生成（P0 两招：音区平移 + 局部形变）、判定计分、评级、时间线工具。
 * 所有随机走可注入种子的 mulberry32，TB 测试可复现。
 */
(function (root, factory) {
  var api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.V17 = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var CFG = {
    maxHp: 5,
    baseScore: 100,
    comboStep: 0.2,
    comboCap: 3,
    // 可听性门限：干扰与真身的差异必须落在此区间（半音）
    minMeanDiff: 1.0,
    minMaxDiff: 2.0,
    maxMeanDiff: 6.5,
  };

  // ---------- 随机 ----------
  function rng(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function median(arr) {
    var v = arr.filter(function (x) { return x !== null; }).sort(function (a, b) { return a - b; });
    if (!v.length) return null;
    var m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  }

  // ---------- 干扰卡 ----------
  // midi: (number|null)[]，null = 无声帧（曲线断口，两卡断口保持一致，不构成提示）
  // kind: 'shift' 音区平移(±2~3st) | 'flip' 局部形变(峰谷翻转) | 'auto' 掷币
  // 返回 {kind, curve, meanD, maxD, attempts}；过不了可听性门限就换参数重试
  function makeDecoy(midi, rand, kind) {
    if (kind === 'auto' || kind === undefined) kind = rand() < 0.5 ? 'shift' : 'flip';
    var best = null;
    for (var att = 1; att <= 10; att++) {
      var curve = kind === 'shift' ? decoyShift(midi, rand) : decoyFlip(midi, rand);
      var d = diffStats(midi, curve);
      if (d.pairs >= 10 && d.mean >= CFG.minMeanDiff && d.max >= CFG.minMaxDiff && d.mean <= CFG.maxMeanDiff) {
        return { kind: kind, curve: curve, meanD: d.mean, maxD: d.max, attempts: att };
      }
      if (!best || d.mean > best.meanD) best = { kind: kind, curve: curve, meanD: d.mean, maxD: d.max, attempts: att };
    }
    // 10 次都出不了门限（近乎只发生在全平曲线）→ 兜底 ±3st 平移
    var fall = decoyShift(midi, rand, 3);
    var fd = diffStats(midi, fall);
    fall.kind = kind;
    return { kind: kind, curve: fall, meanD: fd.mean, maxD: fd.max, attempts: 11 };
  }

  function decoyShift(midi, rand, force) {
    var st = force || (2 + rand()) * (rand() < 0.5 ? -1 : 1); // ±[2,3] 半音
    return midi.map(function (v) { return v === null ? null : round2(v + st); });
  }

  function decoyFlip(midi, rand) {
    var n = midi.length;
    var len = Math.round(n * (0.15 + 0.2 * rand()));
    len = Math.max(Math.round(n * 0.12), Math.min(len, Math.round(n * 0.4), n - 4));
    var i0 = 1 + Math.floor(rand() * (n - len - 2));
    var slice = midi.slice(i0, i0 + len);
    var med = median(slice);
    var extra = rand() < 0.5 ? (1 + rand() * 1.5) * (rand() < 0.5 ? -1 : 1) : 0; // 翻转后再挪半音级，防呆
    var out = midi.slice();
    var B = Math.max(3, Math.min(8, len >> 2)); // 边缘混合，避免断崖
    for (var j = 0; j < len; j++) {
      var v = slice[j];
      if (v === null) continue;
      var fv = 2 * med - v + extra;
      var w = 1;
      if (j < B) w = (j + 1) / (B + 1);
      else if (j >= len - B) w = (len - j) / (B + 1);
      out[i0 + j] = round2(w * fv + (1 - w) * v);
    }
    return out;
  }

  function diffStats(a, b) {
    var s = 0, mx = 0, pairs = 0;
    for (var i = 0; i < a.length; i++) {
      if (a[i] === null || b[i] === null) continue;
      var d = Math.abs(a[i] - b[i]);
      s += d; pairs++; if (d > mx) mx = d;
    }
    return { mean: pairs ? s / pairs : 0, max: mx, pairs: pairs };
  }

  function round2(v) { return Math.round(v * 100) / 100; }

  // ---------- 一轮（38 卡）的真假布局 ----------
  // 返回与 cards 等长的数组：{side:'L'|'R', decoy:{...}}，真身曲线由调用方按 cards 取
  function buildRound(cards, seed) {
    var rand = rng(seed);
    return cards.map(function (c) {
      return {
        side: rand() < 0.5 ? 'L' : 'R',
        decoy: makeDecoy(c.midi, rand, 'auto'),
      };
    });
  }

  // ---------- 判定 / 计分 ----------
  // 连击系数：+0.2/连，上限 ×3（首答 ×1）
  function scoreFor(comboBefore) {
    return Math.round(CFG.baseScore * Math.min(CFG.comboCap, 1 + CFG.comboStep * comboBefore));
  }
  function newState() {
    return { hp: CFG.maxHp, score: 0, combo: 0, maxCombo: 0, correct: 0, answered: 0, dead: false };
  }
  function applyCorrect(st) {
    var gained = scoreFor(st.combo);
    st.combo += 1;
    if (st.combo > st.maxCombo) st.maxCombo = st.combo;
    st.score += gained;
    st.correct += 1;
    st.answered += 1;
    return gained;
  }
  function applyWrong(st) {
    st.combo = 0;
    st.hp -= 1;
    st.answered += 1;
    if (st.hp <= 0) st.dead = true;
    return st.hp;
  }
  function accuracy(st) { return st.answered ? st.correct / st.answered : 0; }
  // 评级：S>=95% / A>=85 / B>=70 / C 其他；血尽 = 败
  function rating(st) {
    if (st.dead) return '败';
    var a = accuracy(st);
    return a >= 0.95 ? 'S' : a >= 0.85 ? 'A' : a >= 0.70 ? 'B' : 'C';
  }

  // ---------- 时间线（音画同步的数字面） ----------
  function activeCardAt(cards, t) {
    for (var i = 0; i < cards.length; i++) {
      if (t >= cards[i].start && t < cards[i].end) return i;
    }
    return -1;
  }
  // 进度条：燃烧进度 = 小节内播放进度，烧完即结算窗口
  function cardProgress(card, t) {
    var p = (t - card.start) / (card.end - card.start);
    return p < 0 ? 0 : p > 1 ? 1 : p;
  }
  // 间奏/无声窗：不出卡（与 export_curves.py 的唱段聚合同参：gap<=1.2s 视为连续）
  function restWindows(cards, songDur) {
    var gaps = [], prev = 0;
    for (var i = 0; i < cards.length; i++) {
      if (cards[i].start - prev > 0.5) gaps.push([prev, cards[i].start]);
      prev = cards[i].end;
    }
    if (songDur - prev > 0.5) gaps.push([prev, songDur]);
    return gaps;
  }

  return {
    CFG: CFG,
    rng: rng,
    median: median,
    makeDecoy: makeDecoy,
    buildRound: buildRound,
    scoreFor: scoreFor,
    newState: newState,
    applyCorrect: applyCorrect,
    applyWrong: applyWrong,
    accuracy: accuracy,
    rating: rating,
    activeCardAt: activeCardAt,
    cardProgress: cardProgress,
    restWindows: restWindows,
  };
});
