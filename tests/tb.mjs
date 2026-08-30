#!/usr/bin/env node
// ============================================================
// tests/tb.mjs — V10b 听音辨序 功能测试台（Testbench）
// 用法:  node tests/tb.mjs          # 本地模式（起临时 HTTP 服务测当前文件）
//        node tests/tb.mjs --live   # 线上模式（测 GitHub Pages）
// 依赖:  零 npm 依赖，Node >= 21（用内置 WebSocket / fetch）
// ============================================================
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const LIVE = process.argv.includes('--live');
const LIVE_URL = 'https://foxxy777.github.io/music-games-demo/';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const log = (tag, name, detail = '') => console.log(`[${tag}] ${name}${detail ? '  | ' + detail : ''}`);

// ---------------- 测试框架 ----------------
let pass = 0, fail = 0;
const failures = [];
function check(name, cond, detail = '') {
  if (cond) { pass++; log('PASS', name); }
  else { fail++; failures.push(name + (detail ? ' | ' + detail : '')); log('FAIL', name, detail); }
}

// ---------------- 本地静态服务器 ----------------
const MIME = { '.html': 'text/html; charset=utf-8', '.wav': 'audio/wav', '.js': 'text/javascript', '.css': 'text/css', '.ico': 'image/x-icon' };
let server = null, PORT = 0;
async function startServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, 'http://x').pathname);
      let fp = path.join(ROOT, urlPath === '/' ? 'index.html' : urlPath);
      if (!fp.startsWith(ROOT)) { res.writeHead(403); res.end(); return; }
      fs.readFile(fp, (err, data) => {
        if (err) { res.writeHead(404); res.end('404'); return; }
        res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
        res.end(data);
      });
    });
    server.listen(0, '127.0.0.1', () => { PORT = server.address().port; resolve(); });
  });
}

// ---------------- CDP 客户端 ----------------
class CDP {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.listeners = []; }
  static async connect(url) {
    const ws = new WebSocket(url);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error('ws connect fail: ' + url)); });
    const c = new CDP(ws);
    ws.onmessage = (ev) => c._onmsg(JSON.parse(ev.data));
    return c;
  }
  _onmsg(m) {
    if (m.id && this.pending.has(m.id)) {
      const { res, rej } = this.pending.get(m.id); this.pending.delete(m.id);
      m.error ? rej(new Error(m.error.message)) : res(m.result);
    } else { this.listeners.forEach(l => l(m)); }
  }
  send(method, params = {}) {
    return new Promise((res, rej) => {
      const id = ++this.id; this.pending.set(id, { res, rej });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch {} }
}

// ---------------- 启动无头 Edge ----------------
const EDGE_CANDIDATES = [
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
];
async function launchHeadless(port) {
  const exe = EDGE_CANDIDATES.find(p => fs.existsSync(p));
  if (!exe) throw new Error('找不到 Edge/Chrome 可执行文件');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tb-edge-'));
  const proc = spawn(exe, [
    '--headless=new', `--remote-debugging-port=${port}`,
    `--user-data-dir=${tmp}`, '--no-first-run', '--no-default-browser-check',
    '--disable-gpu', '--disable-extensions', '--remote-allow-origins=*',
    'about:blank',
  ], { stdio: 'ignore' });
  const t0 = Date.now();
  while (Date.now() - t0 < 15000) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (r.ok) return { proc, tmp };
    } catch {}
    await sleep(300);
  }
  throw new Error('Edge 调试端口 15s 内未就绪');
}

// AudioContext 桩：在页面脚本执行前注入，让音频时序确定化（不依赖声卡）
const AUDIO_STUB = `(() => {
  const mkBuf = (dur) => ({ duration: dur });
  const fakeNode = () => ({ buffer: null, connect(x) { return x; },
    start() { if (this.onended) setTimeout(() => this.onended && this.onended(), 10); },
    stop()  { if (this.onended) setTimeout(() => this.onended && this.onended(), 1); } });
  class FakeAC {
    constructor() { this.state = 'running'; this.currentTime = 0; this.destination = {}; }
    resume() { return Promise.resolve(); }
    createBuffer() { return mkBuf(0); }
    createBufferSource() { return fakeNode(); }
    createGain() { const n = fakeNode(); n.gain = { value: 1 }; return n; }
    decodeAudioData() { return Promise.resolve(mkBuf(0.25)); } // 短时长加速 TB
  }
  window.AudioContext = FakeAC;
  window.webkitAudioContext = FakeAC;
})();`;

// ---------------- 主流程 ----------------
let cdp = null, edgeProc = null, edgeTmp = null, pageErrors = [], consoleLogs = [];
const CDP_PORT = 9333;
const ev = async (expression) => {
  const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval 异常: ' + JSON.stringify(r.exceptionDetails).slice(0, 300) + ' <<< ' + expression.slice(0, 120));
  return r.result.value;
};
async function waitFor(expression, want, timeout = 10000, label = '') {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    let v; try { v = await ev(expression); } catch { v = undefined; }
    if (v === want) return true;
    await sleep(150);
  }
  return false;
}
const NOTES = ['4C', '4Cs', '4D', '4Ds', '4E', '4F', '4Fs', '4G', '4Gs', '4A', '4As', '4B'];
const NAMES = ['Do', 'Do♯', 'Re', 'Re♯', 'Mi', 'Fa', 'Fa♯', 'Sol', 'Sol♯', 'La', 'La♯', 'Si'];
const HUES = [0, 267, 55, 310, 203, 352, 246, 32, 288, 128, 331, 225];

async function main() {
  const BASE = LIVE ? LIVE_URL : `http://127.0.0.1:${PORT}/`;
  console.log(`\n=== V10b TB | 模式: ${LIVE ? 'LIVE' : 'LOCAL'} | 目标: ${BASE} ===\n`);

  // --- 启动浏览器，先挂桩再导航（抓全程 JS 错误）---
  ({ proc: edgeProc, tmp: edgeTmp } = await launchHeadless(CDP_PORT));
  const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json();
  const page = targets.find(t => t.type === 'page');
  cdp = await CDP.connect(page.webSocketDebuggerUrl);
  cdp.on(m => {
    if (m.method === 'Runtime.exceptionThrown') pageErrors.push('exception: ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '?'));
    if (m.method === 'Runtime.consoleAPICalled') {
      const text = (m.params.args || []).map(a => a.value ?? a.description ?? '').join(' ');
      if (m.params.type === 'error') pageErrors.push('console.error: ' + text);
      else consoleLogs.push(text);
    }
    if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') pageErrors.push('log: ' + m.params.entry.text + (m.params.entry.url ? ' url=' + m.params.entry.url : ''));
  });
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable');
  await cdp.send('Page.enable');
  await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: AUDIO_STUB });
  const loaded = new Promise(r => cdp.on(m => { if (m.method === 'Page.loadEventFired') r(); }));
  await cdp.send('Page.navigate', { url: BASE });
  await Promise.race([loaded, sleep(15000)]);

  // ===== T1 键盘渲染 =====
  const kb = await ev(`JSON.stringify((() => {
    const ks = [...document.querySelectorAll('.note-bar')];
    return { n: ks.length,
      notes: ks.map(k => k.dataset.note),
      names: ks.map(k => k.querySelector('.nb-name').textContent),
      hues: ks.map(k => k.style.getPropertyValue('--hue')) };
  })())`).then(JSON.parse);
  check('T1 十二键渲染', kb.n === 12, `n=${kb.n}`);
  check('T1 键序 Do→Si(含升号)', JSON.stringify(kb.notes) === JSON.stringify(NOTES), kb.notes.join(','));
  check('T1 唱名正确', JSON.stringify(kb.names) === JSON.stringify(NAMES), kb.names.join(','));
  check('T1 斯克里亚宾色相', JSON.stringify(kb.hues.map(Number)) === JSON.stringify(HUES), kb.hues.join(','));

  // ===== T2 音频资产（RIFF/WAVE 结构校验，防错素材混入）=====
  let t2ok = true, t2detail = [];
  for (const label of NOTES) {
    for (const kind of ['question', 'answer']) {
      const url = BASE + 'assets/audio/' + (kind === 'question' ? 'question_' : '') + label + '.wav';
      try {
        const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
        const b = Buffer.from(await r.arrayBuffer());
        const ok = r.status === 200 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WAVE' && b.length > 20000;
        if (!ok) { t2ok = false; t2detail.push(`${kind}_${label}:${r.status},${b.length}B`); }
      } catch (e) { t2ok = false; t2detail.push(`${kind}_${label}:fetch-fail`); }
    }
  }
  check('T2 音频资产 24/24 RIFF/WAVE', t2ok, t2detail.join(' '));

  // ===== T3 开局状态机 =====
  await ev(`document.querySelector('.start-btn').click()`);
  const T3_WAIT = LIVE ? 180000 : 18000; // 14 音题目节拍版出题 ~10.5s，live 网络更慢
  check('T3 进入听音态', await waitFor('gameState', 'listening', T3_WAIT));
  check('T3 转入作答态', await waitFor('gameState', 'repeating', T3_WAIT));
  const seq1 = await ev(`JSON.stringify(currentSequence)`).then(JSON.parse);
  check('T3 题长=14(小星星)', seq1.length === 14, JSON.stringify(seq1));
  check('T3 进度点数=14', (await ev(`document.getElementById('clickSeq').children.length`)) === 14);
  check('T3 音频加载日志', consoleLogs.some(l => l.includes('Audio loaded: 24 / 24')), consoleLogs.find(l => l.includes('Audio loaded')) || '未见加载日志');

  // ===== T4 答对流程 =====
  for (const n of seq1) await ev(`document.querySelector('.note-bar[data-note="${n}"]').click()`);
  check('T4 按满解锁交卷', await ev(`!document.getElementById('btnSubmit').disabled`));
  await ev(`submitAnswer()`);
  check('T4 得分100', (await ev(`score`)) === 100, `score=${await ev('score')}`);
  check('T4 连击+1', (await ev(`combo`)) === 1);
  check('T4 判定=正确', (await ev(`document.getElementById('judgeText').className`)).includes('correct'));
  check('T4 下一轮按钮出现', await waitFor(`document.getElementById('btnNext').style.display !== 'none'`, true, 4000));

  // ===== T5 答错流程 =====
  await ev(`nextRound()`);
  check('T5 下一轮回听音态', await waitFor('gameState', 'listening', 8000) || await waitFor('gameState', 'repeating', 8000));
  await waitFor('gameState', 'repeating', 16000);
  const seq2 = await ev(`JSON.stringify(currentSequence)`).then(JSON.parse);
  const wrongFirst = NOTES.find(n => n !== seq2[0]);
  for (const n of [wrongFirst, ...seq2.slice(1)]) await ev(`document.querySelector('.note-bar[data-note="${n}"]').click()`);
  await ev(`submitAnswer()`);
  check('T5 连击清零', (await ev(`combo`)) === 0);
  check('T5 判定=错误', (await ev(`document.getElementById('judgeText').className`)).includes('wrong'));
  check('T5 状态栏给正确答案', await waitFor(`document.getElementById('stateBar').textContent.includes('正确答案')`, true, 5000));

  // ===== T6 撤销/清空/重听回归（08-24 修复项）=====
  await ev(`nextRound()`);
  await waitFor('gameState', 'repeating', 16000);
  const seq3 = await ev(`JSON.stringify(currentSequence)`).then(JSON.parse);
  await ev(`document.querySelector('.note-bar[data-note="${seq3[0]}"]').click()`);
  await ev(`undoPick()`);
  const t6a = await ev(`JSON.stringify({ len: playerSequence.length, undoDis: document.getElementById('btnUndo').disabled, subDis: document.getElementById('btnSubmit').disabled })`).then(JSON.parse);
  check('T6 撤销清空', t6a.len === 0 && t6a.undoDis === true && t6a.subDis === true, JSON.stringify(t6a));
  await ev(`document.querySelector('.note-bar[data-note="${seq3[0]}"]').click()`);
  await ev(`document.querySelector('.note-bar[data-note="${seq3[1]}"]').click()`);
  await ev(`replayQuestion()`);
  await waitFor('gameState', 'repeating', 16000);
  const t6b = await ev(`JSON.stringify(playerSequence)`).then(JSON.parse);
  check('T6 重听不清答案', JSON.stringify(t6b) === JSON.stringify([seq3[0], seq3[1]]), JSON.stringify(t6b));
  await ev(`replayMyAnswer()`);
  const t6c = await ev(`JSON.stringify({ state: gameState, len: playerSequence.length })`).then(JSON.parse);
  check('T6 回放答案不影响作答', t6c.state === 'repeating' && t6c.len === 2, JSON.stringify(t6c));

  // ===== T9 回放防叠加（08-26 大爷反馈：回放中再点=停止；点琴键=打断）=====
  await ev(`window._stopCalls = 0; const _origStop = stopAllSounds; stopAllSounds = function(){ window._stopCalls++; return _origStop.apply(this, arguments); }`);
  await ev(`stopAnswerReplay()`);
  await ev(`replayMyAnswer()`);
  const t9a = await ev(`JSON.stringify({ playing: answerPlaying, txt: document.getElementById('btnMyAnswer').textContent })`).then(JSON.parse);
  check('T9 回放中标记+按钮变停止', t9a.playing === true && t9a.txt.includes('停止'), JSON.stringify(t9a));
  await ev(`replayMyAnswer()`);
  await sleep(50);
  const t9b = await ev(`JSON.stringify({ playing: answerPlaying, txt: document.getElementById('btnMyAnswer').textContent, stopCalls: window._stopCalls })`).then(JSON.parse);
  check('T9 再点一次=停止不叠加', t9b.playing === false && t9b.txt.includes('播我的答案') && t9b.stopCalls >= 1, JSON.stringify(t9b));
  await ev(`replayMyAnswer()`);
  await ev(`document.querySelector('.note-bar[data-note="${seq3[0]}"]').click()`);
  await sleep(50);
  const t9c = await ev(`JSON.stringify({ playing: answerPlaying, stopCalls: window._stopCalls })`).then(JSON.parse);
  check('T9 点琴键打断回放', t9c.playing === false && t9c.stopCalls >= 2, JSON.stringify(t9c));
  await ev(`flashNote = null; renderNoteStates(); stopAllSounds = _origStop;`); // 清 tapped 动画，避免污染 T7 布局测量
  await sleep(400);

  // ===== T10 听题中点琴键=停止一切并转作答（08-26 22:00 拍板）=====
  await ev(`window._stopCalls = 0; const _o = stopAllSounds; stopAllSounds = function(){ window._stopCalls++; return _o.apply(this, arguments); }`);
  await ev(`replayQuestion()`);
  const t10a = await ev(`JSON.stringify({ state: gameState })`).then(JSON.parse);
  check('T10 重听进入listening', t10a.state === 'listening', JSON.stringify(t10a));
  await ev(`document.querySelector('.note-bar[data-note="${seq3[0]}"]').click()`);
  await sleep(50);
  const t10b = await ev(`JSON.stringify({ state: gameState, len: playerSequence.length, stopCalls: window._stopCalls, subDis: document.getElementById('btnSubmit').disabled })`).then(JSON.parse);
  check('T10 听题中点键=停音转作答', t10b.state === 'repeating' && t10b.len === 4 && t10b.stopCalls >= 1, JSON.stringify(t10b)); // 14音时代打断点击也入列(3+1)
  // 半答保留：清空→按2个→重听→点键，已按不丢且新键记为第三笔
  await ev(`clearPicks()`);
  await ev(`document.querySelector('.note-bar[data-note="${seq3[0]}"]').click()`);
  await ev(`document.querySelector('.note-bar[data-note="${seq3[1]}"]').click()`);
  await ev(`replayQuestion()`);
  await ev(`document.querySelector('.note-bar[data-note="${seq3[2]}"]').click()`);
  await sleep(50);
  const t10c = await ev(`JSON.stringify({ state: gameState, len: playerSequence.length, subDis: document.getElementById('btnSubmit').disabled })`).then(JSON.parse);
  check('T10 打断保留已按答案', t10c.state === 'repeating' && t10c.len === 3, JSON.stringify(t10c));
  await ev(`stopAllSounds = _o; flashNote = null; renderNoteStates();`);
  await sleep(400);

  // ===== T11 连点单声部：新点键音掐旧点键音（08-26 22:17 拍板）=====
  await ev(`nextRound()`);
  // 08-30 修复：必须先等 listening（新一轮出题真的开始）再等 repeating；
  // 否则会吃到上一轮残留的 repeating 态立即通过，本轮 playSequence 在 500ms 后才杀出，
  // 曾把 T13 的谱面演示按互斥规则掐死（T13 五连挂的真凶）
  await waitFor('gameState', 'listening', 8000);
  await waitFor('gameState', 'repeating', 16000);
  await ev(`document.querySelector('.note-bar[data-note="4C"]').click()`);
  await ev(`window._tap1 = lastTapSrc; window._tap1Stopped = false; _tap1.stop = function(){ window._tap1Stopped = true; };`);
  await ev(`document.querySelector('.note-bar[data-note="4E"]').click()`);
  await sleep(50);
  const t11 = await ev(`JSON.stringify({ stopped: window._tap1Stopped, different: lastTapSrc !== window._tap1, len: playerSequence.length })`).then(JSON.parse);
  check('T11 连点时旧点键音被掐掉', t11.stopped === true && t11.different === true && t11.len === 2, JSON.stringify(t11));
  await ev(`flashNote = null; renderNoteStates();`);
  await sleep(400);

    // ===== T12 谱面展示渲染（08-30 二改：五线谱版）=====
  const sc = await ev(`JSON.stringify((() => {
    const cells = [...document.querySelectorAll('.sn')];
    return { svgs: document.querySelectorAll('.stave-row').length,
      lines: document.querySelectorAll('.stave-line').length,
      clef: !!document.querySelector('.clef'),
      n: cells.length,
      notes: cells.map(c => c.dataset.note),
      halves: document.querySelectorAll('.sn.half').length,
      ledgers: document.querySelectorAll('.ledger').length,
      lyrics: [...document.querySelectorAll('.sn-lyric')].map(l => l.textContent),
      btn: !!document.getElementById('btnScore') };
  })())`).then(JSON.parse);
  const SC_NOTES = ['4C','4C','4G','4G','4A','4A','4G','4F','4F','4E','4E','4D','4D','4C'];
  check('T12 五线谱两行谱表+谱号', sc.svgs === 2 && sc.lines === 10 && sc.clef === true, `svgs=${sc.svgs} lines=${sc.lines} clef=${sc.clef}`);
  check('T12 谱面14音渲染', sc.n === 14, `n=${sc.n}`);
  check('T12 音符序列=题库#89', JSON.stringify(sc.notes) === JSON.stringify(SC_NOTES), sc.notes.join(','));
  check('T12 二分音符与下加线', sc.halves === 2 && sc.ledgers === 3, `half=${sc.halves} ledger=${sc.ledgers}`); // 下加线×3 = 开头两个 4C + 结尾二分 4C
  check('T12 歌词两句完整', sc.lyrics.join('') === '一闪一闪亮晶晶满天都是小星星', sc.lyrics.join(''));
  check('T12 播放按钮存在', sc.btn === true);

  // ===== T13 跟谱播放联动（逐音高亮/再点停止/点键打断）=====
  await ev(`toggleScoreDemo()`);
  check('T13 播放态开启', await waitFor('scorePlaying', true, 3000));
  check('T13 首音高亮=4C', await waitFor(`document.querySelector('.sn.active')?.dataset.note`, '4C', 3000));
  check('T13 底部琴键同步亮', await waitFor(`document.querySelector('.note-bar.score-lit')?.dataset.note`, '4C', 2000));
  check('T13 高亮逐音推进', await waitFor(`[...document.querySelectorAll('.sn')].findIndex(c => c.classList.contains('active')) >= 1`, true, 3000));
  await ev(`toggleScoreDemo()`);
  check('T13 再点=停止', await waitFor('scorePlaying', false, 2000));
  check('T13 停止清高亮', await ev(`document.querySelectorAll('.sn.active').length === 0 && document.querySelectorAll('.note-bar.score-lit').length === 0`) === true);
  await ev(`toggleScoreDemo()`);
  await waitFor('scorePlaying', true, 2000);
  await ev(`document.querySelector('.note-bar[data-note="4E"]').click()`);
  await sleep(150);
  check('T13 点琴键打断演示', (await ev(`scorePlaying`)) === false && (await ev(`document.querySelectorAll('.sn.active').length`)) === 0);
  await ev(`flashNote = null; renderNoteStates();`);
  await sleep(400);

  // ===== T7 桌面布局不变量（1280x720）=====
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false });
  await sleep(200);
  const L = await ev(`JSON.stringify((() => {
    const st = document.getElementById('stage').getBoundingClientRect();
    const ks = [...document.querySelectorAll('.note-bar')].map(b => b.getBoundingClientRect());
    const main = document.querySelector('.main-area').getBoundingClientRect();
    return { aspect: st.width / st.height, ws: ks.map(r => Math.round(r.width)),
      rowW: ks[ks.length - 1].right - ks[0].left, stageW: st.width,
      mainH: main.height, stageH: st.height };
  })())`).then(JSON.parse);
  check('T7 舞台16:9', Math.abs(L.aspect - 16 / 9) < 0.02, `aspect=${L.aspect}`);
  check('T7 十二键等宽', Math.max(...L.ws) - Math.min(...L.ws) <= 2, L.ws.join(','));
  check('T7 键排占满行宽', L.rowW / L.stageW >= 0.95, `${(L.rowW / L.stageW * 100).toFixed(1)}%`);
  check('T7 图片区≥50%高', L.mainH / L.stageH >= 0.5, `${(L.mainH / L.stageH * 100).toFixed(1)}%`);

  // ===== T8 手机视口（888x444）=====
  await cdp.send('Emulation.setDeviceMetricsOverride', { width: 888, height: 444, deviceScaleFactor: 2, mobile: true });
  await sleep(200);
  const M = await ev(`JSON.stringify((() => {
    const st = document.getElementById('stage').getBoundingClientRect();
    const ks = [...document.querySelectorAll('.note-bar')].map(b => b.getBoundingClientRect());
    return { st, minKeyW: Math.min(...ks.map(r => r.width)), minKeyH: Math.min(...ks.map(r => r.height)) };
  })())`).then(JSON.parse);
  check('T8 缩放不出界', M.st.left >= -1 && M.st.right <= 889 && M.st.top >= -1 && M.st.bottom <= 445,
    `l=${M.st.left.toFixed(0)} r=${M.st.right.toFixed(0)} t=${M.st.top.toFixed(0)} b=${M.st.bottom.toFixed(0)}`);
  check('T8 键可点(≥40px)', M.minKeyW >= 40 && M.minKeyH >= 40, `w=${M.minKeyW.toFixed(0)} h=${M.minKeyH.toFixed(0)}`);

  // ===== T0 无 JS 报错（最后收口）=====
  // 环境噪音不算错：favicon 404（本地服务器无 ico）、无头模式无用户手势时 vibrate 被浏览器拦截的提示（真机上正常，且游戏已 try/catch）
  const realErrors = pageErrors.filter(e => !e.includes('favicon') && !e.includes('navigator.vibrate') && !e.includes('chromestatus.com'));
  check('T0 全程无JS报错', realErrors.length === 0, realErrors.slice(0, 3).join(' ;; '));
}

// ---------------- 收尾 ----------------
try {
  if (!LIVE) await startServer();
  await main();
} catch (e) {
  fail++;
  failures.push('TB 异常中断: ' + e.message);
  console.error('[FATAL]', e);
} finally {
  try { if (cdp) await cdp.send('Browser.close'); } catch {}
  try { edgeProc?.kill(); } catch {}
  cdp?.close();
  if (edgeTmp) { setTimeout(() => { try { fs.rmSync(edgeTmp, { recursive: true, force: true }); } catch {} }, 500); }
  server?.close();
}
console.log(`\n=== TB 结果: ${pass} PASS / ${fail} FAIL ===`);
if (failures.length) { console.log('失败项:'); failures.forEach(f => console.log('  ✗ ' + f)); }
process.exit(fail ? 1 : 0);
