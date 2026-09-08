/* V16 防空版 · 拦截结算模拟（纯逻辑，确定性，TB 可驱动）
 * 听辨阶段弹道不可见 → 探测波扫到才显形（限时消退）→ 防空炮只打显形目标（盲区不打）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V16 = root.V16 || {};
  Object.assign(root.V16, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const R = typeof self !== 'undefined' ? self : globalThis;
  const { clamp, CELLS, makeRng } = (R.V16 || {});

  // ===== 拦截阶段数值骨架（P0 初稿，先跑起来再调）=====
  const CFG = {
    LEAD: 2.5,          // 开打缓冲秒
    BEAT_SEC: 0.7,      // 拦截每拍秒数（听辨为时间慢流，原速 60/tempo；拦截即加速推进）
    FLY_BEATS: 6,       // 普通波导弹飞行时长（拍）
    BAND: 0.75,         // 扫描带半宽（格）
    REVEAL: 3.0,        // 显形时长（秒）——显形必消退
    SWEEP_PERIOD: 3.2,  // 扫描周期（秒）
    TRACK_PERIOD: 0.5,  // 跟踪型周期倍率（更快来回）
    TRACK_SHRINK: 0.2,  // 跟踪型范围向中段收缩比例
    MAX_SWEEPS: 3,      // 同波探测波上限
    SWEEP_COST: 1,      // 探测波部署 1 费/次
    HIT_DMG: 1,         // 漏网导弹命中 -1
    BOSS_DMG: 2,        // Boss 弹 -2
    KILL_REWARD: 0.5,   // 击落每弹 +0.5 费
    WAVE_BONUS: 3,      // 每波基础 3 费
  };

  const SHAPES = ['wave', 'rise', 'fall', 'mountain', 'valley'];
  const SHAPE_NAMES = { wave: '波浪', rise: '上升', fall: '下降', mountain: '山峰', valley: '山谷' };
  const MODES = ['search', 'track'];
  const MODE_NAMES = { search: '搜索型', track: '跟踪型' };

  // ===== 扫描位置（音画同步铁律：显形帧与音扫帧共用本函数）=====
  // 返回扫描头所在的分数格（0..13），t 为该波开启后的秒数
  function scannerY(sweep, t, upgrades) {
    const up = upgrades || {};
    const span = Math.max(1, sweep.hi - sweep.lo);
    let lo = sweep.lo, hi = sweep.hi, style = 'tri';
    if (sweep.shape === 'rise') style = 'up';
    else if (sweep.shape === 'fall') style = 'down';
    else if (sweep.shape === 'mountain') { const q = span * 0.25; lo += q; hi -= q; }         // 聚焦中部
    if (sweep.mode === 'track') { const q = span * CFG.TRACK_SHRINK; lo += q; hi -= q; }      // 跟踪型范围小
    let P = CFG.SWEEP_PERIOD * (sweep.mode === 'track' ? CFG.TRACK_PERIOD : 1);
    const lv = sweep.mode === 'track' ? (up.track || 0) : (up.search || 0);
    P *= Math.pow(0.92, lv);
    const range = Math.max(0.8, hi - lo);
    if (sweep.shape === 'valley') {
      // 聚焦两端：交替扫下端/上端
      const L = Math.max(0.8, span * 0.3);
      const half = Math.floor(t / P) % 2;
      const base = half === 0 ? sweep.lo : sweep.hi - L;
      const u = (t % P) / P;
      return base + L * (u < 0.5 ? u * 2 : (1 - u) * 2);
    }
    if (style === 'up') return lo + range * ((t % P) / P);                 // 单向扫
    if (style === 'down') return hi - range * ((t % P) / P);               // 单向扫
    const u = (t % (P * 2)) / P;                                           // 来回扫
    return u < 1 ? lo + range * u : hi - range * (u - 1);
  }

  // 跟踪型显形更久：基础 +0.6s，每级再 +0.6s
  function revealDur(sweep, upgrades) {
    const up = upgrades || {};
    return CFG.REVEAL + (sweep.mode === 'track' ? 0.6 * (1 + (up.track || 0)) : 0);
  }
  // 搜索型扫得更宽：+0.2 格/级
  function bandHalf(sweep, upgrades) {
    const up = upgrades || {};
    return CFG.BAND + (sweep.mode === 'search' ? 0.2 * (up.search || 0) : 0);
  }

  // ===== 建战场 =====
  // wave: song.getWave 产物；guns: [{cell,cover,dmg,rate}]；upgrades: {search,track}
  function createBattle({ wave, guns, upgrades, gold, baseHP, seed }) {
    const b = {
      wave,
      boss: !!wave.boss,
      guns: (guns || []).map(g => ({ ...g, cd: 0, flashT: -9 })),
      upgrades: { search: 0, track: 0, ...(upgrades || {}) },
      gold: gold != null ? gold : 0,
      baseHP,
      t: 0,
      phase: 'deploy',            // deploy（听辨+部署窗口）→ run（拦截）→ done
      sweeps: [],
      missiles: wave.notes.map(n => ({
        id: n.id, cell: n.cell, beat: n.beat, dur: n.dur,
        hp: n.hp, maxHp: n.hp, midi: n.midi,
        arriveT: CFG.LEAD + n.beat * CFG.BEAT_SEC,
        bornT: 0,                 // startRun 定
        revealT: -99, revealDur: 0,
        alive: true,
      })),
      killed: 0, breached: 0,
      events: [],
      result: undefined,          // 'win' | 'lose'
      seed, rng: makeRng(seed != null ? seed : 1),
    };
    const last = Math.max(...b.missiles.map(m => m.arriveT));
    b.lastArriveT = last;
    return b;
  }

  // ===== 部署窗口操作（与听辨重叠）=====
  function deploySweep(b, { shape, lo, hi, mode }) {
    if (b.phase !== 'deploy') throw new Error('已开打，不能再部署');
    if (!SHAPES.includes(shape)) throw new Error('图样非法');
    if (!MODES.includes(mode)) throw new Error('模式非法');
    if (b.sweeps.length >= CFG.MAX_SWEEPS) throw new Error('探测波已达上限');
    if (b.gold < CFG.SWEEP_COST) throw new Error('费用不足');
    lo = clamp(Math.round(lo), 0, CELLS - 2);
    hi = clamp(Math.round(hi), lo + 1, CELLS - 1);
    b.gold -= CFG.SWEEP_COST;
    const s = { shape, lo, hi, mode, bornT: b.t };
    b.sweeps.push(s);
    b.events.push({ t: b.t, k: 'deploy', shape, lo, hi, mode });
    return s;
  }
  // 炮火重指向免费（P0 简化）。覆盖=半径语义：「覆盖2格」=前后各2格（5格跨度）
  function aimGun(b, gunIdx, cell) {
    if (b.phase !== 'deploy') throw new Error('已开打，不能重指向');
    const g = b.guns[gunIdx];
    if (!g) throw new Error('炮台不存在');
    g.cell = clamp(Math.round(cell), g.cover, CELLS - 1 - g.cover);
    b.events.push({ t: b.t, k: 'aim', gun: gunIdx, cell: g.cell });
    return g.cell;
  }
  function startRun(b) {
    if (b.phase !== 'deploy') throw new Error('已在拦截中');
    b.phase = 'run';
    b.t = 0;
    for (const s of b.sweeps) s.bornT = 0;
    for (const m of b.missiles) {
      m.arriveT = CFG.LEAD + m.beat * CFG.BEAT_SEC;
      // Boss 波全弹齐发：开打即全部在场；普通波按拍分批进入
      m.bornT = b.boss ? 0 : Math.max(0, m.arriveT - CFG.FLY_BEATS * CFG.BEAT_SEC);
    }
    b.lastArriveT = Math.max(...b.missiles.map(m => m.arriveT));
    b.events.push({ t: 0, k: 'start' });
  }

  function visible(m, t) { return m.revealT >= 0 && (t - m.revealT) <= m.revealDur; }

  // ===== 推进 dt 秒（确定性；UI 按 ×1/×2/×4 步进调用，TB 同样）=====
  function step(b, dt) {
    if (b.phase !== 'run') return b.events;
    b.t += dt;
    const t = b.t;

    // 1) 探测波扫到 = 显形（扫到哪听到哪，显形帧=音扫帧）
    for (const s of b.sweeps) {
      s.y = scannerY(s, t - s.bornT, b.upgrades);
    }
    for (const m of b.missiles) {
      if (!m.alive || t < m.bornT) continue;
      for (const s of b.sweeps) {
        if (Math.abs(s.y - m.cell) <= bandHalf(s, b.upgrades)) {
          const wasVisible = visible(m, t);
          m.revealT = t;
          m.revealDur = revealDur(s, b.upgrades);
          if (!wasVisible) b.events.push({ t, k: 'reveal', id: m.id, cell: m.cell, midi: m.midi, mode: s.mode });
        }
      }
    }

    // 2) 防空炮自动对显形目标开火（未显形=盲区，不打）
    b.guns.forEach((g, gi) => {
      g.cd -= dt;
      if (g.cd > 0) return;
      let target = null;
      for (const m of b.missiles) {
        if (!m.alive || t < m.bornT || !visible(m, t)) continue;      // 盲区规则实锤
        if (Math.abs(m.cell - g.cell) > g.cover) continue;            // 覆盖半径
        if (!target || m.arriveT < target.arriveT) target = m;        // 最先到基地的优先
      }
      if (target) {
        g.cd = 1 / g.rate;
        g.flashT = t;
        target.hp -= g.dmg;
        b.events.push({ t, k: 'shot', gun: gi, id: target.id, cell: target.cell });
        if (target.hp <= 0) {
          target.alive = false;
          b.killed++;
          b.gold += CFG.KILL_REWARD;
          b.events.push({ t, k: 'kill', id: target.id, cell: target.cell, midi: target.midi });
        }
      } else {
        g.cd = 0; // 待机
      }
    });

    // 3) 漏网导弹命中基地（Boss 波导弹 -2，普通 -1）
    for (const m of b.missiles) {
      if (!m.alive || t < m.arriveT) continue;
      m.alive = false;
      m.breach = true;
      b.breached++;
      const dmg = b.boss ? CFG.BOSS_DMG : CFG.HIT_DMG;
      b.baseHP -= dmg;
      b.events.push({ t, k: 'breach', id: m.id, cell: m.cell, dmg });
      if (b.baseHP <= 0) { b.baseHP = 0; b.result = 'lose'; b.phase = 'done'; b.events.push({ t, k: 'lose' }); return b.events; }
    }

    // 4) 波清完 = 胜利
    if (t > b.lastArriveT + 0.8 && b.missiles.every(m => !m.alive)) {
      b.result = 'win';
      b.phase = 'done';
      b.events.push({ t, k: 'win' });
    }
    return b.events;
  }

  // 导弹位置（0=远处，1=基地），UI 渲染与 TB 共用
  function missileProg(b, m) {
    const t = b.t;
    if (t <= m.bornT) return 0;
    if (t >= m.arriveT) return 1;
    return (t - m.bornT) / (m.arriveT - m.bornT);
  }

  return {
    CFG, SHAPES, SHAPE_NAMES, MODES, MODE_NAMES,
    createBattle, deploySweep, aimGun, startRun, step,
    scannerY, revealDur, bandHalf, missileProg, visible,
  };
});
