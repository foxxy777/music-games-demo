/* V15 音浪尖塔 · 三音攻防 UI 主控（DOM 渲染 + 演出播放 + 交互，2026-09-09 任务书）
 * 保留复用：1280×720 缩放、七车道布局与点击听音、WebAudio SFX、重听按钮。
 * 移除：蓝图格子/指纹/能量/地图入口/复杂卡组（旧 ui.js 随旧玩法留档 git 历史）。
 */
(function () {
  'use strict';
  const V = window.V15;
  const SFX = V.SFX, D = V; // duel 内核挂 V15
  const { LANES, LANE_NAMES } = V;
  const $ = id => document.getElementById(id);
  const LANE_COLORS = ['#ff5d6c', '#ff9a3d', '#ffd54f', '#7dff8a', '#4dd8ff', '#7d8aff', '#d17dff'];

  let duel = null;
  let sel = null;          // {handIdx, kind:'def'|'atk'}
  let busy = false;        // 播音/结算演出中
  let speed = 1;
  let laneFields = [], laneEls = [];
  let chips = [];          // 小怪头顶三音预告 chips

  // ---------- 基础 ----------
  function delay(ms) { return new Promise(r => setTimeout(r, ms / speed)); }
  function showScreen(id) {
    document.querySelectorAll('.scr').forEach(s => s.classList.remove('on'));
    $(id).classList.add('on');
  }
  function toast(msg) {
    const t = $('toast'); t.textContent = msg; t.classList.add('on');
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove('on'), 1600);
  }
  function setHint(s, chord) { const h = $('b-hint'); h.textContent = s; h.classList.toggle('chord', !!chord); }
  function bigword(txt) {
    const b = $('bigword'); b.textContent = txt;
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  }
  function shakeApp() {
    $('app').classList.add('shake');
    setTimeout(() => $('app').classList.remove('shake'), 320);
  }
  function fit() {
    const s = Math.min(innerWidth / 1280, innerHeight / 720);
    $('app').style.transform = 'scale(' + s + ')';
  }
  addEventListener('resize', fit);

  // ---------- 入口 ----------
  $('vol').addEventListener('input', e => V.setVolume(e.target.value / 100));
  $('btn-start').addEventListener('click', () => { V.ensure(); SFX.ui(); newDuel(); });
  $('btn-again').addEventListener('click', () => { SFX.ui(); newDuel(); });
  $('btn-to-menu').addEventListener('click', () => { SFX.ui(); showScreen('scr-menu'); });

  function newDuel() {
    const qp = new URLSearchParams(location.search).get('seed');
    duel = D.createDuel(qp != null ? { seed: +qp } : {});
    sel = null;
    showScreen('scr-battle');
    buildLanes();
    beginTurn();
  }

  function buildLanes() {
    const wrap = $('b-lanes');
    wrap.innerHTML = '';
    laneFields = []; laneEls = [];
    for (let i = 0; i < LANES; i++) {
      const lane = document.createElement('div');
      lane.className = 'lane';
      const name = document.createElement('div');
      name.className = 'lane-name';
      name.textContent = LANE_NAMES[i];
      name.style.color = LANE_COLORS[i];
      name.addEventListener('click', e => { e.stopPropagation(); hearLane(i); });
      const field = document.createElement('div');
      field.className = 'lane-field';
      field.addEventListener('click', () => onLaneClick(i));
      lane.appendChild(name); lane.appendChild(field);
      wrap.appendChild(lane);
      laneEls.push(lane); laneFields.push(field);
    }
  }
  function hearLane(lane) { if (!busy) { V.ensure(); SFX.lane(lane, 0, 0.5); } }

  // ---------- 回合开始：播音演出 ----------
  async function beginTurn() {
    busy = true;
    clearSel();
    D.startTurn(duel);
    buildChips();
    renderAll();
    setHint('🎵 音符小怪播音中……听好是哪几条轨！');
    $('btn-replay').disabled = true;
    $('endturn').disabled = true;
    for (let i = 0; i < duel.notes.length; i++) {
      const lane = duel.notes[i];
      laneEls[lane].classList.remove('flash'); void laneEls[lane].offsetWidth; laneEls[lane].classList.add('flash');
      SFX.lane(lane, 0, duel.cfg.TONE_DUR_S);
      chips[i].classList.add('lit');
      await delay(duel.cfg.PLAY_INTERVAL_MS);
    }
    await delay(260);
    busy = false;
    $('btn-replay').disabled = false;
    $('endturn').disabled = false;
    setHint('🛡 防御牌盖敌音轨 · ⚔ 攻击牌放空轨 → 结束回合');
    renderAll();
  }

  function buildChips() {
    const box = $('enemy-chips');
    box.innerHTML = '';
    chips = [];
    duel.notes.forEach(lane => {
      const c = document.createElement('span');
      c.className = 'chip';
      c.textContent = LANE_NAMES[lane] + '×' + duel.cfg.NOTE_ATK;
      box.appendChild(c);
      chips.push(c);
    });
  }

  // ---------- 渲染 ----------
  function markX(fieldW, k) { return Math.round(fieldW * 0.56) + k * 44; } // 第 k 个敌音标记横向位置
  function atkX(idx) { return 64 + idx * 44; }                            // 第 idx 张攻击牌位置

  function renderLanes() {
    for (let i = 0; i < LANES; i++) {
      const field = laneFields[i];
      if (!field) continue;
      field.innerHTML = '';
      const W = field.clientWidth || 400, H = field.clientHeight || 54;
      // 敌音标记（按播音顺序，同轨叠排）；被盖住的前 laneDefs 个叠盾
      let k = 0;
      for (let n = 0; n < duel.notes.length; n++) {
        if (duel.notes[n] !== i) continue;
        const m = document.createElement('div');
        m.className = 'mark';
        m.textContent = '🎵';
        m.style.left = markX(W, k) + 'px';
        m.style.top = H / 2 + 'px';
        if (k < duel.laneDefs[i]) m.classList.add('covered');
        field.appendChild(m);
        if (k < duel.laneDefs[i]) {
          const s = document.createElement('div');
          s.className = 'shld';
          s.textContent = '🛡';
          s.style.left = markX(W, k) + 'px';
          s.style.top = H / 2 + 'px';
          field.appendChild(s);
        }
        k++;
      }
      // 攻击牌
      duel.attackOrder.forEach((lane, idx) => {
        if (lane !== i) return;
        const a = document.createElement('div');
        a.className = 'atk-mark';
        a.textContent = '⚔';
        a.style.left = atkX(idx) + 'px';
        a.style.top = H / 2 + 'px';
        field.appendChild(a);
      });
    }
  }

  function renderHand() {
    const hand = $('hand');
    hand.innerHTML = '';
    duel.hand.forEach((card, i) => {
      const el = document.createElement('div');
      el.className = 'card ' + card.k + (sel && sel.handIdx === i ? ' sel' : '');
      el.innerHTML = card.k === 'def'
        ? '<div class="cicon">🛡</div><div class="cname">防御</div><div class="cval">盖 1 个敌音 · 防 ' + duel.cfg.DEF_BLOCK + '</div>'
        : '<div class="cicon">⚔</div><div class="cname">攻击</div><div class="cval">飞打小怪 · 伤 ' + duel.cfg.ATK_DMG + '</div>';
      el.addEventListener('click', () => onCardClick(i));
      hand.appendChild(el);
    });
  }

  function renderHUD() {
    $('p-hpfill').style.width = Math.max(0, (duel.playerHP / duel.playerMaxHP) * 100) + '%';
    $('p-hptxt').textContent = Math.max(0, duel.playerHP) + ' / ' + duel.playerMaxHP;
    $('e-hpfill').style.width = Math.max(0, (duel.monsterHP / duel.monsterMaxHP) * 100) + '%';
    $('e-hptxt').textContent = Math.max(0, duel.monsterHP) + ' / ' + duel.monsterMaxHP;
    $('turn-ind').textContent = duel.turn > 0 ? '第 ' + duel.turn + ' 回合' : '';
    $('di-draw').textContent = duel.drawPile.length;
    $('di-discard').textContent = duel.discardPile.length;
    $('di-shuffle').textContent = duel.reshuffles;
  }

  function renderAll() { renderHUD(); renderLanes(); renderHand(); }

  // ---------- 交互 ----------
  function clearSel() {
    sel = null;
    document.querySelectorAll('.lane.t-def, .lane.t-atk').forEach(l => l.classList.remove('t-def', 't-atk'));
    renderHand();
  }

  function onCardClick(idx) {
    if (busy || !duel || duel.over) return;
    SFX.ui();
    if (sel && sel.handIdx === idx) { clearSel(); setHint('🛡 防御牌盖敌音轨 · ⚔ 攻击牌放空轨 → 结束回合'); return; }
    clearSel();
    sel = { handIdx: idx, kind: duel.hand[idx].k };
    for (let l = 0; l < LANES; l++) {
      if (!D.canPlace(duel, idx, l).ok) continue;
      laneEls[l].classList.add(sel.kind === 'def' ? 't-def' : 't-atk');
    }
    setHint(sel.kind === 'def' ? '点一条【发亮】的敌音轨盖住它' : '点一条【发亮】的空轨放置攻击');
    renderHand();
  }

  function onLaneClick(lane) {
    if (!sel) { hearLane(lane); return; } // 未选卡：点车道随时听音（保留复用）
    if (busy || duel.over) return;
    const v = D.canPlace(duel, sel.handIdx, lane);
    if (!v.ok) { toast(v.reason); return; }
    V.ensure();
    try {
      const ev = D.placeCard(duel, sel.handIdx, lane);
      if (ev.t === 'placeDef') SFX.guard(); else SFX.attack();
      if (ev.t === 'placeAtk' && ev.placed === 3 && ev.chord) {
        SFX.chordAt(duel.attackOrder.slice());
        setHint('🎼 ' + chordName(ev.chord) + '成立！结算总伤 ×' + duel.cfg.CHORD_MULT + '！', true);
      } else if (ev.t === 'placeAtk' && ev.chord) {
        setHint('🎼 再放 1 张凑成 ' + chordName(ev.chord) + ' → ×' + duel.cfg.CHORD_MULT + '！', true);
      } else {
        setHint('🛡 防御牌盖敌音轨 · ⚔ 攻击牌放空轨 → 结束回合');
      }
    } catch (e) { toast(e.message); return; }
    clearSel();
    renderAll();
  }

  function chordName(c) { return c ? (c.kind === 'major' ? '大三和弦' : '小三和弦') : ''; }

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && sel) { clearSel(); setHint('🛡 防御牌盖敌音轨 · ⚔ 攻击牌放空轨 → 结束回合'); }
  });

  // ---------- 结算演出 ----------
  $('endturn').addEventListener('click', async () => {
    if (busy || !duel || duel.over) return;
    busy = true;
    clearSel();
    setHint('结算……');
    $('endturn').disabled = true;
    $('btn-replay').disabled = true;
    const atkLanes = duel.attackOrder.slice(); // endTurn 会清空，先存给和弦演出用
    const evs = D.endTurn(duel);
    for (const ev of evs) await playEv(ev, atkLanes);
    if (duel.over) { await finish(); return; }
    await delay(360);
    beginTurn();
  });

  async function playEv(ev, atkLanes) {
    const W = laneFields[0] ? (laneFields[0].clientWidth || 400) : 400;
    switch (ev.t) {
      case 'noteBlocked': {
        // 该轨被盖住的敌音：标记划掉 + 盾消解
        const field = laneFields[ev.lane];
        const k = sameLaneIndexBefore(ev.lane, ev.index);
        const mark = field.children[k * 2]; // mark 与 shld 交替排列
        const shld = field.children[k * 2 + 1];
        if (shld) shld.classList.add('dissolve');
        if (mark) mark.classList.add('blocked');
        if (chips[ev.index]) chips[ev.index].classList.add('blocked');
        SFX.guard();
        await delay(340);
        break;
      }
      case 'noteHit': {
        const field = laneFields[ev.lane];
        const k = sameLaneIndexBefore(ev.lane, ev.index);
        const mark = field.children[k * 2];
        if (mark) { mark.classList.add('leak'); await delay(200); mark.classList.add('gone'); }
        if (chips[ev.index]) chips[ev.index].classList.add('leak');
        SFX.thud();
        shakeApp();
        const face = $('p-face');
        face.classList.add('hurt');
        setTimeout(() => face.classList.remove('hurt'), 320);
        renderHUD();
        await delay(380);
        break;
      }
      case 'strike': {
        // 攻击牌飞向小怪（1 轨限 1 张，querySelector 即目标）
        const field = laneFields[ev.lane];
        const mark = field.querySelector('.atk-mark');
        if (mark) {
          mark.style.left = (W + 60) + 'px';
          mark.style.top = '-30px';
          mark.classList.add('fly');
        }
        SFX.attack();
        await delay(300);
        const face = $('enemy-face');
        face.classList.add('hit');
        setTimeout(() => face.classList.remove('hit'), 320);
        SFX.strike();
        shakeApp();
        renderHUD();
        await delay(220);
        if (mark) mark.remove();
        break;
      }
      case 'chord': {
        bigword((ev.kind === 'major' ? '大三和弦' : '小三和弦') + '！×' + ev.mult);
        SFX.chordAt(atkLanes);
        shakeApp();
        renderHUD();
        await delay(950);
        break;
      }
      case 'end': await delay(200); break;
      default: await delay(40);
    }
  }
  // 该敌音是同轨第几个（0 起）——轨道标记定位用
  function sameLaneIndexBefore(lane, index) {
    let k = 0;
    for (let n = 0; n < index; n++) if (duel.notes[n] === lane) k++;
    return k;
  }

  // ---------- 重听敌音 ----------
  $('btn-replay').addEventListener('click', async () => {
    if (busy || !duel || duel.over || !duel.notes.length) return;
    busy = true; clearSel();
    $('btn-replay').disabled = true;
    setHint('🎵 重听本回合敌音……');
    for (let i = 0; i < duel.notes.length; i++) {
      const lane = duel.notes[i];
      laneEls[lane].classList.remove('flash'); void laneEls[lane].offsetWidth; laneEls[lane].classList.add('flash');
      SFX.lane(lane, 0, duel.cfg.TONE_DUR_S);
      await delay(duel.cfg.PLAY_INTERVAL_MS);
    }
    busy = false;
    $('btn-replay').disabled = false;
    setHint('🛡 防御牌盖敌音轨 · ⚔ 攻击牌放空轨 → 结束回合');
  });

  // ---------- 胜负 ----------
  async function finish() {
    const win = duel.result === 'win';
    bigword(win ? '胜 利 !' : '败 北 ……');
    win ? SFX.victory() : SFX.defeat();
    renderAll();
    await delay(1300);
    const b = $('bigword');
    b.classList.remove('pop'); // 大字动画(1.1s真实时长)未走完时也要让位给结算面板
    b.textContent = '';
    $('end-title').textContent = win ? '🏆 战 斗 胜 利' : '💀 战 斗 失 败';
    $('end-title').classList.toggle('lose', !win);
    $('end-stats').innerHTML = win
      ? '🎵 音符小怪被和弦淹没！<br>鏖战 <b>' + duel.turn + '</b> 回合 · 剩余血量 <b>' + Math.max(0, duel.playerHP) + '</b>'
      : '音浪吞没了流浪乐手……<br>苦战 <b>' + duel.turn + '</b> 回合 · 小怪剩余 <b>' + Math.max(0, duel.monsterHP) + '</b> 血';
    showScreen('scr-end');
    busy = false;
  }

  // ---------- 启动 ----------
  boot();
  function boot() { fit(); }
  // 调试/自动测试出口
  window.__dbg = {
    get duel() { return duel; },
    get busy() { return busy; },
    get speed() { return speed; }, set speed(v) { speed = v; },
    get sel() { return sel; },
  };
})();
