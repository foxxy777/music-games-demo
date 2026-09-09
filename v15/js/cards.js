/* V15 音浪尖塔 · 卡池 38 张 + 遗物 5 个（任务书 v3 · 23:00 防御回归版） */
(function (root, factory) {
  const api = factory(root.V15 || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V15 = root.V15 || {};
  Object.assign(root.V15, api);
})(typeof self !== 'undefined' ? self : globalThis, function (V15) {
  'use strict';
  const { uid } = V15; // core.js 先加载（Node 侧由 tb.mjs 依次 require 后挂 V15）

  // ---- 放置辅助：把音符压入我方该轨队列尾（最前线端） ----
  // opts: {hp, shield, pierce, onHitPoison, lifesteal, sweep}
  function placeNote(b, lane, opts) {
    if (lane == null || lane < 0 || lane >= 7) throw new Error('放置轨号非法: ' + lane);
    const n = {
      id: uid('p'), side: 'p', lane,
      kind: opts.shield ? 'shield' : 'attack',
      hp: opts.hp, maxHp: opts.hp,
      pierce: opts.pierce || 1,
      onHitPoison: opts.onHitPoison || 0,
      lifesteal: opts.lifesteal || 0,
      sweep: !!opts.sweep,
      type: 'card',
    };
    if (!opts.shield) {
      // 力量（战斗内永久）+ 强音（本回合放置）+ 音叉（本场第一张攻击放置 +5）
      const bonus = (b.strength || 0) + (b.fierce || 0);
      if (bonus > 0) { n.hp += bonus; n.maxHp += bonus; ev2(b, { t: 'empower', note: n, bonus }); }
      if (b.relics && b.relics.includes('tuningfork') && !b.forkUsed) {
        b.forkUsed = true;
        n.hp += 5; n.maxHp += 5;
        ev2(b, { t: 'fork', note: n });
      }
    }
    b.lanes[lane].P.push(n); // P 尾 = 最前线（新放的先接敌，可先撞死贴脸漏网音）
    b.events.push({ t: 'place', lane, note: n });
    return n;
  }
  function ev2(b, e) { if (b.events) b.events.push(e); }

  // ---- 卡定义 ----
  // color: 金=防御 紫=破防 橙=燃烧 红=战士 绿=毒 蓝=中立
  // need: 'lane'(1轨) 'lane2'(2轨) 'lane3'(中心3轨) 'note'(指定敌音) null(无目标)
  const CARDS = {
    // ===== 防御系（金）6 =====
    ironwall: {
      id: 'ironwall', name: '铁壁', cost: 1, color: 'gold', need: 'lane',
      desc: '在目标轨放 18 防护盾音符（不反伤纯挡）', upDesc: '盾 18→25',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { shield: true, hp: 18 + c.up * 7 }); },
    },
    soundwall: {
      id: 'soundwall', name: '音墙', cost: 2, color: 'gold', need: 'lane',
      desc: '放 30 防护盾音符', upDesc: '盾 30→40',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { shield: true, hp: 30 + c.up * 10 }); },
    },
    resonbarrier: {
      id: 'resonbarrier', name: '共鸣壁垒', cost: 1, color: 'gold', need: 'lane',
      desc: '放 10 防护盾，谐振层数×2 追加防', upDesc: '基础盾 10→15',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { shield: true, hp: 10 + c.up * 5 + b.resonance * 2 }); },
    },
    transpose: {
      id: 'transpose', name: '移调壁垒', cost: 0, color: 'gold', need: 'lane',
      desc: '把指定轨现有护盾音符的剩余防全部转移到相邻轨', upDesc: '无（已是 0 费）',
      apply(b, c, ctx) {
        const lane = ctx.lanes[0];
        const to = lane > 0 ? lane - 1 : lane + 1; // 优先左邻，0 轨则右邻
        let moved = 0;
        b.lanes[lane].P = b.lanes[lane].P.filter(n => {
          if (n.kind === 'shield') { moved += n.hp; return false; }
          return true;
        });
        if (moved > 0) {
          // 并入相邻轨最后一个护盾（无则新建一个聚合盾）
          const tgt = b.lanes[to].P;
          let shield = null;
          for (let i = tgt.length - 1; i >= 0; i--) if (tgt[i].kind === 'shield') { shield = tgt[i]; break; }
          if (shield) shield.hp += moved; else placeNote(b, to, { shield: true, hp: moved });
          b.events.push({ t: 'transpose', from: lane, to, amount: moved });
        }
      },
    },
    reinforce: {
      id: 'reinforce', name: '加固和弦', cost: 1, color: 'gold', need: null,
      desc: '全部我方护盾音符 防+5', upDesc: '+5→+8',
      apply(b, c) {
        const amt = 5 + c.up * 3;
        for (const L of b.lanes) for (const n of L.P) if (n.kind === 'shield') { n.hp += amt; n.maxHp += amt; }
        b.events.push({ t: 'reinforce', amount: amt });
      },
    },
    greatwall: {
      id: 'greatwall', name: '铜墙铁壁', cost: 3, color: 'gold', need: null,
      desc: '七轨各放 12 防护盾', upDesc: '盾 12→16',
      apply(b, c) { for (let l = 0; l < 7; l++) placeNote(b, l, { shield: true, hp: 12 + c.up * 4 }); },
    },

    // ===== 破防系（紫）2 =====
    ram: {
      id: 'ram', name: '破城槌', cost: 1, color: 'purple', need: 'lane',
      desc: '放 攻4 音符，对护盾伤害×5', upDesc: '攻 4→7',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 4 + c.up * 3, pierce: 5 }); },
    },
    pierce: {
      id: 'pierce', name: '穿甲音', cost: 2, color: 'purple', need: 'lane',
      desc: '放 攻6 音符，对护盾×5 且直击本体一半伤害', upDesc: '攻 6→9',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 6 + c.up * 3, pierce: 5, halfDirect: true }); },
    },

    // ===== 燃烧系（橙）2 =====
    flamepluck: {
      id: 'flamepluck', name: '烈焰拨弦', cost: 1, color: 'orange', need: 'lane',
      desc: '指定轨全部敌方单位（音符+护盾）燃烧 +2', upDesc: '燃烧 +2→+3',
      apply(b, c, ctx) {
        const lane = ctx.lanes[0]; let hit = 0;
        for (const e of b.lanes[lane].E) { e.burn = (e.burn || 0) + 2 + c.up; hit++; }
        b.events.push({ t: 'burn', lane, count: hit });
      },
    },
    blaze: {
      id: 'blaze', name: '燎原乐章', cost: 2, color: 'orange', need: null,
      desc: '全部敌方单位燃烧 +2', upDesc: '燃烧 +2→+3',
      apply(b, c) {
        let hit = 0;
        for (const L of b.lanes) for (const e of L.E) { e.burn = (e.burn || 0) + 2 + c.up; hit++; }
        b.events.push({ t: 'burn', count: hit });
      },
    },

    // ===== 战士系（红）12 =====
    strike: {
      id: 'strike', name: '打击', cost: 1, color: 'red', need: 'lane',
      desc: '在目标轨放 攻8 音符（基础卡）', upDesc: '攻 8→11',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 8 + c.up * 3 + (b.strikeBonus || 0) }); },
    },
    heavyhit: {
      id: 'heavyhit', name: '重锤', cost: 2, color: 'red', need: 'lane',
      desc: '放 攻16 音符', upDesc: '攻 16→22',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 16 + c.up * 6 }); },
    },
    doublehit: {
      id: 'doublehit', name: '双重打击', cost: 1, color: 'red', need: 'lane2',
      desc: '放 攻4 音符 ×2（可选不同轨）', upDesc: '攻 4→6',
      apply(b, c, ctx) {
        placeNote(b, ctx.lanes[0], { hp: 4 + c.up * 2 });
        placeNote(b, ctx.lanes[1] != null ? ctx.lanes[1] : ctx.lanes[0], { hp: 4 + c.up * 2 });
      },
    },
    charge: {
      id: 'charge', name: '蓄力', cost: 1, color: 'red', need: null,
      desc: '力量 +2', upDesc: '力量 +2→+3',
      apply(b, c) { b.strength += 2 + c.up; b.events.push({ t: 'strength', amount: b.strength }); },
    },
    warcry: {
      id: 'warcry', name: '战吼', cost: 0, color: 'red', need: null,
      desc: '力量 +1，抽 1', upDesc: '抽 1→2',
      apply(b, c) { b.strength += 1; b.pendingDraw += 1 + c.up; b.events.push({ t: 'strength', amount: b.strength }); },
    },
    sonic: {
      id: 'sonic', name: '音爆', cost: 2, color: 'red', need: 'lane',
      desc: '放 攻10 音符，横扫：同时参与左右相邻两轨对撞', upDesc: '攻 10→13',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 10 + c.up * 3, sweep: true }); },
    },
    combofrenzy: {
      id: 'combofrenzy', name: '连击狂潮', cost: 0, color: 'red', need: 'lane',
      desc: '放 攻3 音符 + 谐振层数×2 追加攻', upDesc: '基础 3→5',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 3 + c.up * 2 + b.resonance * 2 }); },
    },
    weaponmaster: {
      id: 'weaponmaster', name: '武器大师', cost: 1, color: 'red', need: 'lane',
      desc: '放 攻5 音符，本局「打击」永久 +2', upDesc: '攻 5→8',
      apply(b, c, ctx) {
        b.strikeBonus = (b.strikeBonus || 0) + 2;
        placeNote(b, ctx.lanes[0], { hp: 5 + c.up * 3 });
      },
    },
    bloodrage: {
      id: 'bloodrage', name: '血怒', cost: 0, color: 'red', need: null,
      desc: '力量 +3，自伤 3', upDesc: '力量 +3→+4',
      apply(b, c) { b.strength += 3 + c.up; b.playerHP -= 3; b.events.push({ t: 'selfhurt', amount: 3 }); },
    },
    sweep3: {
      id: 'sweep3', name: '横扫千军', cost: 2, color: 'red', need: 'lane3',
      desc: '三条相邻轨各放 攻5 音符', upDesc: '攻 5→8',
      apply(b, c, ctx) {
        const mid = ctx.lanes[0];
        for (const l of [mid - 1, mid, mid + 1]) if (l >= 0 && l < 7) placeNote(b, l, { hp: 5 + c.up * 3 });
      },
    },
    timpani: {
      id: 'timpani', name: '定音鼓', cost: 1, color: 'red', need: 'lane',
      desc: '放 攻12 音符（大锤斩杀）', upDesc: '攻 12→17',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 12 + c.up * 5 }); },
    },
    finale: {
      id: 'finale', name: '终结乐章', cost: 3, color: 'red', need: 'lane',
      desc: '放 攻30 音符', upDesc: '攻 30→40',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 30 + c.up * 10 }); },
    },

    // ===== 毒系（绿）10 =====
    poisonblade: {
      id: 'poisonblade', name: '毒刃', cost: 1, color: 'green', need: 'lane',
      desc: '放 攻3 音符，撞击时给对撞敌音 +3 毒', upDesc: '附毒 3→5',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 3, onHitPoison: 3 + c.up * 2 }); },
    },
    corrode: {
      id: 'corrode', name: '腐蚀箭', cost: 1, color: 'green', need: 'lane',
      desc: '放 攻2 音符，撞击时 +4 毒', upDesc: '附毒 4→6',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 2, onHitPoison: 4 + c.up * 2 }); },
    },
    lesion: {
      id: 'lesion', name: '病灶', cost: 0, color: 'green', need: 'note',
      desc: '指定敌音毒 +2', upDesc: '毒 +2→+4',
      apply(b, c, ctx) { addPoison(b, ctx.noteId, 2 + c.up * 2); },
    },
    poisonmist: {
      id: 'poisonmist', name: '毒雾蔓延', cost: 1, color: 'green', need: null,
      desc: '全部已入场敌音毒 +2', upDesc: '毒 +2→+3',
      apply(b, c) { poisonAll(b, 2 + c.up); },
    },
    venomcloud: {
      id: 'venomcloud', name: '剧毒云', cost: 2, color: 'green', need: null,
      desc: '全部已入场敌音毒 +3', upDesc: '毒 +3→+5',
      apply(b, c) { poisonAll(b, 3 + c.up * 2); },
    },
    catalyze: {
      id: 'catalyze', name: '传染催化', cost: 2, color: 'green', need: 'note',
      desc: '指定敌音毒层 ×2', upDesc: '×2→×3',
      apply(b, c, ctx) {
        const e = findEnemy(b, ctx.noteId);
        if (e) { const m = 2 + c.up; e.poison = (e.poison || 0) * m; b.events.push({ t: 'poison', note: e }); }
      },
    },
    boneetch: {
      id: 'boneetch', name: '蚀骨', cost: 2, color: 'green', need: 'note',
      desc: '指定敌音毒 +6，抽 1', upDesc: '毒 +6→+9',
      apply(b, c, ctx) { addPoison(b, ctx.noteId, 6 + c.up * 3); b.pendingDraw += 1; },
    },
    deadlykiss: {
      id: 'deadlykiss', name: '死亡之吻', cost: 1, color: 'green', need: 'lane',
      desc: '放 攻4 音符（撞击+2毒），命中英雄吸血 2', upDesc: '攻 4→6',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 4 + c.up * 2, onHitPoison: 2, lifesteal: 2 }); },
    },
    plaguebell: {
      id: 'plaguebell', name: '瘟疫钟声', cost: 1, color: 'green', need: null,
      desc: '全部敌音 1 伤，已有毒的再 +2 毒', upDesc: '毒 +2→+3',
      apply(b, c) {
        for (const L of b.lanes) {
          for (const e of L.E.slice()) {
            e.hp -= 1;
            if (e.poison > 0) e.poison += 2 + c.up;
            if (e.hp <= 0) { splitOnDeath(b, L, e); L.E.splice(L.E.indexOf(e), 1); }
          }
        }
        b.events.push({ t: 'aoe', kind: 'plaguebell' });
      },
    },
    venomnova: {
      id: 'venomnova', name: '剧毒新星', cost: 3, color: 'green', need: null,
      desc: '全部敌音毒 +8', upDesc: '毒 +8→+11',
      apply(b, c) { poisonAll(b, 8 + c.up * 3); },
    },

    // ===== 中立系（蓝）8 =====
    rhapsody: {
      id: 'rhapsody', name: '狂想曲', cost: 0, color: 'blue', need: null,
      desc: '抽 2', upDesc: '抽 2→3',
      apply(b, c) { b.pendingDraw += 2 + c.up; },
    },
    crescendo: {
      id: 'crescendo', name: '渐强', cost: 1, color: 'blue', need: null,
      desc: '能量 +2', upDesc: '能量 +2→+3',
      apply(b, c) { b.energy += 2 + c.up; b.events.push({ t: 'energy', amount: b.energy }); },
    },
    forte: {
      id: 'forte', name: '强音', cost: 1, color: 'blue', need: null,
      desc: '本回合我方放置的音符攻击 +2', upDesc: '+2→+3',
      apply(b, c) { b.fierce = (b.fierce || 0) + 2 + c.up; b.events.push({ t: 'fierce', amount: b.fierce }); },
    },
    rest: {
      id: 'rest', name: '休止符', cost: 1, color: 'blue', need: null,
      desc: '回血 8', upDesc: '回血 8→12',
      apply(b, c) { heal(b, 8 + c.up * 4); },
    },
    fang: {
      id: 'fang', name: '吸血獠牙', cost: 1, color: 'blue', need: 'lane',
      desc: '放 攻6 音符，命中英雄吸血 3', upDesc: '攻 6→9',
      apply(b, c, ctx) { placeNote(b, ctx.lanes[0], { hp: 6 + c.up * 3, lifesteal: 3 }); },
    },
    muse: {
      id: 'muse', name: '灵感', cost: 0, color: 'blue', need: null,
      desc: '抽 1', upDesc: '抽 1→2',
      apply(b, c) { b.pendingDraw += 1 + c.up; },
    },
    symphony: {
      id: 'symphony', name: '交响', cost: 2, color: 'blue', need: null,
      desc: '力量 +1，抽 2', upDesc: '抽 2→3',
      apply(b, c) { b.strength += 1; b.pendingDraw += 2 + c.up; },
    },
    resonchord: {
      id: 'resonchord', name: '谐振和弦', cost: 1, color: 'blue', need: null,
      desc: '全部敌音立即受 谐振层数 伤害', upDesc: '伤害 = 层数×1.5(向上)',
      apply(b, c) {
        const dmg = c.up ? Math.ceil(b.resonance * 1.5) : b.resonance;
        if (dmg <= 0) return;
        for (const L of b.lanes) {
          for (const e of L.E.slice()) {
            e.hp -= dmg;
            if (e.hp <= 0) { splitOnDeath(b, L, e); L.E.splice(L.E.indexOf(e), 1); }
          }
        }
        b.events.push({ t: 'aoe', kind: 'resonchord', amount: dmg });
      },
    },
  };

  // ---- 辅助（供 cards 与 battle 共用，挂在模块内）----
  function findEnemy(b, noteId) {
    for (const L of b.lanes) for (const e of L.E) if (e.id === noteId) return e;
    return null;
  }
  function addPoison(b, noteId, amt) {
    const e = findEnemy(b, noteId);
    if (e) { e.poison = (e.poison || 0) + amt; b.events.push({ t: 'poison', note: e, add: amt }); }
    return e;
  }
  function poisonAll(b, amt) {
    for (const L of b.lanes) for (const e of L.E) { e.poison = (e.poison || 0) + amt; }
    b.events.push({ t: 'poisonAll', amount: amt });
  }
  function heal(b, amt) {
    b.playerHP = Math.min(b.playerMaxHP, b.playerHP + amt);
    b.events.push({ t: 'heal', amount: amt });
  }
  // 精英（重音）死亡分裂 2 个单音，插在同轨头部（原地）
  function splitOnDeath(b, L, e) {
    if (e.type !== 'elite' || e.splitUsed) return;
    const shp = V15.ENEMY_STATS.single.hp;
    for (let i = 0; i < 2; i++) {
      L.E.unshift({
        id: uid('e'), side: 'e', lane: e.lane, kind: 'attack',
        hp: shp, maxHp: shp, type: 'single', poison: 0, burn: e.burn || 0,
      });
    }
    b.events.push({ t: 'split', lane: e.lane, from: e.id });
  }

  // ---- 遗物 5 ----
  const RELICS = {
    tuningfork: {
      id: 'tuningfork', name: '音叉', emoji: '🍴',
      desc: '每场战斗第一个音符攻击 +5',
    },
    metronome: {
      id: 'metronome', name: '节拍器', emoji: '⏱️',
      desc: '每回合第一张牌费用 -1',
    },
    stand: {
      id: 'stand', name: '乐谱架', emoji: '🎼',
      desc: '每场战斗开局多抽 2',
    },
    poisonbottle: {
      id: 'poisonbottle', name: '毒瓶', emoji: '🧪',
      desc: '每场战斗开始（每批敌音起飞时）全部敌音 +2 毒',
    },
    hammer: {
      id: 'hammer', name: '调音锤', emoji: '🔨',
      desc: '共振乘数 +1（×2→×3，×3→×4）',
    },
    blueprinteye: {
      id: 'blueprinteye', name: '蓝图之眼', emoji: '👁️',
      desc: '蓝图标记判定正确时，每个标对直接对敌方英雄造成 2 点伤害',
    },
  };
  const RELIC_IDS = Object.keys(RELICS);

  // ---- 起始卡组（任务书 4）：打击×4 + 音爆×1 + 蓄力×1 + 狂想曲×1 + 铁壁×2 + 破城槌×1 ----
  function startingDeck() {
    return [
      { id: 'strike', up: 0 }, { id: 'strike', up: 0 }, { id: 'strike', up: 0 }, { id: 'strike', up: 0 },
      { id: 'sonic', up: 0 }, { id: 'charge', up: 0 }, { id: 'rhapsody', up: 0 },
      { id: 'ironwall', up: 0 }, { id: 'ironwall', up: 0 }, { id: 'ram', up: 0 },
    ];
  }

  // 奖励池 = 卡池去掉起始 6 种基础卡之外全部可出现（含全部 38 种里非基础的）
  const STARTER_IDS = ['strike', 'sonic', 'charge', 'rhapsody', 'ironwall', 'ram'];
  const POOL_IDS = Object.keys(CARDS).filter(k => !STARTER_IDS.includes(k));

  function makeCard(id, up) { return { id, up: up || 0 }; }
  function cardDef(inst) { return CARDS[inst.id]; }
  function cardCost(b, inst) {
    let cost = cardDef(inst).cost;
    if (b && b.metronome && !b.metronomeUsed && hasRelic(b, 'metronome')) return Math.max(0, cost - 1);
    return cost;
  }
  function hasRelic(b, rid) { return b && b.relics && b.relics.includes(rid); }

  return {
    CARDS, RELICS, RELIC_IDS, POOL_IDS, STARTER_IDS,
    startingDeck, makeCard, cardDef, cardCost, hasRelic,
    placeNote, findEnemy, addPoison, poisonAll, heal, splitOnDeath,
  };
});
