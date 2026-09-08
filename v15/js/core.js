/* V15 音浪尖塔 · 公共工具（浏览器 + Node TB 双端可用） */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V15 = root.V15 || {};
  Object.assign(root.V15, api);
})(typeof self !== 'undefined' ? self : globalThis, function () {
  'use strict';

  // 可播种随机（TB 复现自动通关用）
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function makeRng(seed) {
    const f = mulberry32(seed);
    return {
      seed,
      next: f,
      int(min, max) { return min + Math.floor(f() * (max - min + 1)); },
      pick(arr) { return arr[Math.floor(f() * arr.length)]; },
      shuffle(arr) {
        const a = arr.slice();
        for (let i = a.length - 1; i > 0; i--) {
          const j = Math.floor(f() * (i + 1));
          [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
      },
    };
  }

  let _id = 0;
  function uid(prefix) { return (prefix || 'n') + (++_id) + '_' + Math.floor(Math.random() * 1e6); }
  function resetIds() { _id = 0; }

  const LANES = 7;
  // 七轨唱名（do~si）与 WebAudio 频率
  const LANE_NAMES = ['do', 're', 'mi', 'fa', 'sol', 'la', 'si'];
  const LANE_FREQ = [261.63, 293.66, 329.63, 349.23, 392.0, 440.0, 493.88];

  // 敌方音符类型 → 数值骨架（任务书 2.5）
  const ENEMY_STATS = {
    single: { hp: 5, name: '单音' },
    std: { hp: 7, name: '标准音' },
    long: { hp: 13, name: '长音' },
    elite: { hp: 20, name: '重音', split: 2 }, // 死亡分裂 2 个单音
  };
  // 敌方英雄 HP（23:25 后平衡补丁：150/300/500 → 120/240/400，配冲线×2 保 4-6 回合体验目标）
  const ENEMY_HERO_HP = { normal: 120, elite: 220, boss: 400 };

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  return { mulberry32, makeRng, uid, resetIds, LANES, LANE_NAMES, LANE_FREQ, ENEMY_STATS, ENEMY_HERO_HP, clamp };
});
