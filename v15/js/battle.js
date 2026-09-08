/* V15 音浪尖塔 · 战斗核心（回合制对撞模型 · 纯逻辑，无 DOM）
 *
 * 队列语义：
 *   lanes[i].P —— 我方音符，index 0 = 最早放置（后排），last = 最前线（先接敌）
 *   lanes[i].E —— 敌方音符，index 0 = 最前线（最靠我方英雄/贴脸端），last = 最新起飞
 *   出牌放置 push 到 P 尾（成为最前线）→ 下回合结算时新音符先撞贴脸漏网敌音（救场规则）
 *   敌方起飞 push 到 E 尾；对撞/漏网从 E 头 shift
 *
 * 结算顺序（endTurn）：起飞 → 毒 → 燃烧 → 逐轨对撞(含横扫跨轨) → 冲线/漏网 → 谐振/共振
 */
(function (root, factory) {
  const api = factory(root.V15 || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V15 = root.V15 || {};
  Object.assign(root.V15, api);
})(typeof self !== 'undefined' ? self : globalThis, function (V15) {
  'use strict';
  const { LANES, ENEMY_STATS, makeRng, uid } = V15;
  const { placeNote, splitOnDeath, cardDef, cardCost, hasRelic } = V15;

  // ---- 敌方音符工厂 ----
  function mkEnemy(spawn, poisonBottle) {
    const st = ENEMY_STATS[spawn.type] || ENEMY_STATS.std;
    const n = {
      id: uid('e'), side: 'e', lane: spawn.lane, kind: 'attack',
      hp: st.hp, maxHp: st.hp, type: spawn.type,
      poison: 0, burn: 0, beat: spawn.beat,
    };
    if (poisonBottle) n.poison += 2; // 毒瓶遗物：每批敌音起飞 +2 毒
    return n;
  }

  // ---- 建立战斗 ----
  // opts: {wave, deck, relics, playerHP, playerMaxHP, fast, seed, kind:'normal'|'elite'|'boss'}
  function createBattle(opts) {
    const wave = opts.wave;
    const kind = opts.kind || (wave.boss ? 'boss' : 'normal');
    const heroHP = V15.ENEMY_HERO_HP[kind] || V15.ENEMY_HERO_HP.normal;
    let spawns = wave.spawns.map(s => ({ ...s }));
    if (opts.fast) spawns = spawns.map(s => ({ ...s, turn: Math.max(1, Math.ceil(s.turn * 0.6)) })); // 走音八音盒：敌曲加速
    const b = {
      wave, kind,
      spawns, spawnCursor: 0,
      turn: 0, // startTurn 后为 1
      playerHP: opts.playerHP, playerMaxHP: opts.playerMaxHP,
      enemyMaxHP: heroHP, enemyHP: heroHP,
      lanes: Array.from({ length: LANES }, () => ({ P: [], E: [] })),
      resonance: 0,
      energy: 4, maxEnergy: 4, // 平衡补丁：3 费产能追不上敌方起飞，哑火期过长（见 devlog）
      strength: 0, fierce: 0, strikeBonus: 0,
      relics: opts.relics || [],
      hand: [], drawPile: [], discardPile: [],
      metronomeUsed: false,
      forkUsed: false,
      pendingDraw: 0,
      rng: makeRng(opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0),
      fast: !!opts.fast,
      over: false,
      events: [], log: [],
      bossPhase: 0,
      stats: { damage: 0, resonance: 0 }, // 结算画面聚合用
    };
    b.drawPile = b.rng.shuffle(opts.deck.map(c => ({ ...c })));
    if (hasRelic(b, 'stand')) drawCards(b, 2); // 乐谱架：开局多抽 2（进起手）
    return b;
  }

  function ev(b, e) { b.events.push(e); return e; }
  function say(b, s) { b.log.push(s); }

  // ---- 抽牌 ----
  function drawCards(b, n) {
    for (let i = 0; i < n; i++) {
      if (b.hand.length >= 10) break; // 手牌上限 10
      if (!b.drawPile.length) {
        if (!b.discardPile.length) break;
        b.drawPile = b.rng.shuffle(b.discardPile);
        b.discardPile = [];
      }
      b.hand.push(b.drawPile.pop());
    }
  }

  // ---- 回合开始（我方）----
  function startTurn(b) {
    if (b.over) return [];
    b.events = [];
    b.turn += 1;
    b.energy = b.maxEnergy;
    b.fierce = 0;
    b.metronomeUsed = false;
    b.pendingDraw = 0;
    drawCards(b, 5);
    ev(b, { t: 'turnStart', turn: b.turn, hand: b.hand.length });
    const out = b.events; b.events = [];
    return out;
  }

  // ---- 出牌 ----
  // ctx: {lanes:[轨号...], noteId}
  function playCard(b, handIndex, ctx) {
    if (b.over) throw new Error('战斗已结束');
    ctx = ctx || {};
    const inst = b.hand[handIndex];
    if (!inst) throw new Error('手牌序号非法');
    const def = cardDef(inst);
    let cost = cardCost(b, inst);
    if (b.energy < cost) throw new Error('能量不足');
    validateTargets(b, def, ctx);
    b.events = [];

    b.energy -= cost;
    if (hasRelic(b, 'metronome') && !b.metronomeUsed) b.metronomeUsed = true; // 节拍器：第一张 -1 费后消耗标记

    b.hand.splice(handIndex, 1);
    def.apply(b, inst, ctx);
    drawCards(b, b.pendingDraw || 0);
    b.pendingDraw = 0;

    b.discardPile.push(inst);
    say(b, `打出【${def.name}】`);
    const out = b.events; b.events = [];
    return out;
  }

  function validateTargets(b, def, ctx) {
    const need = def.need;
    if (!need) return;
    const L = ctx.lanes || [];
    if (need === 'lane') {
      if (typeof L[0] !== 'number' || L[0] < 0 || L[0] > 6) throw new Error('需要选择 1 条轨道');
    } else if (need === 'lane2') {
      if (typeof L[0] !== 'number') throw new Error('需要选择第 1 条轨道');
      if (typeof L[1] !== 'number') throw new Error('需要选择第 2 条轨道');
    } else if (need === 'lane3') {
      if (typeof L[0] !== 'number' || L[0] < 1 || L[0] > 5) throw new Error('需要选择中间轨（2~6）作为中心');
    } else if (need === 'note') {
      const e = V15.findEnemy(b, ctx.noteId);
      if (!e) throw new Error('需要选择一个敌方音符');
    }
  }

  // ================= 结算 =================
  function endTurn(b) {
    if (b.over) throw new Error('战斗已结束');
    b.events = [];
    const laneHadEnemy = new Array(LANES).fill(false);

    // 0. 敌方起飞
    spawnWave(b, laneHadEnemy);

    // 记录「本回合该轨出现过敌音」（起飞后、任何消耗前）——清轨判定用
    for (let i = 0; i < LANES; i++) laneHadEnemy[i] = b.lanes[i].E.length > 0;

    // 1. 毒
    settlePoison(b);

    // 2. 燃烧
    settleBurn(b);

    // 3. 逐轨对撞（含横扫跨轨）
    for (let i = 0; i < LANES; i++) {
      clashLane(b, i);
      maybeSweep(b, i);
    }

    // 4. 冲线 / 漏网
    for (let i = 0; i < LANES; i++) settleLaneEnd(b, i);

    // 5. 谐振 / 共振
    resonanceCheck(b, laneHadEnemy);

    // 6. 弃手牌（StS 式：保留手牌？——保留手牌更灵活，这里保留，只结算能量）
    checkEnd(b);
    const out = b.events; b.events = [];
    return out;
  }

  function spawnWave(b, laneHadEnemy) {
    let spawned = 0;
    while (b.spawnCursor < b.spawns.length && b.spawns[b.spawnCursor].turn <= b.turn) {
      const s = b.spawns[b.spawnCursor++];
      const n = mkEnemy(s, hasRelic(b, 'poisonbottle'));
      b.lanes[s.lane].E.push(n);
      laneHadEnemy[s.lane] = true;
      ev(b, { t: 'takeoff', lane: s.lane, note: n });
      spawned++;
    }
    if (spawned) say(b, `敌方起飞 ${spawned} 个音符`);
    // Boss 四阶段横幅（命运）
    if (b.wave.boss) {
      const ph = bossPhaseOf(b.turn);
      if (ph !== b.bossPhase) { b.bossPhase = ph; ev(b, { t: 'bossPhase', phase: ph, ...BOSS_PHASES[ph] }); }
    }
  }

  // 命运四阶段：T1-2 主部 / T3-4 副部 / T5-7 发展部 / T8-9 再现全轨齐压
  const BOSS_PHASES = {
    1: { name: '主部主题', desc: '命运动机·当当当当' },
    2: { name: '副部主题', desc: '抒情琶音·变软但变密' },
    3: { name: '发展部', desc: '动机辗转腾挪·追着打' },
    4: { name: '再现部', desc: '全轨齐压！' },
  };
  function bossPhaseOf(turn) { return turn <= 2 ? 1 : turn <= 4 ? 2 : turn <= 7 ? 3 : 4; }

  function settlePoison(b) {
    for (const L of b.lanes) {
      for (const e of L.E.slice()) {
        if (!L.E.includes(e) || !(e.poison > 0)) continue;
        e.hp -= e.poison;
        e.poison -= 1;
        ev(b, { t: 'poisonTick', note: e, lane: e.lane });
        if (e.hp <= 0) {
          // 毒死传染：毒层一半（向上取整）给同轨下一个敌方音符（分裂单音优先承接）
          const leftover = Math.ceil(Math.max(0, e.poison) / 2);
          splitOnDeath(b, L, e);
          const idx = L.E.indexOf(e);
          L.E.splice(idx, 1);
          const next = L.E[idx];
          if (next && leftover > 0) { next.poison += leftover; ev(b, { t: 'poisonSpread', to: next, amount: leftover }); }
          say(b, `毒杀 ${e.type}`);
        }
      }
    }
  }

  function settleBurn(b) {
    for (const L of b.lanes) {
      for (const e of L.E.slice()) {
        if (!L.E.includes(e) || !(e.burn > 0)) continue;
        e.hp -= e.burn; // 均匀削血（护盾单位即削防）
        e.burn -= 1;
        ev(b, { t: 'burnTick', note: e });
        if (e.hp <= 0) {
          splitOnDeath(b, L, e);
          L.E.splice(L.E.indexOf(e), 1);
          say(b, `烧死 ${e.type}`);
        }
      }
    }
  }

  // 单对相撞：返回 'pDead' | 'eDead' | 'both' | 'stalemate'
  function clashPair(b, L, p, e, combo) {
    if (p.kind === 'shield') {
      // 我方盾：敌音削盾，盾不反伤；盾碎则敌音无损继续前进
      const dmg = e.hp;
      p.hp -= dmg;
      ev(b, { t: 'clash', lane: p.lane, p, e, kind: 'shieldBlock', pLeft: Math.max(0, p.hp), eLeft: Math.max(0, e.hp), combo });
      if (p.hp <= 0) { removeP(L, p); return 'pDead'; }
      return 'stalemate';
    }
    if (e.kind === 'shield') {
      // 敌方盾（逻辑保险）：破防倍率
      const dmg = p.hp * p.pierce;
      e.hp -= dmg;
      if (p.halfDirect) e.bodyDmg = (e.bodyDmg || 0) + Math.floor(p.hp / 2);
      ev(b, { t: 'clash', lane: p.lane, p, e, kind: 'siege', dmg, eLeft: Math.max(0, e.hp), combo });
      if (e.hp <= 0) { killEnemy(b, L, e); return 'eDead'; }
      return 'stalemate';
    }
    // 攻 vs 攻
    if (p.onHitPoison > 0) { e.poison = (e.poison || 0) + p.onHitPoison; ev(b, { t: 'poisonHit', note: e, amount: p.onHitPoison }); }
    const diff = p.hp - e.hp;
    ev(b, { t: 'clash', lane: p.lane, p, e, kind: 'clash', diff, combo });
    if (diff > 0) { p.hp = diff; killEnemy(b, L, e); return 'eDead'; }
    if (diff < 0) { e.hp = -diff; p.hp = 0; removeP(L, p); return 'pDead'; }
    p.hp = 0; removeP(L, p); killEnemy(b, L, e); return 'both';
  }

  function removeP(L, p) { const i = L.P.indexOf(p); if (i >= 0) L.P.splice(i, 1); }
  function killEnemy(b, L, e) { splitOnDeath(b, L, e); L.E.splice(L.E.indexOf(e), 1); }

  function clashLane(b, i) {
    const L = b.lanes[i];
    let combo = 0;
    while (L.P.length && L.E.length) {
      const p = L.P[L.P.length - 1], e = L.E[0];
      const r = clashPair(b, L, p, e, combo);
      if (r === 'stalemate') break;
      combo++;
      if (combo >= 2) ev(b, { t: 'combo', lane: i, combo });
    }
    if (combo) say(b, `${i} 轨连锁 ×${combo}`);
  }

  // 横扫（音爆）：本轨清空且横扫音存活 → 依次参与左右相邻轨对撞，最后冲线打英雄
  function maybeSweep(b, i) {
    const L = b.lanes[i];
    const s = L.P.find(n => n.sweep && n.kind === 'attack');
    if (!s || L.E.length) return;
    s.visited = s.visited || new Set([i]);
    removeP(L, s);
    for (const adj of [i - 1, i + 1]) {
      if (s.hp <= 0) break;
      if (adj < 0 || adj >= LANES || s.visited.has(adj)) continue;
      s.visited.add(adj);
      s.lane = adj;
      b.lanes[adj].P.push(s); // 成为该轨最前线
      ev(b, { t: 'sweepMove', from: i, to: adj, note: s });
      clashLane(b, adj);
      removeP(b.lanes[adj], s); // 路过即走，防止留在队列里被再次结算
    }
    if (s.hp > 0) {
      strikeHero(b, s, i); // 三轨拼完冲线
    }
  }

  function strikeHero(b, n, lane) {
    const dmg = n.hp * 2; // 冲线爆打：剩余攻击力 ×2（平衡补丁，见 devlog）
    b.enemyHP -= dmg;
    b.stats.damage += dmg;
    ev(b, { t: 'strike', lane, note: n, dmg, enemyHP: Math.max(0, b.enemyHP) });
    say(b, `${lane} 轨冲线！对敌方英雄 ${dmg} 伤害`);
    if (n.lifesteal > 0) {
      b.playerHP = Math.min(b.playerMaxHP, b.playerHP + n.lifesteal);
      ev(b, { t: 'heal', amount: n.lifesteal });
    }
    removeP(b.lanes[n.lane] || b.lanes[lane], n); // 横扫音可能已移到邻轨队列
  }

  // 每轨末尾：我方冲线（E 空 P 有）或漏网贴脸（P 空 E 有）
  function settleLaneEnd(b, i) {
    const L = b.lanes[i];
    if (!L.E.length && L.P.length) {
      // 清轨：我方攻击音符依次冲线（盾不冲，留场挡下一波）
      while (L.P.length) {
        const front = L.P[L.P.length - 1];
        if (front.kind !== 'attack') break;
        strikeHero(b, front, i);
      }
      return;
    }
    if (!L.P.length && L.E.length) {
      const cnt = L.E.length;
      b.playerHP -= cnt; // 每个贴脸漏网音敲 1 血
      ev(b, { t: 'breach', lane: i, count: cnt, playerHP: Math.max(0, b.playerHP) });
      say(b, `${i} 轨漏网 ${cnt} 个贴脸！-${cnt} HP`);
    }
  }

  // 谐振：单轨清 +1；连续 L 轨同清（L≥2）→ 层数 ×(L + 调音锤加成)
  function resonanceCheck(b, laneHadEnemy) {
    const cleared = [];
    for (let i = 0; i < LANES; i++) if (laneHadEnemy[i] && !b.lanes[i].E.length) cleared.push(i);
    if (!cleared.length) return;
    // 极大连续段
    const segs = [];
    let start = cleared[0], prev = cleared[0];
    for (let k = 1; k <= cleared.length; k++) {
      const cur = cleared[k];
      if (cur !== prev + 1) { segs.push([start, prev]); start = cur; }
      prev = cur;
    }
    let totalMult = 0;
    for (const [a, bnd] of segs) {
      const len = bnd - a + 1;
      if (len === 1) {
        b.resonance += 1;
        b.stats.resonance += 1;
        ev(b, { t: 'resonance', lane: a, layers: b.resonance });
      } else {
        const mult = len + (hasRelic(b, 'hammer') ? 1 : 0);
        b.resonance = Math.max(1, b.resonance) * mult; // 无上限乘法滚雪球
        b.stats.resonance += 1;
        totalMult = totalMult ? totalMult * mult : mult;
        ev(b, { t: 'resonanceX', lanes: [a, bnd], mult, layers: b.resonance });
      }
    }
    if (totalMult) say(b, `共振 ×${totalMult}！谐振 ${b.resonance} 层`);
    else say(b, `谐振 ${b.resonance} 层`);
  }

  function checkEnd(b) {
    if (b.enemyHP <= 0) { b.over = true; b.result = 'win'; ev(b, { t: 'end', result: 'win' }); }
    else if (b.playerHP <= 0) { b.over = true; b.result = 'lose'; ev(b, { t: 'end', result: 'lose' }); }
  }

  // ---- 曲牌音型指纹（预演用）：每轨音符统计 ----
  function fingerprint(wave) {
    const fp = Array.from({ length: LANES }, () => ({ single: 0, std: 0, long: 0, elite: 0, total: 0 }));
    for (const s of wave.spawns) { fp[s.lane][s.type]++; fp[s.lane].total++; }
    return fp;
  }
  // 波次按回合分组（预演快放时序）
  function waveByTurn(wave) {
    const m = new Map();
    for (const s of wave.spawns) { if (!m.has(s.turn)) m.set(s.turn, []); m.get(s.turn).push(s); }
    return [...m.entries()].sort((a, b2) => a[0] - b2[0]);
  }

  return {
    createBattle, startTurn, playCard, endTurn, checkEnd,
    fingerprint, waveByTurn, bossPhaseOf, BOSS_PHASES,
    // 内部导出仅供 TB 精细断言
    _clashPair: clashPair,
  };
});
