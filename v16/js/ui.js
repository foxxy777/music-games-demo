/* V16 防空版 · 界面与主循环（渲染 / 交互 / 四画面状态机） */
(function () {
  'use strict';
  const R = window;
  const V = R.V16;
  const SONG = R.V16_SONG;
  const A = R.V16_AUDIO || R.V16; // audio.js 已并入 V16
  const $ = id => document.getElementById(id);

  // ===== 几何 =====
  const CV = $('field'), CX = CV.getContext('2d');
  const G = { top: 74, bot: 628, axisW: 46, baseL: 58, baseR: 148, gunX: 176, trackL: 208, trackR: 1218 };
  const ROWH = (G.bot - G.top) / 14;
  const cellY = c => G.bot - (c + 0.5) * ROWH;
  const yToCell = y => Math.max(0, Math.min(13.99, (G.bot - y) / ROWH - 0.5));
  const misX = p => G.trackL + (G.trackR - G.trackL) * (1 - p);

  // ===== 状态 =====
  let run = null, battle = null;
  let phase = 'idle';            // idle | listen | intercept | wavewin | shop | end
  let speed = 1, acc = 0;
  let replays = 0;
  let listenT = 0;
  let sweepClock = 0;
  let selShape = 'wave', selMode = 'search';
  let segLo = -1, segHi = -1;    // 部署音高段（点左轴两下）
  let gunArm = -1;               // 炮指向模式
  let fx = [];
  let banner = null;             // {text, color, ttl}
  let lastTs = 0, rafId = 0;

  // ===== 工具 =====
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  function showScreen(id) {
    for (const s of document.querySelectorAll('.scr')) s.classList.remove('on');
    $(id).classList.add('on');
  }
  function setText(id, s) { const el = $(id); if (el.textContent !== s) el.textContent = s; }

  // ===== 战绩/菜单 =====
  function refreshRecord() {
    const r = V.loadRecord();
    $('record-line').textContent = `战绩 ${r.w || 0} 胜 / ${r.l || 0} 负`;
  }
  function toMenu() {
    phase = 'idle'; battle = null; run = null;
    A.stopMelody(); A.sweepStopAll();
    refreshRecord();
    showScreen('scr-menu');
  }

  // ===== 对局开始 =====
  function newGame(seed) {
    run = V.newRun(seed != null ? seed : (Date.now() % 1e9), SONG);
    showScreen('scr-game');
    startWaveUI();
  }
  function startWaveUI() {
    battle = V.startWave(run, SONG);
    phase = 'listen';
    replays = 0;
    segLo = -1; segHi = -1; gunArm = -1;
    sweepClock = 0; fx = []; banner = null; acc = 0; speed = 1;
    setText('btn-speed', '速度 ×1');
    const wave = battle.wave;
    listenT = wave.boss ? 24 : 18;
    setText('wave-n', (run.waveIdx + 1) + '/4');
    setText('wave-name', wave.name + (wave.boss ? ' ⚠全弹齐发' : ''));
    $('wave-name').className = wave.boss ? 'boss-tag' : '';
    setText('tier-val', SONG.tiers[run.tierIdx].name);
    $('deploy-panel').style.display = 'flex';
    $('intercept-panel').style.display = 'none';
    $('listen-timer').style.display = 'none';
    updateGunButtons(); updateSegLabel(); updateSweepChips(); updateHud();
    // 听辨音频（MuseScore 预渲染 mp3；file:// 下自动回退合成）
    playListen();
  }
  function playListen() {
    const seg = SONG.tiers[run.tierIdx].segs[battle.wave.idx];
    const beatSec = battle.wave.listenBeatSec;
    A.playMelody(V.audioFile(run.tierIdx, battle.wave.idx), seg.audio, beatSec, null);
  }

  // ===== 部署窗口交互 =====
  function deploySweepUI() {
    if (phase !== 'listen' || segLo < 0 || segHi < 0) { A.SFX.deny(); return; }
    try {
      const s = V.deploySweep(battle, { shape: selShape, lo: segLo, hi: segHi, mode: selMode });
      A.sweepStart(s);
      A.SFX.deploy();
      segLo = -1; segHi = -1;
      updateSegLabel(); updateSweepChips(); updateHud();
    } catch (e) { A.SFX.deny(); flashHint(e.message); }
  }
  function aimGunUI(gunIdx, cell) {
    try {
      V.aimGun(battle, gunIdx, cell);
      A.SFX.aim();
      updateGunButtons();
      gunArm = -1;
    } catch (e) { A.SFX.deny(); flashHint(e.message); }
  }
  function updateGunButtons() {
    document.querySelectorAll('.gun').forEach((b, i) => {
      const g = battle ? battle.guns[i] : null;
      b.textContent = g ? `炮${i + 1}·格${g.cell}±${g.cover}` : `炮${i + 1}`;
      b.classList.toggle('sel', gunArm === i);
    });
  }
  function updateSegLabel() {
    setText('seg-label', segLo < 0 ? '点左轴' : (segHi < 0 ? `格${segLo}↔?` : `格${segLo}↔${segHi}`));
  }
  function updateSweepChips() {
    const box = $('sweep-chips');
    box.innerHTML = '';
    if (!battle) return;
    battle.sweeps.forEach((s, i) => {
      const el = document.createElement('span');
      el.className = 'swchip';
      el.style.color = s.mode === 'track' ? '#ffd54f' : '#4dd8ff';
      el.textContent = `${V.SHAPE_NAMES[s.shape]}${s.lo}-${s.hi} ×`;
      el.title = '点击取消（不退费）';
      el.onclick = () => {
        if (phase !== 'listen') return;
        A.sweepStop(s);
        battle.sweeps.splice(i, 1);
        updateSweepChips(); updateHud();
      };
      box.appendChild(el);
    });
  }
  function flashHint(msg) { banner = { text: msg, color: '#ff9a9a', ttl: 1.6 }; }

  function goIntercept() {
    if (phase !== 'listen') return;
    A.stopMelody();
    try { V.startRun(battle); } catch (e) { return; }
    phase = 'intercept';
    $('deploy-panel').style.display = 'none';
    $('intercept-panel').style.display = 'flex';
    $('listen-timer').style.display = 'block';
    setText('phase-hint', '拦截中 —— 探测波扫到才会显形，炮火只打显形目标');
  }

  // ===== 拦截：事件 → 演出/音效 =====
  function processEvents() {
    const evs = battle.events;
    battle.events = [];
    for (const e of evs) {
      if (e.k === 'shot') {
        const g = battle.guns[e.gun];
        fx.push({ t: 'tracer', x1: G.gunX, y1: cellY(g.cell), x2: misX(V.missileProg(battle, battle.missiles.find(m => m.id === e.id) || { cell: e.cell })) || misX(0.9), y2: cellY(e.cell), ttl: 0.12, max: 0.12 });
        A.SFX.shot();
      } else if (e.k === 'kill') {
        fx.push({ t: 'pop', x: misX(0.92), y: cellY(e.cell), ttl: 0.4, max: 0.4 });
        A.SFX.kill();
        updateHud();
      } else if (e.k === 'breach') {
        fx.push({ t: 'boom', x: G.baseR + 10, y: cellY(e.cell), ttl: 0.6, max: 0.6 });
        A.SFX.breach();
        $('app').classList.remove('shake'); void $('app').offsetWidth; $('app').classList.add('shake');
        updateHud();
      } else if (e.k === 'reveal') {
        A.SFX.reveal();
        // 音画同步抽验日志：显形帧各扫描头位置与带宽（与引擎判定同一 y）
        (R.__revealLog = R.__revealLog || []).push({
          t: +e.t.toFixed(2), cell: e.cell,
          ys: battle.sweeps.map(s => +(s.y != null ? s.y : 0).toFixed(2)),
          band: battle.sweeps.map(s => +V.bandHalf(s, battle.upgrades).toFixed(2)),
        });
      } else if (e.k === 'win') {
        banner = { text: '来 波 清 空', color: '#ffe9b8', ttl: 1.5 };
      } else if (e.k === 'lose') {
        banner = { text: '基地 告 破', color: '#ff7a7a', ttl: 1.5 };
      }
    }
  }
  function onWaveDone() {
    phase = 'wavewin';
    A.sweepStopAll();
    const res = battle.result;
    setTimeout(() => {
      const r = V.endWave(run);
      updateHud();
      if (r === 'shop') { openShop(); }
      else { showEnd(r === 'victory'); }
    }, res === 'win' ? 1200 : 1400);
  }

  // ===== 商店 =====
  function openShop() {
    phase = 'shop';
    showScreen('scr-shop');
    renderShop();
  }
  function renderShop() {
    setText('shop-gold', '资金 ' + run.gold);
    const grid = $('shop-grid');
    grid.innerHTML = '';
    run.shop.forEach((s, i) => {
      const el = document.createElement('div');
      el.className = 'shop-item' + (s.sold ? ' sold' : (run.gold < s.price ? ' poor' : ''));
      el.innerHTML = `<span class="lv">Lv${s.lv}/${s.max}</span><div class="nm">${s.name}</div><div class="ds">${s.desc}</div><div class="pr">$ ${s.price}</div>`;
      el.onclick = () => {
        try { V.buyShop(run, i); A.SFX.buy(); renderShop(); }
        catch (e) { A.SFX.deny(); setText('shop-hint', e.message); }
      };
      grid.appendChild(el);
    });
    setText('shop-hint', run.waveIdx === 3 ? '下一波：Boss 高潮段全弹齐发！' : '下一波 ' + (run.waveIdx + 1) + '/4');
  }
  function nextWave() {
    if (run && run.shop) V.leaveShop(run);
    showScreen('scr-game');
    startWaveUI();
  }

  // ===== 结算 =====
  function showEnd(victory) {
    phase = 'end';
    showScreen('scr-end');
    $('end-title').textContent = victory ? '防 空 成 功' : '基 地 陷 落';
    $('end-title').className = victory ? 'v' : 'd';
    const rec = V.loadRecord();
    $('end-stats').innerHTML = victory
      ? `《${SONG.title}》4 波全部拦截<br>剩余基地 HP ${run.baseHP} · 资金 ${run.gold}`
      : `《${SONG.title}》拦至第 ${run.waveIdx + 1} 波<br>基地 HP 归零`;
    $('end-record').textContent = `总战绩：${rec.w} 胜 / ${rec.l} 负（移调档 ${SONG.tiers[run ? run.tierIdx : 1].name}）`;
    (victory ? A.SFX.win : A.SFX.lose).call(A.SFX);
  }

  // ===== HUD =====
  function updateHud() {
    if (!run) return;
    setText('gold-val', String(Math.floor(battle ? battle.gold : run.gold)));
    setText('hp-val', String(Math.ceil(battle && battle.phase !== 'done' ? battle.baseHP : run.baseHP)));
    setText('btn-replay', '重听 ×' + Math.max(0, 1 - replays));
    $('btn-replay').disabled = phase !== 'listen' || replays >= 1;
    setText('btn-deploy', '部署 −1费');
  }

  // ===== 渲染 =====
  function draw() {
    CX.clearRect(0, 0, 1280, 720);
    // 行带
    for (let c = 0; c < 14; c++) {
      const y = cellY(c) - ROWH / 2;
      CX.fillStyle = c % 2 ? '#0d1226aa' : '#0a0e1faa';
      CX.fillRect(G.axisW, y, 1280 - G.axisW, ROWH);
      CX.fillStyle = '#1c2448';
      CX.fillRect(G.axisW, y + ROWH - 1, 1280 - G.axisW, 1);
      // 左轴（音高轴）
      CX.fillStyle = '#8f9ccf';
      CX.font = '13px "Segoe UI"';
      CX.textAlign = 'right';
      CX.fillText(V.cellName(c), 40, cellY(c) + 4);
    }
    if (!battle) return;
    const b = battle;
    const up = b.upgrades;

    // 炮台覆盖
    for (const g of b.guns) {
      CX.fillStyle = 'rgba(127,212,160,0.07)';
      CX.fillRect(G.baseR, cellY(g.cell + g.cover) - ROWH / 2, G.trackL - G.baseR, ROWH * (2 * g.cover + 1));
      CX.fillStyle = 'rgba(127,212,160,0.14)';
      CX.fillRect(G.baseR, cellY(g.cell) - ROWH / 2, G.trackL - G.baseR, ROWH);
    }
    // 探测波段标记 + 扫描线
    const running = phase === 'intercept' || phase === 'wavewin';
    for (const s of b.sweeps) {
      let y;
      if (running && s.y != null) y = s.y;
      else y = V.scannerY(s, sweepClock, up);      // 听辨期本地钟（预扫可见可听）
      const col = s.mode === 'track' ? '#ffd54f' : '#4dd8ff';
      // 放置段
      CX.fillStyle = col + '10';
      CX.fillRect(G.trackL, cellY(s.hi) - ROWH / 2, G.trackR - G.trackL, ROWH * (s.hi - s.lo + 1));
      CX.strokeStyle = col + '55';
      CX.setLineDash([4, 6]);
      CX.strokeRect(G.trackL, cellY(s.hi) - ROWH / 2, G.trackR - G.trackL, ROWH * (s.hi - s.lo + 1));
      CX.setLineDash([]);
      // 扫描带 + 线（音画同步：显形帧=引擎 step 里的同一 y）
      const bh = V.bandHalf(s, up) * ROWH;
      const grad = CX.createLinearGradient(0, y * 0 + cellY(y) - bh, 0, cellY(y) + bh);
      grad.addColorStop(0, col + '00'); grad.addColorStop(0.5, col + '33'); grad.addColorStop(1, col + '00');
      CX.fillStyle = grad;
      CX.fillRect(G.trackL, cellY(y) - bh, G.trackR - G.trackL, bh * 2);
      CX.strokeStyle = col; CX.lineWidth = 2;
      CX.beginPath(); CX.moveTo(G.trackL, cellY(y)); CX.lineTo(G.trackR, cellY(y)); CX.stroke();
      CX.lineWidth = 1;
      // 音画同步：驱动扫频音
      A.sweepUpdate(s, y, true);
    }

    // 导弹（听辨阶段不可见——只能听！）
    if (running) {
      for (const m of b.missiles) {
        if (!m.alive) continue;
        const vis = V.visible(m, b.t);
        if (!vis) continue;
        const alpha = clamp((m.revealDur - (b.t - m.revealT)) / 1.2, 0.25, 1);
        const x = misX(V.missileProg(b, m));
        const y = cellY(m.cell);
        CX.globalAlpha = alpha;
        CX.fillStyle = '#ff8a9a';
        CX.font = (m.hp >= 2 ? '26px' : '21px') + ' serif';
        CX.textAlign = 'center';
        CX.fillText(m.hp >= 3 ? '𝄞' : m.hp === 2 ? '♫' : '♪', x, y + 7);
        // 弹尾
        CX.strokeStyle = '#ff8a9a66';
        CX.beginPath(); CX.moveTo(x + 14, y); CX.lineTo(x + 46, y); CX.stroke();
        // 血量点
        for (let i = 0; i < m.maxHp; i++) {
          CX.fillStyle = i < m.hp ? '#ffd54f' : '#333a5e';
          CX.fillRect(x - (m.maxHp * 5 - 2) / 2 + i * 5, y + 11, 3.4, 3.4);
        }
        CX.globalAlpha = 1;
      }
    } else if (phase === 'listen') {
      CX.fillStyle = '#8f9ccf';
      CX.font = '19px "Segoe UI"';
      CX.textAlign = 'center';
      CX.fillText(`听辨中 —— 来袭 ${b.wave.total} 枚（弹道不可见，用耳朵）`, (G.trackL + G.trackR) / 2, (G.top + G.bot) / 2);
    }

    // 炮台
    b.guns.forEach((g, i) => {
      const y = cellY(g.cell);
      CX.fillStyle = gunArm === i ? '#aef0cc' : '#7fd4a0';
      CX.beginPath();
      CX.moveTo(G.gunX - 16, y + 12); CX.lineTo(G.gunX + 2, y); CX.lineTo(G.gunX - 16, y - 12);
      CX.closePath(); CX.fill();
      CX.fillStyle = '#4a6b58';
      CX.fillRect(G.gunX - 22, y - 9, 8, 18);
      CX.fillStyle = '#8f9ccf'; CX.font = '11px "Segoe UI"'; CX.textAlign = 'center';
      CX.fillText('炮' + (i + 1), G.gunX - 8, y + 26);
    });

    // 基地
    const hpMax = run.maxBaseHP, hp = b.baseHP;
    CX.fillStyle = '#1b2140';
    CX.fillRect(G.baseL, G.top, G.baseR - G.baseL, G.bot - G.top);
    CX.fillStyle = '#232b4d';
    CX.fillRect(G.baseL + 8, G.top + 8, G.baseR - G.baseL - 16, G.bot - G.top - 16);
    CX.fillStyle = '#ffe9b8';
    CX.font = 'bold 22px "Segoe UI"'; CX.textAlign = 'center';
    CX.fillText('基 地', (G.baseL + G.baseR) / 2, G.top + 40);
    CX.font = 'bold 30px "Segoe UI"';
    CX.fillStyle = hp <= 3 ? '#ff7a7a' : '#ff9a76';
    CX.fillText(hp, (G.baseL + G.baseR) / 2, G.top + 80);
    // HP 条（竖）
    const bh2 = (G.bot - G.top - 130);
    CX.fillStyle = '#10152c';
    CX.fillRect(G.baseL + 30, G.top + 100, 16, bh2);
    CX.fillStyle = hp <= 3 ? '#ff7a7a' : '#ff9a76';
    const fh = bh2 * clamp(hp / hpMax, 0, 1);
    CX.fillRect(G.baseL + 30, G.top + 100 + bh2 - fh, 16, fh);

    // 部署预览
    if (phase === 'listen' && segLo >= 0) {
      const hi = segHi >= 0 ? segHi : segLo;
      CX.fillStyle = (selMode === 'track' ? '#ffd54f' : '#4dd8ff') + '22';
      CX.fillRect(G.trackL, cellY(hi) - ROWH / 2, G.trackR - G.trackL, ROWH * (Math.abs(hi - segLo) + 1));
    }

    // 特效
    fx = fx.filter(f => (f.ttl -= 1 / 60) > 0);
    for (const f of fx) {
      const k = f.ttl / f.max;
      if (f.t === 'tracer') {
        CX.strokeStyle = `rgba(255,244,214,${k})`;
        CX.beginPath(); CX.moveTo(f.x1, f.y1); CX.lineTo(f.x2, f.y2); CX.stroke();
      } else if (f.t === 'pop') {
        CX.strokeStyle = `rgba(255,213,79,${k})`;
        CX.beginPath(); CX.arc(f.x, f.y, (1 - k) * 26 + 6, 0, 7); CX.stroke();
      } else if (f.t === 'boom') {
        CX.fillStyle = `rgba(255,122,122,${k * 0.8})`;
        CX.beginPath(); CX.arc(f.x, f.y, (1 - k) * 44 + 8, 0, 7); CX.fill();
      }
    }

    // 大字横幅
    if (banner) {
      banner.ttl -= 1 / 60;
      if (banner.ttl <= 0) banner = null;
      else {
        CX.fillStyle = banner.color + 'ee';
        CX.font = 'bold 52px "Segoe UI"';
        CX.textAlign = 'center';
        CX.fillText(banner.text, 640, 320);
      }
    }
  }

  // ===== 主循环 =====
  function loop(ts) {
    rafId = R.requestAnimationFrame(loop);
    const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
    lastTs = ts;
    if (phase === 'listen') {
      sweepClock += dt;
      listenT -= dt;
      const tEl = $('listen-timer2');
      const s = Math.max(0, Math.ceil(listenT));
      if (tEl.textContent !== s + 's') tEl.textContent = s + 's';
      if (listenT <= 0) goIntercept();
      updateHud();
    } else if (phase === 'intercept') {
      acc += dt * speed;
      const STEP = 1 / 60;
      let guard = 0;
      while (acc >= STEP && guard++ < 30) {
        V.step(battle, STEP);
        acc -= STEP;
      }
      processEvents();
      setText('stat-kills', '击落 ' + battle.killed);
      setText('stat-leaks', '漏网 ' + battle.breached);
      $('listen-timer').textContent = battle.t.toFixed(1) + 's';
      updateHud();
      if (battle.phase === 'done') onWaveDone();
    }
    draw();
  }

  // ===== 输入 =====
  CV.addEventListener('pointerdown', e => {
    A.ensure();
    if (phase !== 'listen') return;
    const rect = CV.getBoundingClientRect();
    const scale = 1280 / rect.width;
    const x = (e.clientX - rect.left) * scale, y = (e.clientY - rect.top) * scale;
    if (gunArm >= 0) { aimGunUI(gunArm, Math.round(yToCell(y))); return; }
    if (x > G.axisW + 20) return; // 点左轴设段
    const c = Math.round(yToCell(y));
    if (segLo < 0) { segLo = clamp(c, 0, 12); segHi = -1; }
    else if (c === segLo) { segLo = -1; segHi = -1; }
    else { segHi = clamp(c, segLo + 1, 13); }
    updateSegLabel();
  });
  document.querySelectorAll('.shape').forEach(b => b.onclick = () => {
    selShape = b.dataset.shape;
    document.querySelectorAll('.shape').forEach(x => x.classList.toggle('sel', x === b));
  });
  document.querySelector('.shape[data-shape="wave"]').classList.add('sel');
  document.querySelectorAll('.mode').forEach(b => b.onclick = () => {
    selMode = b.dataset.mode;
    document.querySelectorAll('.mode').forEach(x => x.classList.toggle('sel', x === b));
  });
  document.querySelectorAll('.gun').forEach((b, i) => b.onclick = () => {
    gunArm = gunArm === i ? -1 : i;
    updateGunButtons();
  });
  $('btn-deploy').onclick = deploySweepUI;
  $('btn-go').onclick = () => { A.ensure(); goIntercept(); };
  $('btn-replay').onclick = () => {
    if (phase !== 'listen' || replays >= 1) return;
    replays++;
    playListen();
    updateHud();
  };
  $('btn-speed').onclick = () => {
    speed = speed === 1 ? 2 : speed === 2 ? 4 : 1;
    setText('btn-speed', '速度 ×' + speed);
  };
  $('btn-menu').onclick = toMenu;
  $('btn-start').onclick = () => { A.ensure(); newGame(); };
  $('btn-next-wave').onclick = nextWave;
  $('btn-again').onclick = () => { A.ensure(); newGame(); };
  $('btn-back').onclick = toMenu;
  $('vol').oninput = e => A.setVolume(e.target.value / 100);

  // ===== 自动化钩子（TB/截图） =====
  function botDeploy() {
    // 与 TB8 同款直给策略：大范围搜索 + 最密3格跟踪；炮指最密格心
    const d = new Array(14).fill(0);
    for (const n of battle.wave.notes) d[n.cell] += n.hp;
    const segBest = (span, wLo, wHi, w) => {
      let blo = 0, bs = -1;
      for (let lo = 0; lo + span - 1 < 14; lo++) {
        let s = 0;
        for (let c = lo; c < lo + span; c++) s += d[c] * (c >= wLo && c <= wHi ? w : 1);
        if (s > bs) { bs = s; blo = lo; }
      }
      return blo;
    };
    const cov = battle.guns[0].cover;
    const lo1 = segBest(8, -1, -1, 1);
    try { V.deploySweep(battle, { shape: 'wave', lo: lo1, hi: lo1 + 7, mode: 'search' }); } catch (e) {}
    try {
      const lo2 = segBest(3, lo1, lo1 + 7, 0.3);
      V.deploySweep(battle, { shape: 'wave', lo: lo2, hi: lo2 + 2, mode: 'track' });
    } catch (e) {}
    const gunCell = avoid => {
      let bc = cov, bs = -1;
      for (let c = cov; c <= 13 - cov; c++) {
        let s = 0;
        for (let k = c - cov; k <= c + cov; k++) s += d[k];
        if (avoid.some(a => Math.abs(c - a) <= cov)) s *= 0.25;
        if (s > bs) { bs = s; bc = c; }
      }
      return bc;
    };
    const g0 = gunCell([]);
    V.aimGun(battle, 0, g0);
    V.aimGun(battle, 1, gunCell([g0]));
    updateGunButtons(); updateSweepChips(); updateHud();
  }
  function ff(seconds) {
    let el = 0;
    while (phase === 'intercept' && el < seconds) {
      V.step(battle, 0.05); el += 0.05;
      processEvents();
      if (battle.phase === 'done') onWaveDone();
    }
    return battle.result;
  }

  R.__dbg = {
    get run() { return run; },
    get battle() { return battle; },
    get phase() { return phase; },
    get screen() { return document.querySelector('.scr.on').id; },
    V, SONG,
    newGame,
    setSeg(lo, hi) { segLo = lo; segHi = hi; },
    selectShape(s) { selShape = s; }, selectMode(m) { selMode = m; },
    deploy: deploySweepUI,
    armGun(i) { gunArm = i; updateGunButtons(); },
    aimGun: aimGunUI,
    go: goIntercept,
    botDeploy,
    ff,
    setSpeed(x) { speed = x; },
    buyShop(i) { try { V.buyShop(run, i); renderShop(); return true; } catch (e) { return false; } },
    nextWave,
    shop() { return run && run.shop; },
    gold() { return run ? (battle && battle.phase !== 'done' ? battle.gold : run.gold) : 0; },
    replay() { replays = 0; $('btn-replay').click(); },
    skipListen() { listenT = 0.01; },
    toMenu,
    record() { return V.loadRecord(); },
  };

  refreshRecord();
  R.requestAnimationFrame(ts => { lastTs = ts; loop(ts); });
})();
