/* V16 防空版 · 对局生命周期 / 商店 / 胜负记录（纯逻辑，双端）
 * 依赖：core.js + battle.js + song.js 已加载（浏览器顺序 script；TB createRequire）
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V16 = root.V16 || {};
  Object.assign(root.V16, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';
  const R = typeof self !== 'undefined' ? self : globalThis;
  const B = R.V16 && R.V16.CFG ? R.V16 : null; // battle/core 已并入 V16 命名空间
  const { makeRng } = B || {};

  // ===== 存储（浏览器 localStorage / TB 注入内存桶）=====
  function store() {
    if (typeof localStorage !== 'undefined') return localStorage;
    if (!R.__v16_memStorage) R.__v16_memStorage = { getItem: k => (k in R.__v16_memStorage.d ? R.__v16_memStorage.d[k] : null), setItem: (k, v) => { R.__v16_memStorage.d[k] = String(v); }, removeItem: k => { delete R.__v16_memStorage.d[k]; }, d: {} };
    return R.__v16_memStorage;
  }
  const REC_KEY = 'v16_record';
  function loadRecord() {
    try { return JSON.parse(store().getItem(REC_KEY)) || { w: 0, l: 0 }; } catch (e) { return { w: 0, l: 0 }; }
  }
  function saveRecord(rec) { store().setItem(REC_KEY, JSON.stringify(rec)); }

  // ===== 商店 6 格（覆盖=半径：前后各 N 格）=====
  const SHOP_ITEMS = [
    { id: 'dmg', name: '炮弹伤害 +1', max: 3, base: 4, step: 2, desc: '两座炮伤害各 +1' },
    { id: 'rate', name: '射速 +0.4/秒', max: 3, base: 4, step: 2, desc: '两座炮射速各 +0.4 发/秒' },
    { id: 'cover', name: '覆盖段 +1', max: 2, base: 6, step: 3, desc: '两座炮覆盖半径各 +1 格' },
    { id: 'search', name: '探测·搜索型', max: 3, base: 4, step: 2, desc: '扫描带更宽、刷新更快' },
    { id: 'track', name: '探测·跟踪型', max: 3, base: 4, step: 2, desc: '锁定段高频回扫、显形更久' },
    { id: 'hp', name: '基地装甲 +3', max: 3, base: 4, step: 2, desc: '基地 HP 上限与现值 +3' },
  ];
  function shopPrice(item, lv) { return item.base + item.step * lv; }
  function genShop(run) {
    run.shop = SHOP_ITEMS.map((it, i) => {
      const lv = run.up[it.id];
      return { idx: i, id: it.id, name: it.name, desc: it.desc, lv, max: it.max, price: shopPrice(it, lv), sold: false };
    });
    return run.shop;
  }
  function applyUpgrade(run, id) {
    run.up[id]++;
    if (id === 'hp') { run.maxBaseHP += 3; run.baseHP += 3; }
  }
  function buyShop(run, idx) {
    if (run.phase !== 'shop' || !run.shop) throw new Error('不在商店');
    const s = run.shop[idx];
    if (!s || s.sold) throw new Error('已售出');
    if (s.lv >= s.max) throw new Error('已满级');
    if (run.gold < s.price) throw new Error('费用不足');
    run.gold -= s.price;
    s.sold = true;
    applyUpgrade(run, s.id);
    return s;
  }
  function leaveShop(run) {
    if (run.phase !== 'shop') throw new Error('不在商店');
    run.shop = null;
    run.phase = 'wave';
  }

  // ===== 对局 =====
  // 初始配置：炮 2 座、基地 HP 10、导弹命中 -1、Boss 弹 -2
  function effGuns(run) {
    return run.guns.map(g => ({
      ...g,
      dmg: 1 + run.up.dmg,
      rate: 1 + 0.4 * run.up.rate,
      cover: Math.min(4, 2 + run.up.cover),
    }));
  }
  function newRun(seed, songData) {
    const rng = makeRng(seed);
    const tierIdx = (R.V16 && R.V16.pickTier) ? R.V16.pickTier(songData || { tiers: [0, 1, 2] }, rng) : rng.int(0, 2);
    return {
      seed,
      tierIdx,                       // 移调档：重开必变（防背题）
      gold: 0,
      baseHP: 10, maxBaseHP: 10,
      waveIdx: 0,
      phase: 'wave',                 // wave | shop | victory | defeat
      guns: [{ cell: 4, cover: 2, dmg: 1, rate: 1 }, { cell: 9, cover: 2, dmg: 1, rate: 1 }],
      up: { dmg: 0, rate: 0, cover: 0, search: 0, track: 0, hp: 0 },
      shop: null,
      battle: null,
      result: undefined,
    };
  }
  // 每波开始：+3 基础费，建战场（部署窗口=听辨+部署）
  function startWave(run, songData) {
    if (run.phase !== 'wave') throw new Error('当前不在波次阶段');
    run.gold += B.CFG.WAVE_BONUS;
    const wave = R.V16.getWave(songData, run.tierIdx, run.waveIdx);
    run.battle = B.createBattle({
      wave,
      guns: effGuns(run),
      upgrades: { search: run.up.search, track: run.up.track },
      gold: run.gold,
      baseHP: run.baseHP,
      seed: run.seed + run.waveIdx * 131,
    });
    return run.battle;
  }
  function endWave(run) {
    const b = run.battle;
    if (!b || !b.result) throw new Error('波次未结束');
    run.gold = b.gold;
    run.baseHP = b.baseHP;
    if (b.result === 'lose') {
      run.phase = 'defeat';
      run.result = 'defeat';
      const rec = loadRecord(); rec.l++; saveRecord(rec);
      run.battle = null;
      return 'defeat';
    }
    run.waveIdx++;
    if (run.waveIdx >= 4) {
      run.phase = 'victory';
      run.result = 'victory';
      const rec = loadRecord(); rec.w++; saveRecord(rec);
      run.battle = null;
      return 'victory';
    }
    run.phase = 'shop';
    run.battle = null;
    genShop(run);
    return 'shop';
  }

  return {
    SHOP_ITEMS, shopPrice, genShop, buyShop, leaveShop,
    newRun, startWave, endWave, effGuns,
    loadRecord, saveRecord, REC_KEY,
  };
});
