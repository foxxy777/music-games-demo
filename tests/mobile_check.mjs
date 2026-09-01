// 鍏ㄦí灞忕増绉诲姩绔獙璇侊細绔栧睆鈫掓棆杞伄缃╋紱妯睆鎵嬫満(瑙﹀睆)鈫掓í鐗堝竷灞€+涓ゆ寮忓嚭鐗岋紱妗岄潰鈫掑崟鍑荤洿鍑?import fs from 'fs';

const OUT = 'E:/git_repo/music-games-demo/tests/';
const URL = 'http://127.0.0.1:8117/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let tabs = await (await fetch('http://127.0.0.1:18802/json')).json();
let page = tabs.find(t => t.type === 'page' && t.url.includes('127.0.0.1:8117'));
if (!page) {
  const ver = await (await fetch('http://127.0.0.1:18802/json/version')).json();
  const bws = new WebSocket(ver.webSocketDebuggerUrl);
  await new Promise((r, j) => { bws.onopen = r; bws.onerror = j; });
  const tid = await new Promise((res, rej) => {
    bws.onmessage = e => { const m = JSON.parse(e.data); if (m.id === 1) { m.error ? rej(new Error(m.error.message)) : res(m.result.targetId); } };
    bws.send(JSON.stringify({ id: 1, method: 'Target.createTarget', params: { url: 'about:blank', background: true } }));
  });
  bws.close();
  await sleep(800);
  tabs = await (await fetch('http://127.0.0.1:18802/json')).json();
  page = tabs.find(t => t.id === tid);
}
if (!page) { console.log('FAIL no test tab'); process.exit(1); }

const ws = new WebSocket(page.webSocketDebuggerUrl);
let mid = 0; const pending = new Map(); const jsErrs = [];
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++mid; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') jsErrs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails).slice(0, 300));
  else if (m.method === 'Page.screencastFrame') send('Page.screencastFrameAck', { sessionId: m.params?.sessionId }).catch(() => {});
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.bringToFront');
const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + 'shot_m_' + name + '.png', Buffer.from(r.data, 'base64'));
  console.log('shot saved: m_' + name);
}
const log = [];
const check = (name, cond, extra) => log.push((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : ''));

// ---- 1. 鎵嬫満绔栧睆 鈫?鏃嬭浆閬僵 ----
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: URL });
await sleep(1200);
await send('Page.startScreencast', { format: 'jpeg', quality: 40, maxWidth: 640, maxHeight: 640, everyNthFrame: 2 });
await sleep(1200);
let st = await ev(`(function(){
  const mask=document.getElementById('rotateMask');
  return { maskShown: mask.classList.contains('show'),
    maskVisible: getComputedStyle(mask).display !== 'none',
    stageHidden: document.getElementById('stage').style.visibility === 'hidden',
    maskText: mask.textContent.slice(0,20) }; })()`);
check('绔栧睆鈫掓棆杞伄缃╂樉绀?, st.maskShown && st.maskVisible, st);
check('绔栧睆鈫掕垶鍙伴殣钘?, st.stageHidden === true, st);
await shot('01_rotate_mask');

// ---- 2. 妯睆鎵嬫満锛堣Е灞忔ā鎷燂級鈫?妯増甯冨眬 ----
await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
await ev(`location.reload()`);
await sleep(1800);
st = await ev(`(function(){
  const mask=document.getElementById('rotateMask'), stage=document.getElementById('stage');
  const r=stage.getBoundingClientRect();
  return { maskShown: mask.classList.contains('show'), touch: window.__touch,
    stageVisible: stage.style.visibility !== 'hidden',
    stageW: Math.round(r.width), stageH: Math.round(r.height),
    hand: window.__game.hand.length }; })()`);
check('妯睆鈫掗伄缃╂秷澶?, st.maskShown === false, st);
check('瑙﹀睆妯″紡璇嗗埆', st.touch === true, st);
check('鑸炲彴绛夋瘮閾烘弧(楂樻拺婊?瀹藉睆榛戣竟姝ｅ父)', Math.abs(st.stageH - 390) <= 4 && st.stageW <= 848 && Math.abs(st.stageW - st.stageH * 1920 / 1080) <= 6, st);
await shot('02_landscape_phone');

// ---- 3. 瑙﹀睆涓ゆ寮忓嚭鐗?----
let sel = await ev(`(function(){ const S=window.__game;
  const notes=['do','re','mi','fa','sol','la','si'];
  const i=S.hand.findIndex(c=>notes.includes(c)); if(i<0) return {err:'no note'};
  document.querySelectorAll('#hand .card')[i].click();
  return { selected: document.querySelectorAll('#hand .card.selected').length,
    previewShown: document.getElementById('cardPreview').classList.contains('show'),
    previewText: document.getElementById('cardPreview').textContent.slice(0,50),
    blocks: S.blocks.length, energy: S.energy }; })()`);
check('绗?鍑?閫変腑+璇存槑(涓嶅嚭鐗?', sel && !sel.err && sel.selected === 1 && sel.previewShown === true && sel.blocks === 0 && sel.energy === 3, sel);
await shot('03_tap_selected');

let play = await ev(`(function(){ const S=window.__game;
  document.querySelectorAll('#hand .card.selected')[0].click();
  return { energy: S.energy, blocks: S.blocks.length,
    stillSelected: document.querySelectorAll('#hand .card.selected').length }; })()`);
check('绗?鍑?鎵撳嚭闊冲潡', play.energy === 2 && play.blocks === 1 && play.stillSelected === 0, play);

let desel = await ev(`(function(){ const S=window.__game;
  const notes=['do','re','mi','fa','sol','la','si'];
  const i=S.hand.findIndex(c=>notes.includes(c)); if(i<0) return {skip:true};
  document.querySelectorAll('#hand .card')[i].click();
  document.getElementById('lanes').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
  return { selected: document.querySelectorAll('#hand .card.selected').length,
    previewShown: document.getElementById('cardPreview').classList.contains('show') }; })()`);
check('鐐归煶杞?鍙栨秷閫変腑', desel.skip === true || (desel.selected === 0 && desel.previewShown === false), desel);

// ---- 4. 绗?灏忚妭钃勫姏鈫掔2灏忚妭鏁屾柟璧烽 ----
await ev(`document.getElementById('endTurnBtn').click()`);
st = await ev(`(function(){ return new Promise(res=>{ const t0=Date.now();
  const iv=setInterval(()=>{ const S=window.__game;
    if(S.phase==='play'||Date.now()-t0>15000){ clearInterval(iv); res({phase:S.phase,turn:S.turn}); } },200); }); })()`);
check('绗?灏忚妭缁撶畻鈫掔2灏忚妭', st.phase === 'play' && st.turn === 2, st);
await ev(`document.getElementById('endTurnBtn').click()`);
await sleep(2200);
st = await ev(`(function(){ const S=window.__game;
  const btn=document.getElementById('endTurnBtn').getBoundingClientRect();
  return { phase:S.phase, eblk:S.blocks.filter(b=>b.side==='e').length,
    btnH:Math.round(btn.height) }; })()`);
check('绗?灏忚妭鏁屾柟璧烽(妯睆鎵嬫満)', st.phase === 'resolve' && st.eblk >= 1, st);
await shot('04_enemy_flying');
st = await ev(`(function(){ return new Promise(res=>{ const t0=Date.now();
  const iv=setInterval(()=>{ const S=window.__game;
    if(S.phase==='play'||S.phase==='over'||Date.now()-t0>20000){ clearInterval(iv); res({phase:S.phase,turn:S.turn}); } },300); }); })()`);
check('妯睆鎵嬫満瀹屾暣缁撶畻', st.phase === 'play' || st.phase === 'over', st);

// ---- 5. 婊″憳鎵嬬墝涓嶆孩鍑?----
await ev(`(function(){ const S=window.__game; if(S.phase!=='play')S.phase='play'; S.energy=9;
  while(S.hand.length<10) S.hand.push('do');
  window.__api.playCard(0); return S.hand.length; })()`);
await sleep(400);
let hand = await ev(`(function(){ const cards=[...document.querySelectorAll('#hand .card')];
  const vw=innerWidth;
  const bad=cards.some(c=>{ const r=c.getBoundingClientRect(); return r.left<-6 || r.right>vw+6; });
  return { n:cards.length, overflow:bad, vw }; })()`);
check('9寮犳墜鐗屼笉瓒呭睆', hand.n === 9 && hand.overflow === false, hand);
await shot('05_fullhand_landscape');

// ---- 6. 妗岄潰锛堟棤瑙﹀睆锛夆啋 鍗曞嚮鐩村嚭 ----
await send('Emulation.clearDeviceMetricsOverride');
await send('Emulation.setTouchEmulationEnabled', { enabled: false });
await ev(`location.reload()`);
await sleep(1500);
let desk = await ev(`(function(){ const S=window.__game;
  const notes=['do','re','mi','fa','sol','la','si'];
  const i=S.hand.findIndex(c=>notes.includes(c)); if(i<0) return {err:'no note'};
  document.querySelectorAll('#hand .card')[i].click();
  return { touch: window.__touch, blocks:S.blocks.length, energy:S.energy,
    selected: document.querySelectorAll('#hand .card.selected').length,
    maskShown: document.getElementById('rotateMask').classList.contains('show') }; })()`);
check('妗岄潰闈炶Е灞忔ā寮?, desk.touch === false, desk);
check('妗岄潰鍗曞嚮鐩村嚭(鏃犱袱娈靛紡)', desk.blocks === 1 && desk.energy === 2 && desk.selected === 0, desk);

console.log('\n===== 缁撴灉 =====');
log.forEach(l => console.log(l));
console.log('js寮傚父:', jsErrs.length ? jsErrs : '鏃?);
ws.close(); process.exit(log.some(l => l.startsWith('FAIL')) || jsErrs.length ? 1 : 0);
