/* V17 游戏引擎：连续播放（Web Audio 时钟）→ 出卡 → 燃烧进度条 → 判定 → 结算
 * 音画同步铁律：进度条/曲线播放头全部由 AudioContext 时钟推导，绝不本地累加。
 * 超时判定：卡窗结束瞬间仍未作答 = 超时，扣 1 血（在切卡沿结算）。
 * URL 参数（测试钩子，不带参数即正常玩法）：seed / t=起始秒 / debug=1 / auto=correct|wrong
 */
(function () {
  'use strict';
  var $ = function (id) { return document.getElementById(id); };
  var V = window.V17;
  var params = new URLSearchParams(location.search);
  var DEBUG = params.get('debug') === '1';
  var START_T = parseFloat(params.get('t') || '0') || 0;
  var AUTO = params.get('auto') || '';
  var FIXED_SEED = params.get('seed') !== null ? (parseInt(params.get('seed'), 10) >>> 0) : null;
  var BEST_KEY = 'v17_best_qilixiang_v1';
  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

  // ---- 资产 ----
  var cards = null, curves = null, buffer = null;
  // ---- 音频时钟 ----
  var ac = null, gain = null, srcNode = null, anchorCtx = 0, anchorSong = 0, playing = false;
  // ---- 一局 ----
  var runId = 0, state = null, round = null, curIdx = -1, answered = false, finished = true;
  var view = null; // 当前卡的双卡共享值域 + 各卡统计缓存

  // ================= 启动 =================
  $('btn-start').onclick = startGame;
  $('songcard').onclick = startGame;
  $('btn-quit').onclick = toTitle;
  $('btn-again').onclick = beginRun;
  $('btn-home').onclick = toTitle;
  $('wrapL').onclick = function () { pick('L'); };
  $('wrapR').onclick = function () { pick('R'); };
  window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft' || e.key === 'a' || e.key === 'A') pick('L');
    else if (e.key === 'ArrowRight' || e.key === 'd' || e.key === 'D') pick('R');
  });
  if (DEBUG) {
    $('dbg').classList.remove('hidden');
    $('dbg-seek10').onclick = function () { seek(songTime() + 10); };
    $('dbg-toend').onclick = function () { seek(buffer.duration - 2.5); };
    $('dbg-restart').onclick = function () { beginRun(); };
    $('dbg-auto').onchange = function () { AUTO = this.value; };
    if (AUTO) $('dbg-auto').value = AUTO;
    // 自动化测试钩子（仅 debug 参数下存在）
    window.__v17 = {
      snap: function () {
        return {
          t: songTime(), idx: curIdx, answered: answered, finished: finished,
          dead: state && state.dead, hp: state && state.hp,
          score: state && state.score, combo: state && state.combo,
          maxCombo: state && state.maxCombo, correct: state && state.correct,
          answeredCount: state && state.answered,
          card: curIdx >= 0 ? { start: curves[curIdx].start, end: curves[curIdx].end } : null,
          real: curIdx >= 0 ? round[curIdx].side : null,
          acState: ac && ac.state, dur: buffer && buffer.duration,
          rating: (function () { try { return document.getElementById('rating').textContent; } catch (e) { return ''; } })(),
        };
      },
    };
  }
  renderBestLine();

  function startGame() {
    var btn = $('btn-start');
    btn.disabled = true;
    $('loadmsg').textContent = '加载音频（52MB wav）…';
    try {
      if (!ac) {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        gain = ac.createGain(); gain.gain.value = 0.9; gain.connect(ac.destination);
      }
    } catch (e) {
      $('loadmsg').textContent = '无法创建 AudioContext：' + e.message;
      btn.disabled = false; return;
    }
    var ready;
    if (buffer) ready = Promise.resolve();
    else ready = Promise.all([
      fetch('assets/cards/cards.json').then(function (r) { return r.json(); }),
      fetch('assets/cards/curves.json').then(function (r) { return r.json(); }),
      fetch('assets/songs/qilixiang.m4a').then(function (r) { return r.arrayBuffer(); }),
    ]).then(function (rs) {
      cards = rs[0].cards;
      curves = rs[1].cards;
      if (cards.length !== curves.length) throw new Error('cards.json 与 curves.json 卡数不一致');
      $('loadmsg').textContent = '解码音频…';
      return ac.decodeAudioData(rs[2]).then(function (buf) {
        buffer = buf;
        if (Math.abs(buffer.duration - rs[0].summary.song_dur) > 0.5)
          throw new Error('音频时长与卡表不符 (' + buffer.duration.toFixed(2) + ' vs ' + rs[0].summary.song_dur + ')');
      });
    });
    ready.then(function () {
      $('loadmsg').textContent = '';
      return ac.resume();
    }).then(function () {
      btn.disabled = false;
      beginRun();
    }).catch(function (e) {
      $('loadmsg').textContent = '加载失败：' + e.message + '（请用 启动V17.bat 启动本地服务）';
      btn.disabled = false;
    });
  }

  // ================= 一局 =================
  function beginRun() {
    runId++;
    finished = false;
    state = V.newState();
    curIdx = -1; answered = false; view = null;
    round = V.buildRound(curves, FIXED_SEED !== null ? FIXED_SEED : (Math.random() * 4294967296 >>> 0));
    hidePair();
    hideRest();
    clearFeedback();
    showScreen('screen-game');
    updateHud();
    startPlayback(START_T);
    var my = runId;
    requestAnimationFrame(function loop() {
      if (finished || my !== runId) return;
      frame();
      requestAnimationFrame(loop);
    });
  }

  function frame() {
    var t = songTime();
    if (t >= buffer.duration - 0.06) { finishSong(); return; }
    var idx = state.dead ? -1 : V.activeCardAt(curves, t);
    if (idx !== curIdx) enterCard(idx, t);
    if (idx >= 0) {
      var card = curves[idx];
      var p = V.cardProgress(card, t);
      setBar(p, idx);
      drawPair(idx, t);
      if (!answered && AUTO && t - card.start >= 1.0) {
        var real = round[idx].side;
        pick(AUTO === 'correct' ? real : (real === 'L' ? 'R' : 'L'));
      }
    } else {
      setBar(0, -1);
      showRest(t);
    }
    if (DEBUG) updateDbg(t, idx);
  }

  // 进出卡沿：上一卡未答 = 超时判负（测试钩子跳秒不判）
  function enterCard(newIdx, t) {
    if (curIdx >= 0 && !answered && !state.dead && Math.abs(t - curves[curIdx].end) < 0.6) {
      V.applyWrong(state);
      feedback('超时 −1 血', 'bad');
      flashHit();
      updateHud();
    }
    curIdx = newIdx;
    answered = false;
    if (newIdx >= 0 && !state.dead) {
      view = makeView(newIdx);
      $('pair').classList.remove('hidden');
      ['wrapL', 'wrapR'].forEach(function (id) { $(id).className = 'cardwrap'; });
      hideRest();
    } else {
      hidePair();
      if (state.dead) showRest(t);
    }
  }

  function pick(side) {
    if (finished || state.dead || curIdx < 0 || answered) return;
    answered = true;
    var real = round[curIdx].side;
    if (side === real) {
      var g = V.applyCorrect(state);
      feedback('+' + g + '　连击 x' + state.combo, 'good');
      mark('wrap' + side, 'pick-good');
      mark('wrap' + (side === 'L' ? 'R' : 'L'), 'dim');
    } else {
      V.applyWrong(state);
      feedback('答错 −1 血', 'bad');
      mark('wrap' + side, 'pick-bad');
      mark('wrap' + real, 'reveal');
      mark('wrap' + (side === 'L' ? 'R' : 'L'), 'dim');
      flashHit();
    }
    ['wrapL', 'wrapR'].forEach(function (id) { $(id).classList.add('noclick'); });
    updateHud();
  }

  function flashHit() {
    var f = $('flash'), st = $('stage');
    f.classList.add('on');
    st.classList.remove('shake');
    void st.offsetWidth;
    st.classList.add('shake');
    setTimeout(function () { f.classList.remove('on'); }, 60);
  }

  // ================= 渲染 =================
  function drawPair(idx, t) {
    var card = curves[idx];
    drawCard($('cvL'), card, view, t);
    drawCard($('cvR'), card, view, t);
  }

  // 定稿样式：白底红曲线 + 蓝中位虚线 + 绝对音名刻度 + 橙色播放头
  // 左卡画真身/假身由 round.side 决定；值域两卡共享，音区平移型干扰在轴上一眼可见
  function drawCard(cv, card, view, t) {
    var side = cv.id === 'cvL' ? 'L' : 'R';
    var isReal = round[curIdx].side === side;
    var midi = isReal ? card.midi : view.decoyCurve;
    var ctx = cv.getContext('2d');
    var W = cv.width, H = cv.height, L = 52, R = 14, T = 40, B = 36;
    var dur = card.end - card.start;

    ctx.setLineDash([]);
    ctx.fillStyle = '#fdfdfd';
    ctx.fillRect(0, 0, W, H);
    var x = function (i) { return L + (i / (midi.length - 1)) * (W - L - R); };
    var y = function (v) { return T + (1 - (v - view.lo) / (view.hi - view.lo)) * (H - T - B); };

    // 网格 + 绝对音名刻度
    var step = (view.hi - view.lo) <= 12.5 ? 1 : 2;
    ctx.font = '12px Consolas, monospace';
    ctx.textAlign = 'right'; ctx.textBaseline = 'middle';
    for (var g = Math.ceil(view.lo); g <= Math.floor(view.hi); g += step) {
      var gy = y(g);
      ctx.strokeStyle = 'rgba(0,0,0,.10)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(L, gy); ctx.lineTo(W - R, gy); ctx.stroke();
      ctx.fillStyle = '#555';
      ctx.fillText(noteName(g), L - 6, gy);
    }
    // x 刻度
    ctx.textAlign = 'center'; ctx.textBaseline = 'top';
    var xs = dur > 6.5 ? 2 : 1;
    for (var s = 0; s <= dur + 1e-6; s += xs) {
      var gx = L + (s / dur) * (W - L - R);
      ctx.fillStyle = '#777';
      ctx.fillText(String(Math.round(s * 10) / 10), gx, H - B + 6);
    }
    ctx.fillStyle = '#888';
    ctx.fillText('Time (s)', (L + W - R) / 2, H - B + 20);

    // 标题（各卡展示自己的统计；真假由玩家听，不写在脸上）
    ctx.textAlign = 'left'; ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = '#333';
    ctx.font = 'bold 15px "Segoe UI", sans-serif';
    ctx.fillText('#' + view.idxNo + ' · med=' + noteName(view.med[side]) +
                 ' · span=' + view.span[side].toFixed(1) + 'st', 12, 24);

    // 中位虚线
    ctx.setLineDash([7, 5]);
    ctx.strokeStyle = '#3a6ea5'; ctx.lineWidth = 1.4;
    ctx.beginPath(); ctx.moveTo(L, y(view.med[side])); ctx.lineTo(W - R, y(view.med[side])); ctx.stroke();

    // 曲线（null = 无声断口）
    ctx.setLineDash([]);
    ctx.strokeStyle = '#d4557a';
    ctx.lineWidth = 2.2;
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    ctx.beginPath();
    var pen = false;
    for (var i = 0; i < midi.length; i++) {
      var v = midi[i];
      if (v === null) { pen = false; continue; }
      if (!pen) { ctx.moveTo(x(i), y(v)); pen = true; } else ctx.lineTo(x(i), y(v));
    }
    ctx.stroke();

    // 播放头：卡面曲线窗口 ≡ 播放窗口的可见面
    var p = V.cardProgress(card, t);
    var hx = L + p * (W - L - R);
    ctx.strokeStyle = 'rgba(232,131,58,.9)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hx, T - 6); ctx.lineTo(hx, H - B); ctx.stroke();
    ctx.fillStyle = '#e8833a';
    ctx.beginPath();
    ctx.moveTo(hx - 5, T - 12); ctx.lineTo(hx + 5, T - 12); ctx.lineTo(hx, T - 4);
    ctx.closePath(); ctx.fill();
  }

  function makeView(idx) {
    var card = curves[idx];
    var decoyCurve = round[idx].decoy.curve;
    var all = card.midi.concat(decoyCurve).filter(function (v) { return v !== null; })
      .sort(function (a, b) { return a - b; });
    var lo = all[Math.floor(all.length * 0.02)] - 2;
    var hi = all[Math.floor(all.length * 0.98)] + 2;
    if (hi - lo < 6) { var m = (hi + lo) / 2; lo = m - 3; hi = m + 3; }
    var real = round[idx].side, other = real === 'L' ? 'R' : 'L';
    var sr = statOf(card.midi), sd = statOf(decoyCurve);
    var med = {}, span = {};
    med[real] = sr.med; span[real] = sr.span;
    med[other] = sd.med; span[other] = sd.span;
    return {
      lo: lo, hi: hi, decoyCurve: decoyCurve, idxNo: String(idx + 1).padStart(2, '0'),
      med: med, span: span,
    };
  }
  function statOf(midi) {
    var a = midi.filter(function (v) { return v !== null; }).sort(function (x, y) { return x - y; });
    return { med: V.median(a), span: a[Math.floor(a.length * 0.95)] - a[Math.floor(a.length * 0.05)] };
  }
  function noteName(m) {
    var r = Math.round(m);
    return NOTE_NAMES[((r % 12) + 12) % 12] + (Math.floor(r / 12) - 1);
  }

  function setBar(p, idx) {
    $('barfill').style.transform = 'scaleX(' + p + ')';
    $('barknob').style.left = 'calc(' + (p * 100) + '% - 3px)';
    if (idx >= 0) {
      var c = curves[idx];
      $('bar-left').textContent = '卡 ' + (idx + 1) + '/' + curves.length + ' · 窗口 ' + c.start.toFixed(1) + '–' + c.end.toFixed(1) + 's';
      $('bar-right').textContent = Math.max(0, c.end - songTime()).toFixed(1) + 's';
    } else {
      $('bar-left').textContent = state && state.dead ? '机体损毁' : '间奏 · 不出卡';
      $('bar-right').textContent = '';
    }
  }

  function showRest(t) {
    $('rest').classList.remove('hidden');
    var r1 = $('rest1'), r2 = $('rest2');
    if (state.dead) {
      r1.textContent = '机体损毁'; r1.className = 'r1 bad';
      r2.textContent = '曲子继续播放，稍后结算…';
      return;
    }
    r1.className = 'r1';
    var next = -1;
    for (var i = 0; i < curves.length; i++) if (curves[i].start > t) { next = i; break; }
    if (next < 0) { r1.textContent = '尾奏'; r2.textContent = '即将结算…'; return; }
    r1.textContent = t < curves[0].start ? '前奏' : '间奏';
    r2.textContent = '下一句 #' + (next + 1) + ' 在 ' + (curves[next].start - t).toFixed(1) + 's 后';
  }
  function hideRest() { $('rest').classList.add('hidden'); }
  function hidePair() {
    $('pair').classList.add('hidden');
    ['wrapL', 'wrapR'].forEach(function (id) { $(id).className = 'cardwrap'; });
  }

  function feedback(text, cls) {
    var fb = $('fb');
    fb.className = '';
    void fb.offsetWidth;
    fb.textContent = text;
    fb.className = 'show ' + cls;
  }
  function clearFeedback() { $('fb').className = ''; }
  function mark(id, cls) { $(id).classList.add(cls); }

  function updateHud() {
    var hearts = '';
    for (var i = 0; i < V.CFG.maxHp; i++) hearts += i < state.hp ? '♥' : '<span class="off">♥</span>';
    $('hp').innerHTML = hearts;
    $('score').textContent = state.score;
    if (state.combo >= 2) { $('combo').textContent = '连击 x' + state.combo; $('combo').classList.remove('hidden'); }
    else $('combo').classList.add('hidden');
  }

  // ================= 结算 =================
  function finishSong() {
    if (finished) return;
    finished = true;
    stopPlayback();
    var acc = V.accuracy(state);
    var rate = V.rating(state);
    var prev = readBest();
    // 败局不计战绩
    var counts = !state.dead;
    var isRecord = counts && (!prev || state.score > prev.score);
    if (isRecord) writeBest({ score: state.score, maxCombo: state.maxCombo, acc: acc, rating: rate, ts: Date.now() });

    $('end-title').textContent = state.dead ? '机体损毁' : '生还归来';
    var rt = $('rating');
    rt.textContent = rate;
    rt.className = state.dead ? 'lose' : ({ A: 'A', B: 'B', C: 'C' }[rate] || '');
    var bestScore = counts
      ? (isRecord ? state.score : prev.score)
      : (prev ? prev.score : null);
    var bestText = bestScore === null ? '—'
      : bestScore + (counts && isRecord && prev ? '（上次 ' + prev.score + '）' : '');
    var rows = [
      ['总分', state.score],
      ['最大连击', 'x' + state.maxCombo],
      ['正确率', state.correct + '/' + state.answered + '（' + (acc * 100).toFixed(1) + '%）'],
      ['历史最佳', bestText],
    ];
    $('end-stats').innerHTML = rows.map(function (r) {
      return '<div class="k">' + r[0] + '</div><div class="v">' + r[1] + '</div>';
    }).join('');
    $('newrecord').textContent = isRecord ? '★ 新纪录' : '';
    showScreen('screen-end');
    renderBestLine();
  }

  function readBest() {
    try { return JSON.parse(localStorage.getItem(BEST_KEY)); } catch (e) { return null; }
  }
  function writeBest(v) { try { localStorage.setItem(BEST_KEY, JSON.stringify(v)); } catch (e) { } }
  function renderBestLine() {
    var b = readBest();
    $('bestline').textContent = b
      ? '最佳战绩：' + b.rating + ' · ' + b.score + ' 分 · 连击 x' + b.maxCombo + ' · ' + (b.acc * 100).toFixed(1) + '%'
      : '尚无战绩——等大爷首杀';
  }

  // ================= 音频时钟 =================
  function startPlayback(offset) {
    stopPlayback();
    srcNode = ac.createBufferSource();
    srcNode.buffer = buffer;
    srcNode.connect(gain);
    anchorCtx = ac.currentTime;
    anchorSong = offset;
    playing = true;
    srcNode.start(0, Math.min(offset, buffer.duration - 0.01));
    srcNode.onended = function () {
      if (playing && !finished && songTime() >= buffer.duration - 0.25) finishSong();
    };
  }
  function stopPlayback() {
    playing = false;
    if (srcNode) {
      try { srcNode.onended = null; srcNode.stop(); } catch (e) { }
      try { srcNode.disconnect(); } catch (e) { }
      srcNode = null;
    }
  }
  function seek(t) {
    if (finished) return;
    startPlayback(Math.max(0, Math.min(t, buffer.duration - 0.05)));
  }
  function songTime() { return anchorSong + (ac.currentTime - anchorCtx); }

  // ================= 杂项 =================
  function showScreen(id) {
    ['screen-title', 'screen-game', 'screen-end'].forEach(function (s) {
      $(s).classList.toggle('hidden', s !== id);
    });
  }
  function toTitle() {
    finished = true;
    stopPlayback();
    runId++;
    renderBestLine();
    showScreen('screen-title');
  }
  function updateDbg(t, idx) {
    var s = 't=' + t.toFixed(3) + 's';
    if (idx >= 0) {
      var c = curves[idx];
      s += ' | #' + (idx + 1) + ' [' + c.start + ',' + c.end + ')s p=' +
           (V.cardProgress(c, t) * 100).toFixed(1) + '%';
      s += answered ? ' | 已答 真身=' + round[idx].side : ' | 真身=' + round[idx].side + '（调试可见）';
    } else s += ' | 无卡段';
    s += ' | hp=' + state.hp + ' score=' + state.score;
    $('dbg-read').textContent = s;
  }
})();
