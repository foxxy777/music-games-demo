/* V15 音浪尖塔 · 三音攻防战斗内核（2026-09-09 任务书 · 纯逻辑，无 DOM，浏览器 + Node TB 双端）
 *
 * 核心循环：小怪每回合随机播 3 音（可重复）→ 玩家抽 5 张
 *   → 防御牌/攻击牌可放任意轨道（09-10 00:21 大爷：练耳不框死答案；攻击 1 轨限 1 张保和弦判定）
 *   → 结算（先敌后我）：同轨前 N 张防御盖住 N 个敌音，漏网敌音各打玩家
 *   → 攻击牌飞打小怪各 10；三张攻击落轨构成大/小三和弦 → 总伤 ×2 → 全弃，下一回合
 *
 * 旧「七轨对撞」battle.js 留档不再加载；卡组/地图/能量等系统本期停用。
 */
(function (root, factory) {
  const api = factory(root.V15 || {});
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.V15 = root.V15 || {};
  Object.assign(root.V15, api);
})(typeof self !== 'undefined' ? self : globalThis, function (V15) {
  'use strict';
  const { LANES, LANE_NAMES, makeRng } = V15;

  // ===== 数值表（任务书 §四 · 大爷钦定，全部可调） =====
  const CONFIG = {
    PLAYER_HP: 100,          // 玩家 HP（沿用现值）
    MONSTER_HP: 100,         // 小怪 HP（09-09 21:52 拍板）
    NOTE_ATK: 10,            // 敌音攻击力/个
    DEF_BLOCK: 10,           // 防御牌防御值（恰好抵一个敌音）
    ATK_DMG: 10,             // 攻击牌攻击力
    DECK_DEF: 10,            // 防御牌张数
    DECK_ATK: 10,            // 攻击牌张数（合计 20）
    DRAW_PER_TURN: 5,        // 每回合抽牌（回合结束全弃，21:52 拍板）
    NOTES_PER_TURN: 3,       // 小怪每回合播音数
    CHORD_MULT: 2,           // 和弦加成（09-09 21:52 拍板：大三/小三合计 ×2）
    CHORD_MAJ: [0, 4, 7],    // 大三和弦半音差
    CHORD_MIN: [0, 3, 7],    // 小三和弦半音差
    PLAY_INTERVAL_MS: 700,   // 播音间隔（沿用预演口径）
    TONE_DUR_S: 0.5,         // 音长
    // 唱名 → 半音（do re mi fa sol la si = C 大调音级），和弦判定用
    PITCH_CLASS: [0, 2, 4, 5, 7, 9, 11],
  };

  // ---- 和弦判定：3 个唱名的半音集合 mod 12 旋转匹配 {0,4,7}=大三 / {0,3,7}=小三 ----
  // 传入 3 条轨道号（须互不相同），返回 { kind:'major'|'minor', root:轨号 } 或 null
  function judgeChord(lanes, cfg) {
    cfg = cfg || CONFIG;
    if (!lanes || lanes.length !== 3 || new Set(lanes).size !== 3) return null;
    for (const r of lanes) {
      const iv = lanes.map(l => (((cfg.PITCH_CLASS[l] - cfg.PITCH_CLASS[r]) % 12) + 12) % 12)
        .sort((a, b) => a - b);
      if (iv.every((v, i) => v === cfg.CHORD_MAJ[i])) return { kind: 'major', root: r };
      if (iv.every((v, i) => v === cfg.CHORD_MIN[i])) return { kind: 'minor', root: r };
    }
    return null;
  }
  // 已放 count 张攻击时，补 lane 能否成和弦（UI 预览提示用）
  function chordIfAdd(placedLanes, lane, cfg) {
    if (placedLanes.length !== 2) return null;
    return judgeChord(placedLanes.concat([lane]), cfg);
  }

  function mkDeck(rng, cfg) {
    const deck = [];
    for (let i = 0; i < cfg.DECK_DEF; i++) deck.push({ k: 'def' });
    for (let i = 0; i < cfg.DECK_ATK; i++) deck.push({ k: 'atk' });
    return rng.shuffle(deck);
  }

  // opts: {seed, playerHP, monsterHP, config(覆盖 CONFIG 项，测试调参用)}
  function createDuel(opts) {
    opts = opts || {};
    const cfg = Object.assign({}, CONFIG, opts.config || {});
    const rng = makeRng(opts.seed != null ? opts.seed : (Math.random() * 1e9) | 0);
    const d = {
      cfg,
      seed: rng.seed,
      rng,
      turn: 0, // startTurn 后从 1 起
      playerHP: opts.playerHP != null ? opts.playerHP : cfg.PLAYER_HP,
      playerMaxHP: cfg.PLAYER_HP,
      monsterHP: opts.monsterHP != null ? opts.monsterHP : cfg.MONSTER_HP,
      monsterMaxHP: cfg.MONSTER_HP,
      notes: [],                            // 本回合敌音轨号 [lane×3]（播音顺序）
      laneDefs: new Array(LANES).fill(0),   // 各轨已盖防御牌数
      attacks: new Array(LANES).fill(null), // 各轨攻击牌（1 轨限 1）
      attackOrder: [],                      // 攻击牌放置顺序（轨号），结算与演出用
      hand: [], drawPile: [], discardPile: [],
      reshuffles: 0,
      over: false, result: null, // 'win' | 'lose'
      log: [],
    };
    d.drawPile = mkDeck(rng, cfg);
    return d;
  }

  function notesOnLane(d, lane) {
    let n = 0;
    for (const l of d.notes) if (l === lane) n++;
    return n;
  }

  function drawCards(d, n) {
    for (let i = 0; i < n; i++) {
      if (!d.drawPile.length) {
        if (!d.discardPile.length) break;
        d.drawPile = d.rng.shuffle(d.discardPile);
        d.discardPile = [];
        d.reshuffles++;
        d.log.push('卡组抽干，弃牌堆洗回');
      }
      d.hand.push(d.drawPile.pop());
    }
  }

  // ---- 回合开始：随机播 3 音（独立取、可重复）+ 抽 5 张 ----
  function startTurn(d) {
    if (d.over) throw new Error('战斗已结束');
    d.turn++;
    d.notes = [];
    for (let i = 0; i < d.cfg.NOTES_PER_TURN; i++) d.notes.push(d.rng.int(0, LANES - 1));
    d.laneDefs = new Array(LANES).fill(0);
    d.attacks = new Array(LANES).fill(null);
    d.attackOrder = [];
    drawCards(d, d.cfg.DRAW_PER_TURN);
    d.log.push('第 ' + d.turn + ' 回合：敌音 ' + d.notes.map(l => LANE_NAMES[l]).join(' '));
    return { turn: d.turn, notes: d.notes.slice(), hand: d.hand.length };
  }

  // ---- 放置规则（大爷 09-10 00:21：牌可放任意轨道，练耳不框死答案）----
  // 攻击仍 1 轨限 1 张（和弦判定需 3 条不同轨）；防御同轨可叠多张（do×2 需叠 2 张全盖）
  function canPlace(d, handIdx, lane) {
    if (d.over) return { ok: false, reason: '战斗已结束' };
    const card = d.hand[handIdx];
    if (!card) return { ok: false, reason: '手牌序号非法' };
    if (!(typeof lane === 'number' && lane >= 0 && lane < LANES)) return { ok: false, reason: '轨道非法' };
    if (d.notes.length < d.cfg.NOTES_PER_TURN) return { ok: false, reason: '敌音还没播完' };
    if (card.k === 'atk' && d.attacks[lane]) return { ok: false, reason: '这条轨已有攻击牌（1 轨限 1 张）' };
    return { ok: true, reason: '' };
  }

  // 打出的牌直接进弃牌堆（回合末与手牌一起等洗回），保证 20 张守恒
  function placeCard(d, handIdx, lane) {
    const v = canPlace(d, handIdx, lane);
    if (!v.ok) throw new Error(v.reason);
    const card = d.hand.splice(handIdx, 1)[0];
    if (card.k === 'def') {
      d.laneDefs[lane]++;
      d.discardPile.push(card);
      d.log.push('防御放 ' + LANE_NAMES[lane] + ' 轨（盖 ' + Math.min(d.laneDefs[lane], notesOnLane(d, lane)) + '/' + notesOnLane(d, lane) + '）');
      return { t: 'placeDef', lane, covered: d.laneDefs[lane], total: notesOnLane(d, lane) };
    }
    d.attacks[lane] = card;
    d.attackOrder.push(lane);
    d.discardPile.push(card);
    d.log.push('攻击上 ' + LANE_NAMES[lane] + ' 轨');
    const placed = d.attackOrder.length;
    const chord = placed === 3 ? judgeChord(d.attackOrder, d.cfg) : chordIfAdd(d.attackOrder.slice(0, -1), lane, d.cfg);
    return { t: 'placeAtk', lane, placed, chord };
  }

  // ---- 结束回合结算：先敌后我 → 和弦加成 → 全弃 → 胜负 ----
  function endTurn(d) {
    if (d.over) throw new Error('战斗已结束');
    const evs = [];

    // 1. 敌音逐个结算（按播音顺序）：同轨前 laneDefs 个被盖=消解，其余漏网打玩家
    const seen = new Array(LANES).fill(0);
    d.notes.forEach((lane, i) => {
      if (seen[lane]++ < d.laneDefs[lane]) {
        evs.push({ t: 'noteBlocked', lane, index: i });
      } else {
        // 防御是 1 牌盖 1 音的二值覆盖：没盖住的敌音吃满攻击力（DEF_BLOCK 只描述「恰好抵一个」）
        const dmg = d.cfg.NOTE_ATK;
        d.playerHP -= dmg;
        evs.push({ t: 'noteHit', lane, index: i, dmg, playerHP: Math.max(0, d.playerHP) });
      }
    });

    // 2. 攻击牌按放置顺序飞打小怪
    let base = 0;
    for (const lane of d.attackOrder) {
      base += d.cfg.ATK_DMG;
      d.monsterHP -= d.cfg.ATK_DMG;
      evs.push({ t: 'strike', lane, dmg: d.cfg.ATK_DMG, monsterHP: Math.max(0, d.monsterHP) });
    }

    // 3. 和弦加成：恰好 3 张且构成大/小三和弦 → 合计 ×2（补足差额部分）
    let chord = null;
    if (d.attackOrder.length === 3) {
      chord = judgeChord(d.attackOrder, d.cfg);
      if (chord) {
        const bonus = base * (d.cfg.CHORD_MULT - 1);
        d.monsterHP -= bonus;
        evs.push({ t: 'chord', kind: chord.kind, root: chord.root, mult: d.cfg.CHORD_MULT, bonus, monsterHP: Math.max(0, d.monsterHP) });
        d.log.push((chord.kind === 'major' ? '大三和弦' : '小三和弦') + '！总伤 ×' + d.cfg.CHORD_MULT);
      }
    }

    // 4. 回合结束全弃手牌（打出的牌放置时已入弃牌堆）
    while (d.hand.length) d.discardPile.push(d.hand.pop());
    d.notes = [];
    d.laneDefs = new Array(LANES).fill(0);
    d.attacks = new Array(LANES).fill(null);
    d.attackOrder = [];

    // 5. 胜负：先敌后我结算语义下玩家死优先
    if (d.playerHP <= 0) { d.over = true; d.result = 'lose'; }
    else if (d.monsterHP <= 0) { d.over = true; d.result = 'win'; }
    evs.push({ t: 'turnEnd', turn: d.turn, playerHP: Math.max(0, d.playerHP), monsterHP: Math.max(0, d.monsterHP) });
    if (d.over) evs.push({ t: 'end', result: d.result, turns: d.turn });
    return evs;
  }

  return {
    CONFIG, createDuel, startTurn, canPlace, placeCard, endTurn,
    judgeChord, chordIfAdd, notesOnLane, drawCards,
  };
});
