/* V15 音浪尖塔 · UI 主控（DOM 渲染 + 演出播放 + 交互） */
(function () {
  'use strict';
  const V = window.V15, WAVES = window.WAVES;
  const SFX = V.SFX, M = V, B = V; // battle/meta/audio 全部合并挂在 V15 上
  const { LANES, LANE_NAMES } = V;
  const $ = id => document.getElementById(id);

  const CARD_COLORS = { gold: '#ffd54f', purple: '#b388ff', orange: '#ff9a3d', red: '#ff5d6c', green: '#7dff8a', blue: '#4dd8ff' };
  const LANE_COLORS = ['#ff5d6c', '#ff9a3d', '#ffd54f', '#7dff8a', '#4dd8ff', '#7d8aff', '#d17dff'];
  const NODE_ICON = { battle: '⚔', elite: '💀', shop: '💰', campfire: '🔥', event: '❓', chest: '📦', boss: '👑' };
  const WAVE_META = {
    twinkle: { name: '小星星变奏曲', face: '⭐' }, ode: { name: '欢乐颂', face: '🎉' },
    elise: { name: '致爱丽丝', face: '💌' }, canon: { name: '卡农（精英）', face: '🎻' },
    fate: { name: '《命运》第一乐章', face: '👑' },
  };

  let run = null, battle = null;
  let sel = null;          // {handIdx, lanes:[], need}
  let speed = 1;
  let busy = false;        // 演出中
  let skipPreview = false, previewDone = false;
  let laneFields = [], fpDots = [];
  let bpLayer = null;      // 蓝图格子层（右半场覆盖层，独立于轨道 field，renderBattle 清场不影响）
  let bpCells = [];        // 本回合波次的蓝图格子 [{spawn, lane, el, marked, predicted, used}]

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
  function setHint(s) { $('b-hint').textContent = s; }
  function bigword(txt) {
    const b = $('bigword'); b.textContent = txt;
    b.classList.remove('pop'); void b.offsetWidth; b.classList.add('pop');
  }
  function cardEl(inst, opts = {}) {
    const def = V.cardDef(inst);
    const el = document.createElement('div');
    el.className = 'card' + (inst.up ? ' upg' : '');
    el.style.setProperty('--cc', CARD_COLORS[def.color] || '#3d4680');
    const cost = opts.cost != null ? opts.cost : V.cardCost(battle, inst);
    el.innerHTML = `<div class="cost">${cost}</div><div class="cname">${def.name}${inst.up ? '<span style="color:#ffd54f">+</span>' : ''}</div><div class="cdesc">${def.desc}</div><div class="ctype">${inst.up ? def.upDesc : def.name}</div>`;
    return el;
  }
  function overlayDeck(cards, onPick, title) {
    const ov = $('overlay');
    ov.innerHTML = '<h3>' + (title || '卡组') + '（' + cards.length + ' 张）</h3>';
    const row = document.createElement('div'); row.className = 'card-row';
    cards.forEach((c, i) => {
      const el = cardEl(c);
      if (onPick) el.addEventListener('click', () => { ov.classList.remove('on'); onPick(i); });
      row.appendChild(el);
    });
    ov.appendChild(row);
    const close = document.createElement('button'); close.className = 'btn'; close.textContent = '关闭';
    close.addEventListener('click', () => ov.classList.remove('on'));
    ov.appendChild(close);
    ov.classList.add('on');
  }

  // ---------- 缩放适配 ----------
  function fit() {
    const s = Math.min(innerWidth / 1280, innerHeight / 720);
    $('app').style.transform = 'scale(' + s + ')';
  }
  addEventListener('resize', fit);

  // ---------- 主菜单 ----------
  $('vol').addEventListener('input', e => V.setVolume(e.target.value / 100));
  $('btn-new').addEventListener('click', () => { V.ensure(); SFX.ui(); run = M.newRun(); showScreen('scr-map'); renderMap(); });
  $('btn-continue').addEventListener('click', () => {
    V.ensure(); SFX.ui();
    run = M.loadSave();
    if (!run) { toast('没有存档'); return; }
    showScreen('scr-map'); renderMap();
  });
  $('btn-to-menu').addEventListener('click', () => { SFX.ui(); showScreen('scr-menu'); refreshContinue(); });
  function refreshContinue() { $('btn-continue').disabled = !M.hasSave(); }

  // ---------- 地图 ----------
  function renderMap() {
    $('ms-hp').textContent = run.playerHP + '/' + run.playerMaxHP;
    $('ms-gold').textContent = run.gold;
    $('ms-deck').textContent = run.deck.length;
    $('ms-floor').textContent = Math.max(0, run.floor + 1);
    $('ms-relics').innerHTML = run.relics.map(r => (V.RELICS[r] ? V.RELICS[r].emoji + V.RELICS[r].name : '')).join('　') || '<span style="color:#5d6ba0">暂无遗物</span>';
    $('deck-btn').onclick = () => { SFX.ui(); overlayDeck(run.deck, null, '我的卡组'); };

    const view = $('map-view');
    view.innerHTML = '';
    const W = view.clientWidth, H = view.clientHeight;
    const rows = run.map.floors.length;
    const rowH = H / rows;
    const posOf = (f, i, n) => ({ x: (W * (i + 1)) / (n + 1), y: H - (f + 0.5) * rowH });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', W); svg.setAttribute('height', H);
    svg.style.position = 'absolute'; svg.style.inset = '0';
    for (let f = 0; f < rows - 1; f++) {
      const a = run.map.floors[f], b = run.map.floors[f + 1];
      for (let i = 0; i < a.length; i++) for (let j = 0; j < b.length; j++) {
        const p1 = posOf(f, i, a.length), p2 = posOf(f + 1, j, b.length);
        const ln = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        ln.setAttribute('x1', p1.x); ln.setAttribute('y1', p1.y);
        ln.setAttribute('x2', p2.x); ln.setAttribute('y2', p2.y);
        ln.setAttribute('stroke', f === run.floor ? '#7dffcf55' : '#2c3560');
        ln.setAttribute('stroke-width', 2);
        svg.appendChild(ln);
      }
    }
    view.appendChild(svg);

    run.map.floors.forEach((nodes, f) => {
      const row = document.createElement('div');
      row.className = 'mrow';
      row.style.top = (H - (f + 1) * rowH) + 'px';
      row.style.height = rowH + 'px';
      nodes.forEach((n, i) => {
        const p = posOf(f, i, nodes.length);
        const el = document.createElement('div');
        el.className = 'mnode ' + n.type;
        if (n.type === 'elite' || n.type === 'boss') el.classList.add(n.type);
        if (f > run.floor + 1) el.classList.add('fog');
        else if (f === run.floor + 1) el.classList.add('walk');
        if (f === run.floor) el.classList.add('here');
        el.style.position = 'absolute';
        el.style.left = (p.x - 20) + 'px'; // x 相对整行（行宽=视图宽）；y 行内对齐
        el.style.top = (n.type === 'boss' ? '-6' : '2') + 'px';
        el.textContent = NODE_ICON[n.type];
        el.title = { battle: '战斗', elite: '精英战斗', shop: '商店', campfire: '篝火', event: '事件', chest: '宝箱', boss: 'BOSS' }[n.type];
        el.addEventListener('click', () => onNodeClick(f, i));
        row.appendChild(el);
      });
      view.appendChild(row);
    });
  }

  function onNodeClick(f, idx) {
    if (busy || f !== run.floor + 1) return;
    SFX.ui();
    M.enterNode(run, idx);
    const type = run.pos.type;
    if (type === 'battle' || type === 'elite' || type === 'boss') {
      const cfg = M.battleConfig(run);
      startBattleNode(cfg);
    } else if (type === 'shop') { M.genShop(run); renderShop(); showScreen('scr-shop'); }
    else if (type === 'campfire') { renderCampfire(); showScreen('scr-campfire'); }
    else if (type === 'event') { renderEvent(M.genEvent(run)); showScreen('scr-event'); }
    else if (type === 'chest') {
      const rw = M.openChest(run);
      if (rw) { renderReward('chest'); showScreen('scr-reward'); } else { toast('遗物已集齐，换得 50 金币！'); renderMap(); }
    }
  }

  // ---------- 战斗：进入 ----------
  function startBattleNode(cfg) {
    const wave = WAVES[cfg.waveId];
    battle = B.createBattle({
      wave, deck: run.deck, relics: run.relics,
      playerHP: run.playerHP, playerMaxHP: run.playerMaxHP,
      kind: cfg.kind, fast: cfg.fast, seed: (Math.random() * 1e9) | 0,
    });
    sel = null; busy = true; previewDone = false; skipPreview = false;
    showScreen('scr-battle');
    buildLanes();
    buildFingerprint();
    renderHUD();
    $('enemy-name').textContent = (WAVE_META[cfg.waveId] || {}).name + (battle.kind === 'elite' ? ' 💀' : battle.kind === 'boss' ? ' 👑' : '');
    $('enemy-face').textContent = (WAVE_META[cfg.waveId] || {}).face || '🎵';
    $('preview-tip').style.display = 'block';
    renderBattle();
    toast('规则：清空轨道后我方音符冲线，对曲牌造成 剩余攻击×2 伤害；漏网敌音每回合敲 1 血。右半场格子可点开蓝图标记（听音辨名）');
    previewPerformance(wave);
  }

  function buildLanes() {
    const wrap = $('b-lanes');
    wrap.innerHTML = '';
    laneFields = [];
    for (let i = 0; i < LANES; i++) {
      const lane = document.createElement('div');
      lane.className = 'lane';
      const name = document.createElement('div');
      name.className = 'lane-name';
      name.textContent = LANE_NAMES[i];
      name.style.color = LANE_COLORS[i];
      const field = document.createElement('div');
      field.className = 'lane-field';
      field.addEventListener('click', () => onLaneClick(i));
      lane.appendChild(name); lane.appendChild(field);
      wrap.appendChild(lane);
      laneFields.push(field);
    }
    bpLayer = document.createElement('div');
    bpLayer.id = 'bp-layer';
    wrap.appendChild(bpLayer);
  }

  function buildFingerprint() {
    const fp = B.fingerprint(battle.wave);
    const box = $('fingerprint');
    box.innerHTML = ''; fpDots = [];
    for (let i = 0; i < LANES; i++) {
      const row = document.createElement('div');
      row.className = 'fp-row';
      const dots = [];
      for (let k = 0; k < fp[i].total; k++) {
        const d = document.createElement('div');
        d.className = 'fp-dot';
        row.appendChild(d); dots.push(d);
      }
      box.appendChild(row); fpDots.push(dots);
    }
  }

  // ---------- 蓝图格子（任务A：敌方波次以格子序列展示在右半场） ----------
  // 格子纵向落在本波次音轨上、从左到右按起飞顺序排列；不标注音名/音高/类型，玩家靠预演音判断
  function renderBlueprintCells() {
    if (!bpLayer) return;
    bpLayer.innerHTML = '';
    bpCells = [];
    if (!battle || battle.over) return;
    const wave = battle.spawns.filter(s => s.turn === battle.turn);
    if (!wave.length) return;
    const laneW = $('b-lanes').clientWidth;
    let gap = 54;
    const maxSpan = laneW * 0.42;
    if (wave.length * gap > maxSpan) gap = maxSpan / wave.length;
    const laneCenterY = lane => {
      const laneEl = laneFields[lane].parentElement;
      return laneEl.offsetTop + laneEl.clientHeight / 2;
    };
    wave.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'bp-cell';
      el.dataset.lane = s.lane;
      el.dataset.seq = i + 1;
      el.innerHTML = '<span class="seq">' + (i + 1) + '</span>';
      // 右对齐靠右缘排开：第 1 个在最左，依次向右
      el.style.left = (laneW - 44 - (wave.length - i) * gap) + 'px';
      el.style.top = laneCenterY(s.lane) + 'px';
      el.addEventListener('click', ev => { ev.stopPropagation(); onCellClick(el); });
      bpLayer.appendChild(el);
      bpCells.push({ spawn: s, lane: s.lane, el, marked: false, predicted: null, used: false });
    });
  }
  // lane-field 在 bp-layer 坐标系里的偏移与尺寸（起飞飞行/移交坐标换算用）
  function fieldBoxInLaneLayer(lane) {
    const f = laneFields[lane];
    const laneEl = f.parentElement;
    return { x: f.offsetLeft + laneEl.offsetLeft, y: laneEl.offsetTop, h: f.clientHeight };
  }

  async function previewPerformance(wave, replay) {
    skipPreview = false;
    const groups = B.waveByTurn(wave);
    const typeColor = { single: '#b388ff', std: '#7d8aff', long: '#4dd8ff', elite: '#ffd54f' };
    let idx = Array.from({ length: LANES }, () => 0);
    outer: for (const [, spawns] of groups) {
      for (const s of spawns) {
        if (skipPreview) break outer;
        const laneEl = laneFields[s.lane].parentElement;
        laneEl.classList.remove('flash'); void laneEl.offsetWidth; laneEl.classList.add('flash');
        SFX.lane(s.lane, s.type === 'long' ? -1 : s.type === 'single' ? 1 : 0, 0.5);
        const dots = fpDots[s.lane];
        if (dots && idx[s.lane] < dots.length) {
          const d = dots[idx[s.lane]++];
          d.classList.add('lit'); d.style.background = typeColor[s.type] || '#888'; d.style.color = typeColor[s.type] || '#888';
        }
        await delay(620);
      }
    }
    $('preview-tip').style.display = 'none';
    previewDone = true;
    busy = false;
    if (replay) renderHUD(); else doStartTurn(); // 重听只重放，不开新回合
  }
  $('btn-skip-preview').addEventListener('click', () => { skipPreview = true; SFX.ui(); });
  // 重听敌曲：整波预演重播（不重置手牌/蓝图标记，仅重放音频+指纹点亮动画）
  $('btn-replay-wave').addEventListener('click', () => {
    if (busy || !battle || battle.over || !previewDone || sel) return;
    SFX.ui();
    busy = true; previewDone = false;
    $('preview-tip').style.display = 'block';
    renderHUD();
    previewPerformance(battle.wave, true);
  });

  // ---------- 蓝图格子交互（任务B：常驻交互，无开关） ----------
  function onCellClick(el) {
    const c = bpCells.find(x => x.el === el);
    if (!c || busy || !previewDone || !battle || battle.over || sel) return;
    if (c.marked) { // 再点取消
      c.marked = false; c.predicted = null;
      el.classList.remove('blueprint');
      const tag = el.querySelector('.bp-tag'); if (tag) tag.remove();
      SFX.ui();
      return;
    }
    // 点格先播该格预演音（单音高八度 / 长音低八度，与预演口径一致），再弹音名选择器
    SFX.lane(c.lane, c.spawn.type === 'long' ? -1 : c.spawn.type === 'single' ? 1 : 0, 0.4);
    openBpPop(c);
  }
  // 7 音名小选择器：玩家听预演音后辨名，选中即进入蓝图标记态
  function openBpPop(c) {
    closeBpPop();
    const pop = document.createElement('div');
    pop.className = 'bp-pop';
    pop.innerHTML = '<div class="bp-pop-t">听到的音是？</div>';
    const grid = document.createElement('div');
    grid.className = 'bp-pop-g';
    LANE_NAMES.forEach((nm, i) => {
      const b = document.createElement('button');
      b.className = 'bp-opt';
      b.textContent = nm;
      b.style.color = LANE_COLORS[i];
      b.addEventListener('click', ev => {
        ev.stopPropagation();
        c.marked = true; c.predicted = nm;
        c.el.classList.add('blueprint');
        let tag = c.el.querySelector('.bp-tag');
        if (!tag) { tag = document.createElement('div'); tag.className = 'bp-tag'; c.el.appendChild(tag); }
        tag.textContent = nm;
        SFX.ui();
        closeBpPop();
      });
      grid.appendChild(b);
    });
    pop.appendChild(grid);
    const cancel = document.createElement('button');
    cancel.className = 'bp-cancel';
    cancel.textContent = '取消';
    cancel.addEventListener('click', ev => { ev.stopPropagation(); closeBpPop(); });
    pop.appendChild(cancel);
    // 弹在格子左侧（格子都在右半场，向左弹不溢出）
    const cx = parseFloat(c.el.style.left), cy = parseFloat(c.el.style.top);
    pop.style.left = Math.max(90, cx - 168) + 'px';
    pop.style.top = Math.max(4, cy - 34) + 'px';
    bpLayer.appendChild(pop);
  }
  function closeBpPop() { if (bpLayer) { const p = bpLayer.querySelector('.bp-pop'); if (p) p.remove(); } }

  // ---------- 战斗：渲染 ----------
  function posForP(lane, note) {
    const W = laneFields[lane].clientWidth;
    const j = battle.lanes[lane].P.indexOf(note);
    return 36 + Math.max(0, j) * 46;
  }
  function posForE(lane, note) {
    // 敌音起飞后的驻留位：中偏右排开（蓝图格子起飞后向左飞入场内，与格子区错开）
    const W = laneFields[lane].clientWidth;
    const k = battle.lanes[lane].E.indexOf(note);
    return Math.round(W * 0.52) + Math.max(0, k) * 46;
  }
  function noteEl(n, lane) {
    const el = document.createElement('div');
    if (n.side === 'p') {
      el.className = 'note-u' + (n.kind === 'shield' ? ' shield' : '') + (n.sweep ? ' swept' : '');
      el.innerHTML = '<span class="num">' + n.hp + '</span>';
    } else {
      el.className = 'note-e t-' + n.type;
      el.innerHTML = '<span class="num">' + n.hp + '</span>' + tagHtml(n);
    }
    el._note = n;
    return el;
  }
  function tagHtml(n) {
    let s = '';
    if (n.poison > 0) s += '<span class="psn">毒' + n.poison + '</span>';
    if (n.burn > 0) s += '<span class="brn">燃' + n.burn + '</span>';
    return s ? '<div class="ntag">' + s + '</div>' : '';
  }
  function ensureEl(n, lane) {
    if (n.el && n.el.isConnected) return n.el;
    const el = noteEl(n, lane);
    laneFields[lane].appendChild(el);
    n.el = el;
    placeEl(n, lane);
    return el;
  }
  function placeEl(n, lane) {
    const H = laneFields[lane].clientHeight;
    const x = n.side === 'p' ? posForP(lane, n) : posForE(lane, n);
    n.el.style.left = x + 'px';
    n.el.style.top = H / 2 + 'px';
  }
  function reflowLane(lane) {
    const L = battle.lanes[lane];
    for (const n of L.P) if (n.el && n.el.isConnected) { placeEl(n, lane); n.el.querySelector('.num') && (n.el.querySelector('.num').textContent = n.hp); }
    for (const n of L.E) if (n.el && n.el.isConnected) { placeEl(n, lane); n.el.querySelector('.num').textContent = n.hp; const tg = n.el.querySelector('.ntag'); if (tg) tg.outerHTML = tagHtml(n); }
  }

  function renderBattle() {
    for (let i = 0; i < LANES; i++) {
      const field = laneFields[i];
      field.innerHTML = '';
      const L = battle.lanes[i];
      for (const n of L.P) { const el = noteEl(n, i); field.appendChild(el); n.el = el; }
      for (const n of L.E) { const el = noteEl(n, i); field.appendChild(el); n.el = el; }
      // 定位
      const H = field.clientHeight || 54;
      for (const n of L.P) { n.el.style.left = posForP(i, n) + 'px'; n.el.style.top = H / 2 + 'px'; }
      for (const n of L.E) { n.el.style.left = posForE(i, n) + 'px'; n.el.style.top = H / 2 + 'px'; }
    }
    renderHUD();
  }

  function renderHUD() {
    if (!battle) return;
    $('p-hpfill').style.width = Math.max(0, (battle.playerHP / battle.playerMaxHP) * 100) + '%';
    $('p-hptxt').textContent = Math.max(0, battle.playerHP) + ' / ' + battle.playerMaxHP;
    $('p-badges').innerHTML =
      (battle.strength ? '<span class="badge str">💪 力量 ' + battle.strength + '</span>' : '') +
      (battle.resonance ? '<span class="badge reso">🎵 谐振 ' + battle.resonance + '</span>' : '');
    $('e-hpfill').style.width = Math.max(0, (battle.enemyHP / battle.enemyMaxHP) * 100) + '%';
    $('e-hptxt').textContent = Math.max(0, battle.enemyHP) + ' / ' + battle.enemyMaxHP;
    $('turn-ind').textContent = '第 ' + battle.turn + ' 回合' + (battle.wave.boss && battle.bossPhase ? ' · ' + B.BOSS_PHASES[battle.bossPhase].name : '');
    $('en-n').textContent = battle.energy;
    $('en-m').textContent = '/' + battle.maxEnergy + ' 能量';
    // 手牌
    const hand = $('hand');
    hand.innerHTML = '';
    battle.hand.forEach((inst, i) => {
      const el = cardEl(inst);
      const cost = V.cardCost(battle, inst);
      if (cost > battle.energy) el.classList.add('poor');
      if (sel && sel.handIdx === i) el.classList.add('sel');
      el.addEventListener('click', () => onCardClick(i));
      hand.appendChild(el);
    });
    $('endturn').disabled = busy || !previewDone || !!battle.over;
  }

  // ---------- 战斗：交互 ----------
  function clearSel() { sel = null; setHint(''); document.querySelectorAll('.lane.targetable').forEach(l => l.classList.remove('targetable')); document.querySelectorAll('.note-e.targetable').forEach(n => n.classList.remove('targetable')); }

  function onCardClick(idx) {
    if (busy || !battle || battle.over || !previewDone) return;
    const inst = battle.hand[idx];
    const def = V.cardDef(inst);
    SFX.ui();
    if (sel && sel.handIdx === idx) { clearSel(); renderHUD(); return; }
    const cost = V.cardCost(battle, inst);
    if (cost > battle.energy) { toast('能量不足'); return; }
    clearSel();
    if (!def.need) { playSelected(idx, { lanes: [] }); return; }
    sel = { handIdx: idx, lanes: [], need: def.need };
    renderHUD();
    if (def.need === 'lane') {
      setHint('选择一条轨道放置'); markLanes(() => true);
    } else if (def.need === 'lane2') {
      setHint('选择第 1 条轨道'); markLanes(() => true);
    } else if (def.need === 'lane3') {
      setHint('选中心轨（2~6），向三条相邻轨放置'); markLanes(l => l >= 1 && l <= 5);
    } else if (def.need === 'note') {
      setHint('选择一个敌方音符');
      for (const L of battle.lanes) for (const e of L.E) if (e.el) e.el.classList.add('targetable');
    }
  }
  function markLanes(cond) {
    laneFields.forEach((f, i) => { if (cond(i)) f.parentElement.classList.add('targetable'); });
  }
  function onLaneClick(lane) {
    if (!sel || busy) return;
    if (sel.need === 'lane3' && (lane < 1 || lane > 5)) { toast('需选 2~6 轨为中心'); return; }
    SFX.lane(lane);
    sel.lanes.push(lane);
    if (sel.need === 'lane2' && sel.lanes.length < 2) { setHint('再选第 2 条轨道'); return; }
    playSelected(sel.handIdx, { lanes: sel.lanes.slice() });
  }
  function playSelected(idx, ctx) {
    let evs;
    try { evs = B.playCard(battle, idx, ctx); }
    catch (e) { toast(e.message); clearSel(); renderHUD(); return; }
    clearSel();
    renderBattle();
    if (battle.playerHP <= 0) checkBattleEnd(); // 血怒自伤兜底
  }
  // 敌音点击（选目标）——事件委托
  $('b-lanes').addEventListener('click', e => {
    const t = e.target.closest('.note-e');
    if (!t || !sel || sel.need !== 'note' || busy) return;
    const note = t._note;
    if (!note) return;
    SFX.poison();
    playSelected(sel.handIdx, { noteId: note.id });
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { closeBpPop(); clearSel(); renderHUD(); } });

  function doStartTurn() {
    B.startTurn(battle);
    clearSel();
    renderBattle();
    renderBlueprintCells();
    setHint('我方回合：出牌 / 结束回合 · 点右半场敌方格子做蓝图标记');
  }

  // ---------- 蓝图判定（任务C）：预测音名 vs 实际车道唱名，绿/红停留 1 秒后淡出 ----------
  async function judgeBlueprintPhase() {
    closeBpPop();
    const marked = bpCells.filter(c => c.marked && !c.used);
    if (!marked.length) return;
    let okCount = 0;
    for (const c of marked) {
      c.ok = c.predicted === LANE_NAMES[c.spawn.lane];
      c.el.classList.add(c.ok ? 'bp-ok' : 'bp-bad');
      if (c.ok) { okCount++; SFX.bpOk(); } else SFX.bpFail();
      await delay(120);
    }
    // 任务D 奖励：每标对 +1 抽牌（回合结算保留手牌，下回合即可用）
    if (okCount > 0) {
      B.drawCards(battle, okCount);
      const fb0 = fieldBoxInLaneLayer(marked[0].lane);
      floatText(marked[0].lane, fb0.x + 200, '蓝图命中 ×' + okCount + '，抽 ' + okCount, '#7dff8a');
      // 蓝图之眼：每标对对敌英雄直伤 2（走冲线同通道，先于 endTurn 让 checkEnd 能读到）
      if (V.hasRelic(battle, 'blueprinteye')) {
        battle.enemyHP -= 2 * okCount;
        battle.stats.damage += 2 * okCount;
        battle.log.push('蓝图之眼：' + okCount + ' 个标对 → 敌方英雄 -' + (2 * okCount) + ' HP');
        $('enemy-face').classList.add('hit');
        setTimeout(() => $('enemy-face').classList.remove('hit'), 350);
        setTimeout(() => floatText(marked[0].lane, fb0.x + 200, '👁️ 蓝图之眼 -' + (2 * okCount) + '!', '#ffd54f'), 480); // 错开抽牌浮字
      }
      renderHUD();
    }
    await delay(1000); // 判定结果显示 1 秒
    for (const c of marked) c.el.classList.remove('bp-ok', 'bp-bad'); // 淡出（CSS 过渡），随后起飞依次飞出
    await delay(260);
  }

  // ---------- 战斗：结算演出 ----------
  $('endturn').addEventListener('click', async () => {
    if (busy || !battle || battle.over || !previewDone) return;
    busy = true; renderHUD(); clearSel(); setHint('');
    await judgeBlueprintPhase(); // 蓝图判定先于结算；判定完格子随 takeoff 事件依次飞出
    const evs = B.endTurn(battle);
    for (const ev of evs) await playEvent(ev);
    clearDeadEls();
    renderBattle();
    if (battle.over) { await finishBattle(); return; }
    doStartTurn();
    busy = false; renderHUD();
  });

  function clearDeadEls() {
    for (let i = 0; i < LANES; i++) {
      const L = battle.lanes[i];
      for (const n of [...L.P, ...L.E]) if (n.el && n.el.classList.contains('dead')) { n.el.remove(); }
    }
  }

  function floatText(lane, x, txt, color) {
    const field = laneFields[lane];
    const el = document.createElement('div');
    el.className = 'float-txt';
    el.textContent = txt;
    el.style.color = color || '#fff';
    el.style.left = x + 'px';
    el.style.top = '2px';
    field.appendChild(el);
    setTimeout(() => el.remove(), 900 / speed);
  }
  function particles(lane, x, color, n = 10) {
    const field = laneFields[lane];
    const H = field.clientHeight / 2;
    for (let i = 0; i < n; i++) {
      const p = document.createElement('div');
      p.className = 'particle';
      p.style.background = color;
      p.style.left = x + 'px'; p.style.top = H + 'px';
      p.style.setProperty('--dx', (Math.random() * 90 - 45) + 'px');
      p.style.setProperty('--dy', (Math.random() * 80 - 40) + 'px');
      p.style.boxShadow = '0 0 8px ' + color;
      field.appendChild(p);
      setTimeout(() => p.remove(), 550 / speed);
    }
  }

  async function playEvent(ev) {
    switch (ev.t) {
      case 'takeoff': {
        const lane = ev.lane, n = ev.note;
        SFX.takeoff();
        // 蓝图格子制：敌音不再从右缘飞入，而是由本回合对应格子原地变形、沿车道向左飞入场内
        const cell = bpCells.find(c => !c.used && c.lane === lane);
        if (cell && cell.el.isConnected) {
          cell.used = true;
          const el = cell.el;
          el.className = 'note-e t-' + n.type;
          el.innerHTML = '<span class="num">' + n.hp + '</span>' + tagHtml(n);
          el._note = n; n.el = el;
          const fb = fieldBoxInLaneLayer(lane);
          await raf();
          el.style.left = (fb.x + posForE(lane, n)) + 'px';
          el.style.top = (fb.y + fb.h / 2) + 'px';
          await delay(420);
          laneFields[lane].appendChild(el); // 移交给轨道 field 坐标系，此后走常规音符渲染
          el.style.left = posForE(lane, n) + 'px';
          el.style.top = fb.h / 2 + 'px';
        } else {
          // 兜底（无对应格子时保持旧入场，正常流程不会走到）
          const el = ensureEl(n, lane);
          const W = laneFields[lane].clientWidth;
          el.style.left = (W + 40) + 'px';
          await raf(); placeEl(n, lane);
          await delay(220);
        }
        break;
      }
      case 'poisonTick': {
        const el = ensureEl(ev.note, ev.note.lane);
        el.style.filter = 'hue-rotate(90deg) brightness(1.6)';
        floatText(ev.note.lane, parseFloat(el.style.left), '-' + '?毒', '#7dff8a');
        SFX.poison();
        await delay(240);
        el.style.filter = ''; reflowLane(ev.note.lane);
        if (!battle.lanes[ev.note.lane].E.includes(ev.note)) { el.classList.add('dead'); await delay(180); el.remove(); }
        break;
      }
      case 'poisonSpread': {
        await delay(120);
        break;
      }
      case 'burnTick': {
        const el = ensureEl(ev.note, ev.note.lane);
        el.style.filter = 'sepia(1) saturate(3)';
        SFX.burn();
        await delay(220);
        el.style.filter = '';
        if (!battle.lanes[ev.note.lane].E.includes(ev.note)) { el.classList.add('dead'); await delay(160); el.remove(); }
        break;
      }
      case 'clash': {
        const lane = ev.lane;
        const pe = ensureEl(ev.p, lane), ee = ensureEl(ev.e, lane);
        const H = laneFields[lane].clientHeight / 2;
        const px = parseFloat(pe.style.left), ex = parseFloat(ee.style.left);
        const mid = (px + ex) / 2;
        pe.style.left = (mid + 14) + 'px'; ee.style.left = (mid - 14) + 'px';
        await delay(180);
        particles(lane, mid, '#ffd54f', 12);
        SFX.boom();
        if (ev.kind === 'clash' && ev.diff != null) floatText(lane, mid, (ev.diff > 0 ? '+' : '') + ev.diff, ev.diff > 0 ? '#7dff8a' : '#ff7a7a');
        const L = battle.lanes[lane];
        if (!L.P.includes(ev.p)) { pe.classList.add('dead'); }
        else { pe.style.left = px + 'px'; pe.querySelector('.num').textContent = ev.p.hp; }
        if (!L.E.includes(ev.e)) { ee.classList.add('dead'); }
        else { ee.style.left = ex + 'px'; ee.querySelector('.num').textContent = ev.e.hp; const tg = ee.querySelector('.ntag'); if (tg) tg.outerHTML = tagHtml(ev.e); }
        await delay(260);
        if (pe.classList.contains('dead')) pe.remove();
        if (ee.classList.contains('dead')) ee.remove();
        reflowLane(lane);
        break;
      }
      case 'combo': {
        const laneEl = laneFields[ev.lane].parentElement;
        laneEl.classList.remove('flash'); void laneEl.offsetWidth; laneEl.classList.add('flash');
        // 闪电横线
        const field = laneFields[ev.lane];
        const bolt = document.createElement('div');
        bolt.className = 'bolt';
        bolt.style.left = '60px'; bolt.style.right = '60px'; bolt.style.top = (field.clientHeight / 2) + 'px';
        bolt.style.width = (field.clientWidth - 120) + 'px';
        field.appendChild(bolt);
        setTimeout(() => bolt.remove(), 400 / speed);
        SFX.combo(ev.combo);
        await delay(170);
        break;
      }
      case 'sweepMove': {
        const from = laneFields[ev.from], to = laneFields[ev.to];
        if (ev.note.el) { ev.note.el.remove(); ev.note.el = null; }
        const el = ensureEl(ev.note, ev.to);
        const y0 = from.getBoundingClientRect().top, y1 = to.getBoundingClientRect().top;
        el.style.top = (parseFloat(el.style.top) + (y0 - y1)) + 'px';
        await raf(); placeEl(ev.note, ev.to);
        SFX.strike();
        await delay(240);
        break;
      }
      case 'strike': {
        const lane = ev.lane, n = ev.note;
        const el = n.el && n.el.isConnected ? n.el : ensureEl(n, n.lane);
        const W = laneFields[lane].clientWidth;
        el.style.left = (W + 30) + 'px';
        SFX.strike();
        $('enemy-face').classList.add('hit');
        setTimeout(() => $('enemy-face').classList.remove('hit'), 350);
        floatText(lane, W - 40, '-' + ev.dmg + '!', '#ffd54f');
        $('app').classList.add('shake');
        setTimeout(() => $('app').classList.remove('shake'), 320);
        await delay(330);
        el.remove(); reflowLane(lane);
        renderHUD();
        break;
      }
      case 'breach': {
        const lane = ev.lane;
        const L = battle.lanes[lane];
        for (const e of L.E) { const el = ensureEl(e, lane); el.style.left = '26px'; }
        SFX.thud();
        $('app').classList.add('shake');
        $('p-hptxt').style.color = '#ff5d6c';
        setTimeout(() => { $('app').classList.remove('shake'); $('p-hptxt').style.color = ''; }, 340);
        floatText(lane, 40, '-' + ev.count + ' HP', '#ff5d6c');
        await delay(380);
        renderHUD();
        break;
      }
      case 'resonance': {
        bigword('共鸣！');
        SFX.lane(4, 1); SFX.resonate();
        renderHUD();
        await delay(650);
        break;
      }
      case 'resonanceX': {
        bigword('共振 ×' + ev.mult + '！');
        SFX.resonate();
        $('app').classList.add('shake');
        setTimeout(() => $('app').classList.remove('shake'), 340);
        renderHUD();
        await delay(850);
        break;
      }
      case 'bossPhase': {
        const bn = $('phase-banner');
        bn.querySelector('.p1').textContent = '第' + '一二三四'[ev.phase - 1] + '阶段 · ' + ev.name;
        bn.querySelector('.p2').textContent = ev.desc;
        bn.classList.remove('show'); void bn.offsetWidth; bn.classList.add('show');
        SFX.phase();
        await delay(1300);
        break;
      }
      case 'end': {
        await delay(300);
        break;
      }
      default: await delay(30);
    }
  }
  function raf() { return new Promise(r => requestAnimationFrame(r)); }

  async function finishBattle() {
    busy = true;
    if (battle.result === 'win') {
      bigword('胜 利 !');
      SFX.victory();
      await delay(1400);
      M.winBattle(run, battle);
      if (run.over) { renderEnd(); showScreen('scr-end'); return; }
      renderReward('battle');
      showScreen('scr-reward');
    } else {
      bigword('败 北 ……');
      SFX.defeat();
      await delay(1600);
      M.loseBattle(run);
      renderEnd();
      showScreen('scr-end');
    }
    busy = false;
  }
  function checkBattleEnd() {
    B.checkEnd(battle);
    if (battle.over) finishBattle();
  }

  // ---------- 奖励 ----------
  function renderReward(kind) {
    const rw = run.pendingRewards;
    $('rw-gold').textContent = rw.gold ? '💰 金币 +' + rw.gold : kind === 'chest' ? '📦 宝箱开启！' : '';
    const relicBox = $('rw-relic');
    relicBox.innerHTML = '';
    if (rw.relic) {
      const r = V.RELICS[rw.relic];
      const btn = document.createElement('button');
      btn.className = 'btn gold';
      btn.textContent = r.emoji + ' ' + r.name + '：' + r.desc;
      btn.addEventListener('click', () => {
        M.takeRewardRelic(run); rw.relic = null; SFX.strike(); renderReward(kind);
      });
      relicBox.appendChild(btn);
    }
    const row = $('rw-cards');
    row.innerHTML = '';
    rw.cards.forEach((c, i) => {
      const el = cardEl(c);
      el.addEventListener('click', () => { M.takeRewardCard(run, i); SFX.ui(); afterReward(); });
      row.appendChild(el);
    });
  }
  function afterReward() { showScreen('scr-map'); renderMap(); }
  $('rw-skip').addEventListener('click', () => { M.skipReward(run); SFX.ui(); afterReward(); });

  // ---------- 商店 ----------
  function renderShop() {
    const shop = run.shop;
    $('sh-gold').textContent = '💰 ' + run.gold;
    const row = $('sh-cards');
    row.innerHTML = '';
    shop.cards.forEach((it, i) => {
      const el = cardEl(it.inst, { cost: V.cardDef(it.inst).cost });
      const tag = document.createElement('div');
      tag.className = 'price-tag';
      tag.textContent = it.sold ? '已售出' : it.price + ' 💰';
      el.appendChild(tag);
      if (it.sold) el.classList.add('sold');
      else el.addEventListener('click', () => {
        try { M.buyCard(run, i); SFX.strike(); toast('已购买'); renderShop(); }
        catch (e) { toast(e.message); }
      });
      row.appendChild(el);
    });
    const rbox = $('sh-relic');
    rbox.innerHTML = '';
    if (shop.relic) {
      const r = V.RELICS[shop.relic.id];
      const btn = document.createElement('button');
      btn.className = 'btn' + (shop.relic.sold ? ' sold' : '');
      btn.textContent = r.emoji + ' ' + r.name + ' 150💰';
      btn.title = r.desc;
      btn.addEventListener('click', () => {
        try { M.buyRelic(run); SFX.strike(); toast('遗物入手！'); renderShop(); } catch (e) { toast(e.message); }
      });
      rbox.appendChild(btn);
    }
    $('sh-remove').disabled = shop.removeUsed || run.gold < shop.removePrice;
  }
  $('sh-remove').addEventListener('click', () => {
    overlayDeck(run.deck, i => {
      const name = V.cardDef(run.deck[i]).name;
      try { M.buyRemove(run, i); SFX.boom(); toast('已删除：' + name); renderShop(); }
      catch (e) { toast(e.message); }
    }, '选择要删除的卡（75💰）');
  });
  $('sh-leave').addEventListener('click', () => { M.leaveShop(run); SFX.ui(); afterReward(); });

  // ---------- 篝火 ----------
  function renderCampfire() {
    $('cf-heal').textContent = Math.ceil(run.playerMaxHP * 0.35);
  }
  $('cf-rest').addEventListener('click', () => {
    const h = M.campfireRest(run);
    SFX.heal ? SFX.heal() : SFX.ui();
    toast('休息回血 ' + h + ' 点');
    afterReward();
  });
  $('cf-up').addEventListener('click', () => {
    const cand = run.deck.map((c, i) => ({ c, i })).filter(x => x.c.up < 1);
    if (!cand.length) { toast('没有可升级的卡'); return; }
    overlayDeck(cand.map(x => x.c), j => {
      const c = M.campfireUpgrade(run, cand[j].i);
      SFX.strike();
      toast('已升级：' + V.cardDef(c).name + '+');
      afterReward();
    }, '选择要升级的卡');
  });

  // ---------- 事件 ----------
  function renderEvent(ev) {
    $('ev-emoji').textContent = ev.emoji;
    $('ev-name').textContent = ev.name;
    $('ev-desc').textContent = ev.desc;
    const box = $('ev-opts');
    box.innerHTML = '';
    ev.options.forEach((o, i) => {
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = o.label;
      btn.addEventListener('click', () => {
        SFX.ui();
        M.chooseEvent(run, i);
        if (run.pendingRewards) { renderReward('event'); showScreen('scr-reward'); }
        else afterReward();
      });
      box.appendChild(btn);
    });
  }

  // ---------- 结束画面 ----------
  function renderEnd() {
    const win = run.result === 'victory';
    $('end-title').textContent = win ? '🏆 第一幕通关！' : '💀 败北删档';
    $('end-stats').innerHTML = win
      ? '总伤害 <b style="color:#ffd54f">' + run.stats.totalDamage + '</b>　·　总回合 <b style="color:#ffd54f">' + run.stats.totalTurns + '</b>　·　谐振触发 <b style="color:#ffd54f">' + run.stats.resonanceProcs + '</b> 次<br>《命运》在音浪中谢幕。第二幕，敬请期待。'
      : '音浪吞没了流浪乐手……<br>存档已删除，从头再来一趟吧。';
  }
  $('end-menu').addEventListener('click', () => { SFX.ui(); refreshContinue(); showScreen('scr-menu'); });

  // ---------- 启动 ----------
  function boot() {
    fit();
    refreshContinue();
    document.addEventListener('click', () => V.ensure(), { once: true });
  }
  boot();
  // 调试/自动测试出口
  window.__dbg = {
    get battle() { return battle; }, get run() { return run; },
    get busy() { return busy; }, get speed() { return speed; }, set speed(v) { speed = v; },
    get bpCells() { return bpCells; },
    playSelected, onEndTurnB: () => $('endturn').click(),
  };
})();
