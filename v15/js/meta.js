/* V15 音浪尖塔 · Run 状态机 / 地图 / 存档 / 非战斗节点（纯逻辑，可序列化）
 *
 * 地图模型（任务书 5.2「15 层分支」+ 配额 16 节点 = 玩家路径 15 步 + Boss）：
 *   每层 1~3 个候选节点，同层候选同类型（战斗层=不同曲目，选路有真实差异）；
 *   层类型计划 = 配额洗牌（7⚔ 2💀 1💰 2🔥 2❓ 1📦），任何走线都精确符合配额。
 *   相邻层全连接，只能走 floor+1 层（未走层迷雾由 UI 表现）。
 */
(function (root, factory) {
  const api = factory(root.V15 || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V15 = root.V15 || {};
  Object.assign(root.V15, api);
})(typeof self !== 'undefined' ? self : globalThis, function (V15) {
  'use strict';
  const { makeRng, ENEMY_HERO_HP } = V15;
  const { startingDeck, makeCard, cardDef, POOL_IDS, RELIC_IDS } = V15;

  const SAVE_KEY = 'v15_save';
  const FLOORS = 15;

  // ---------- 随机（run 保持纯 JSON 可序列化：计数器派生独立 rng） ----------
  function rnd(run) { run.seedCounter = (run.seedCounter || 0) + 1; return makeRng((run.seed * 2654435761 + run.seedCounter * 7919) >>> 0); }

  // ---------- 地图生成 ----------
  // 战斗曲目按「玩家第几场战斗」动态决定（enterBattle 时）：
  // 第 1-2 场 twinkle / 3-4 ode / 5-6 elise；精英 canon；Boss fate
  function genMap(run) {
    const r = rnd(run);
    // 层类型计划：配额袋洗牌，加约束（精英不在前 5 层、篝火不在最后 3 层）
    const bag = ['battle', 'battle', 'battle', 'battle', 'battle', 'battle', 'battle',
      'elite', 'elite', 'shop', 'campfire', 'campfire', 'event', 'event', 'chest'];
    let plan;
    for (let tries = 0; tries < 200; tries++) {
      plan = r.shuffle(bag);
      const ei = plan.indexOf('elite');
      const fi = plan.lastIndexOf('campfire');
      if (plan[0] === 'battle' && ei >= 5 && fi <= 11 && fi >= 2) break;
    }
    if (plan[0] !== 'battle') { // 兜底：首层强制战斗（与首个战斗层交换）
      const bi = plan.indexOf('battle');
      [plan[0], plan[bi]] = [plan[bi], plan[0]];
    }
    const floors = [];
    for (let f = 0; f < FLOORS; f++) {
      const type = plan[f];
      // 分支层：首层 3 候选；其余 40% 概率 2 候选（战斗层不同曲目才有意义，但非战斗层保留路线选择）
      let count = 1;
      if (f === 0) count = 3;
      else if (f < FLOORS - 1 && r.next() < 0.4) count = 2;
      const nodes = [];
      for (let k = 0; k < count; k++) nodes.push(mkNode(type, f));
      floors.push(nodes);
    }
    floors.push([{ type: 'boss', id: 'boss_' + FLOORS }]); // 第 16 行 = Boss
    run.map = { floors };
  }
  function mkNode(type, f) {
    return { type, id: type + '_' + f + '_' + Math.floor(Math.random() * 1e6) };
  }

  // ---------- Run ----------
  function newRun(seed) {
    const run = {
      seed: seed != null ? seed : (Math.random() * 1e9) | 0,
      seedCounter: 0,
      playerHP: 100, playerMaxHP: 100,
      gold: 99,
      deck: startingDeck(),
      relics: [],
      floor: -1,          // 当前所在层（-1 = 未出发，地图入口）
      pos: null,          // 当前节点
      battlesWon: 0,
      modifiers: { fastNext: false, goldX2Next: false },
      pendingRewards: null, // {cards:[inst...], relic?:id, kind:'battle'|'elite'|'event'}
      phase: 'map',
      stats: { totalDamage: 0, totalTurns: 0, resonanceProcs: 0 },
      over: false, result: null,
    };
    genMap(run);
    return run;
  }

  function curFloorNodes(run) {
    const f = run.floor + 1;
    if (f >= run.map.floors.length) return null;
    return run.map.floors[f];
  }

  // 走到下一层某节点
  function enterNode(run, idx) {
    const nodes = curFloorNodes(run);
    if (!nodes || !nodes[idx]) throw new Error('节点不存在');
    run.floor += 1;
    run.pos = nodes[idx];
    run.phase = run.pos.type;
    return run.pos;
  }

  // 节点 → 波次配置
  function battleConfig(run) {
    if (run.pos.type === 'elite') return { waveId: 'canon', kind: 'elite' };
    if (run.pos.type === 'boss') return { waveId: 'fate', kind: 'boss' };
    const i = run.battlesWon; // 第几场普通战（0 起）
    const waveId = i < 2 ? 'twinkle' : i < 4 ? 'ode' : 'elise';
    return { waveId, kind: 'normal', fast: run.modifiers.fastNext };
  }

  // 战斗胜利结算
  function winBattle(run, battle) {
    const isElite = run.pos.type === 'elite', isBoss = run.pos.type === 'boss';
    const r = rnd(run);
    let gold = isBoss ? 100 : isElite ? r.int(25, 40) : r.int(10, 20);
    if (run.modifiers.goldX2Next) { gold *= 2; run.modifiers.goldX2Next = false; }
    run.modifiers.fastNext = false;
    run.gold += gold;
    run.battlesWon += 1;
    run.stats.totalDamage += battle.stats ? battle.stats.damage : 0;
    run.stats.totalTurns += battle.turn;
    run.stats.resonanceProcs += battle.stats ? battle.stats.resonance : 0;

    // 奖励：3 选 1 卡；精英额外遗物
    const rr = rnd(run);
    run.pendingRewards = { kind: isBoss ? 'boss' : isElite ? 'elite' : 'normal', gold, cards: rr.shuffle(POOL_IDS).slice(0, 3).map(id => makeCard(id)) };
    if (isElite) {
      const left = RELIC_IDS.filter(id => !run.relics.includes(id));
      if (left.length) run.pendingRewards.relic = rr.pick(left);
    }
    run.phase = 'reward';
    if (isBoss) { run.over = true; run.result = 'victory'; }
    save(run);
    return run.pendingRewards;
  }

  function loseBattle(run) {
    run.over = true; run.result = 'gameover';
    clearSave();
    return run;
  }

  function takeRewardCard(run, idx) {
    if (!run.pendingRewards) return null;
    const inst = run.pendingRewards.cards[idx];
    if (inst) run.deck.push(inst);
    run.pendingRewards.cards = [];
    finishReward(run);
    return inst;
  }
  // 拿遗物不结束奖励流程（同一奖励里还可能拿卡/跳过）
  function takeRewardRelic(run) {
    if (run.pendingRewards && run.pendingRewards.relic) {
      const rid = run.pendingRewards.relic;
      run.relics.push(rid);
      run.pendingRewards.relic = null;
      save(run);
      return rid;
    }
    return null;
  }
  function skipReward(run) { finishReward(run); }
  function finishReward(run) { run.pendingRewards = null; run.phase = 'map'; save(run); }

  // ---------- 商店 ----------
  function genShop(run) {
    const r = rnd(run);
    run.shop = {
      cards: r.shuffle(POOL_IDS).slice(0, 3).map(id => ({ inst: makeCard(id), price: r.int(50, 80), sold: false })),
      relic: (() => { const left = RELIC_IDS.filter(id => !run.relics.includes(id)); return left.length ? { id: r.pick(left), price: 150, sold: false } : null; })(),
      removePrice: 75,
      removeUsed: false,
    };
    run.phase = 'shop';
    return run.shop;
  }
  function buyCard(run, idx) {
    const it = run.shop.cards[idx];
    if (!it || it.sold) throw new Error('已售出');
    if (run.gold < it.price) throw new Error('金币不足');
    run.gold -= it.price; it.sold = true; run.deck.push(it.inst);
    save(run);
  }
  function buyRelic(run) {
    const it = run.shop.relic;
    if (!it || it.sold) throw new Error('已售出');
    if (run.gold < it.price) throw new Error('金币不足');
    run.gold -= it.price; it.sold = true; run.relics.push(it.id);
    save(run);
  }
  function buyRemove(run, deckIdx) {
    if (run.shop.removeUsed) throw new Error('本店已删过');
    if (run.gold < run.shop.removePrice) throw new Error('金币不足');
    if (!run.deck[deckIdx]) throw new Error('卡牌序号非法');
    run.gold -= run.shop.removePrice;
    run.deck.splice(deckIdx, 1);
    run.shop.removeUsed = true;
    save(run);
  }
  function leaveShop(run) { run.shop = null; run.phase = 'map'; save(run); }

  // ---------- 篝火 ----------
  function campfireRest(run) {
    const heal = Math.ceil(run.playerMaxHP * 0.35); // 35%（大爷确认口径）
    run.playerHP = Math.min(run.playerMaxHP, run.playerHP + heal);
    run.phase = 'map'; save(run);
    return heal;
  }
  function campfireUpgrade(run, deckIdx) {
    const c = run.deck[deckIdx];
    if (!c) throw new Error('卡牌序号非法');
    if (c.up >= 1) throw new Error('已升级过');
    c.up = 1;
    run.phase = 'map'; save(run);
    return c;
  }

  // ---------- 事件（3 个，二选一） ----------
  const EVENTS = [
    {
      id: 'musicbox', name: '走音的八音盒', emoji: '🎵',
      desc: '柜台上的八音盒走音了，修好它下场战斗敌曲会加速，但赏金翻倍。',
      options: [
        { label: '修理它（下场战斗敌曲加速，金币×2）', apply(run) { run.modifiers.fastNext = true; run.modifiers.goldX2Next = true; } },
        { label: '砸了卖零件（+50 金币）', apply(run) { run.gold += 50; } },
      ],
    },
    {
      id: 'tuner', name: '神秘调音师', emoji: '🎩',
      desc: '斗篷人指了指自己的耳朵，又指了指你的琴谱。',
      options: [
        { label: '听他一曲（3 选 1 加一张卡）', apply(run) {
            const r = rnd(run);
            run.pendingRewards = { kind: 'event', gold: 0, cards: r.shuffle(POOL_IDS).slice(0, 3).map(id => makeCard(id)) };
          } },
        { label: '让他调音（随机升级 1 张未升级的卡）', apply(run) {
            const r = rnd(run);
            const cand = run.deck.map((c, i) => ({ c, i })).filter(x => x.c.up < 1);
            if (cand.length) cand[r.int(0, cand.length - 1)].c.up = 1;
          } },
      ],
    },
    {
      id: 'pages', name: '乐谱残页', emoji: '📜',
      desc: '一页烧焦的乐谱在风里打转，读完隐约觉得胸腔发烫。',
      options: [
        { label: '细读残页（+8 最大 HP 并回 8）', apply(run) { run.playerMaxHP += 8; run.playerHP = Math.min(run.playerMaxHP, run.playerHP + 8); } },
        { label: '卖给收藏家（+60 金币）', apply(run) { run.gold += 60; } },
      ],
    },
  ];
  function genEvent(run) {
    const r = rnd(run);
    run.event = r.pick(EVENTS);
    run.phase = 'event';
    return run.event;
  }
  function chooseEvent(run, optIdx) {
    if (!run.event) throw new Error('无进行中事件');
    run.event.options[optIdx].apply(run);
    // 事件若给了 pendingRewards（调音师），phase 交给 reward 流程
    if (!run.pendingRewards) { run.phase = 'map'; }
    run.event = null;
    save(run);
  }

  // ---------- 宝箱 ----------
  function openChest(run) {
    const left = RELIC_IDS.filter(id => !run.relics.includes(id));
    if (left.length) {
      const r = rnd(run);
      run.pendingRewards = { kind: 'chest', gold: 0, cards: [], relic: r.pick(left) };
      run.phase = 'reward';
    } else {
      run.gold += 50;
      run.phase = 'map';
    }
    save(run);
    return run.pendingRewards;
  }

  // ---------- 存档 ----------
  function memStorage() { let m = {}; return { getItem: k => (k in m ? m[k] : null), setItem: (k, v) => { m[k] = String(v); }, removeItem: k => { delete m[k]; } }; }
  function storage() {
    if (typeof localStorage !== 'undefined') return localStorage;
    if (!globalThis.__v15_memStorage) globalThis.__v15_memStorage = memStorage();
    return globalThis.__v15_memStorage;
  }
  function save(run) {
    // 战斗中不保存（战斗中退出=该战斗作废回节点前）；胜利结算后由 winBattle 自动存
    if (run.phase === 'battle') return;
    storage().setItem(SAVE_KEY, JSON.stringify(run));
  }
  function loadSave() {
    const raw = storage().getItem(SAVE_KEY);
    if (!raw) return null;
    try { const run = JSON.parse(raw); return run && !run.over ? run : null; } catch { return null; }
  }
  function hasSave() { return !!loadSave(); }
  function clearSave() { storage().removeItem(SAVE_KEY); }

  return {
    FLOORS, EVENTS, SAVE_KEY,
    newRun, genMap, curFloorNodes, enterNode, battleConfig,
    winBattle, loseBattle, takeRewardCard, takeRewardRelic, skipReward,
    genShop, buyCard, buyRelic, buyRemove, leaveShop,
    campfireRest, campfireUpgrade,
    genEvent, chooseEvent, openChest,
    save, loadSave, hasSave, clearSave,
  };
});
