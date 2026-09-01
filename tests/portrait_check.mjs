// 竖屏手机适配验证：CDP 模拟 390×844 视口 → 截图 + 两段式出牌实测
import fs from 'fs';

const OUT = 'E:/git_repo/music-games-demo/tests/';
const URL = 'http://127.0.0.1:8117/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

let tabs = await (await fetch('http://127.0.0.1:18802/json')).json();
let page = tabs.find(t => t.type === 'page' && t.url.includes('127.0.0.1:8117'));
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

// ---- 1. 模拟 iPhone 视口（竖屏）----
await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
await send('Page.navigate', { url: URL });
await sleep(1000);
await send('Page.startScreencast', { format: 'jpeg', quality: 40, maxWidth: 480, maxHeight: 1040, everyNthFrame: 2 });
await sleep(1500);

let st = await ev(`(function(){
  const stage=document.getElementById('stage');
  const r=stage.getBoundingClientRect();
  return { portrait: stage.classList.contains('portrait'),
    vw: innerWidth, vh: innerHeight,
    stageW: Math.round(r.width), stageH: Math.round(r.height) }; })()`);
check('竖屏自动切换 portrait 布局', st.portrait === true, st);
check('舞台铺满整屏(宽高≈视口)', st.stageW >= st.vw - 4 && Math.abs(st.stageH - st.vh) <= 4, st);
await shot('01_portrait_initial');

// ---- 2. 两段式出牌：第一次点击=选中+预览 ----
let sel = await ev(`(function(){ const S=window.__game;
  const notes=['do','re','mi','fa','sol','la','si'];
  const i=S.hand.findIndex(c=>notes.includes(c)); if(i<0) return {err:'no note card'};
  document.querySelectorAll('#hand .card')[i].click();
  return { i, selected: document.querySelectorAll('#hand .card.selected').length,
    previewShown: document.getElementById('cardPreview').classList.contains('show'),
    previewText: document.getElementById('cardPreview').textContent.slice(0,60),
    blocks: S.blocks.length }; })()`);
check('第1击=选中+说明预览(不出牌)', sel && !sel.err && sel.selected === 1 && sel.previewShown === true && sel.blocks === 0, sel);
await shot('02_portrait_selected');

// ---- 3. 第二次点击同一张=打出 ----
let play = await ev(`(function(){ const S=window.__game;
  const before=S.energy;
  document.querySelectorAll('#hand .card.selected')[0].click();
  return { energy: S.energy, before, blocks: S.blocks.length,
    stillSelected: document.querySelectorAll('#hand .card.selected').length }; })()`);
check('第2击=打出音块', play.energy === play.before - 1 && play.blocks === 1 && play.stillSelected === 0, play);
await sleep(400);
await shot('03_portrait_played');

// ---- 4. 点音轨区=取消选中 ----
let desel = await ev(`(function(){ const S=window.__game;
  const notes=['do','re','mi','fa','sol','la','si'];
  const i=S.hand.findIndex(c=>notes.includes(c)); if(i<0) return {skip:true};
  document.querySelectorAll('#hand .card')[i].click(); // 选中
  document.getElementById('lanes').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}));
  return { selected: document.querySelectorAll('#hand .card.selected').length,
    previewShown: document.getElementById('cardPreview').classList.contains('show') }; })()`);
check('点音轨区=取消选中', desel.skip === true || (desel.selected === 0 && desel.previewShown === false), desel);

// ---- 5. 第1小节蓄力结算 → 第2小节结束时敌方起飞（竖屏） ----
await ev(`document.getElementById('endTurnBtn').click()`);
st = await ev(`(function(){ return new Promise(res=>{ const t0=Date.now();
  const iv=setInterval(()=>{ const S=window.__game;
    if(S.phase==='play'||Date.now()-t0>15000){ clearInterval(iv); res({phase:S.phase,turn:S.turn}); } },200); }); })()`);
check('竖屏第1小节结算→第2小节', st.phase === 'play' && st.turn === 2, st);
await ev(`document.getElementById('endTurnBtn').click()`); // 第2小节 do/re/mi 起飞
await sleep(2200);
st = await ev(`(function(){ const S=window.__game;
  const btn=document.getElementById('endTurnBtn').getBoundingClientRect();
  return { phase:S.phase, eblk:S.blocks.filter(b=>b.side==='e').length,
    btnW:Math.round(btn.width), btnH:Math.round(btn.height), btnY:Math.round(btn.top) }; })()`);
check('结束小节→敌方起飞(竖屏)', st.phase === 'resolve' && st.eblk >= 1, st);
check('按钮触摸目标≥40px高', st.btnH >= 40, st);
await shot('04_portrait_enemy');

// ---- 6. 等结算回 play ----
st = await ev(`(function(){ return new Promise(res=>{ const t0=Date.now();
  const iv=setInterval(()=>{ const S=window.__game;
    if(S.phase==='play'||S.phase==='over'||Date.now()-t0>20000){ clearInterval(iv); res({phase:S.phase,turn:S.turn}); } },300); }); })()`);
check('竖屏完整结算回play', st.phase === 'play' || st.phase === 'over', st);
await shot('05_portrait_nextbar');

// ---- 7. 手牌 10 张满员时的叠压 ----
await ev(`(function(){ const S=window.__game; S.energy=9;
  while(S.hand.length<10) S.hand.push('do');
  if(S.phase!=='play'){S.phase='play';}
  // 触发重渲染
  window.__api.playCard && (function(){ const el=document.querySelector('#hand'); })();
  // 直接调用内部渲染：通过 drawCards 兜底不行，手动触发 renderHand —— 用隐藏 API：再 draw 一张 0 张牌不会重渲染
  // 简单办法：改 hand 后点一次出牌会 renderHand，但会少一张。改为：塞满 10 张后出 1 张（renderHand 后剩 9）
  const notes=['do','re','mi','fa','sol','la','si'];
  const i=S.hand.findIndex(c=>notes.includes(c));
  document.querySelectorAll('#hand .card')[i].click(); // 第1击选中(竖屏)
  document.querySelectorAll('#hand .card.selected')[0].click(); // 第2击打出
  return {hand:S.hand.length}; })()`);
await sleep(300);
let hand = await ev(`(function(){ const cards=[...document.querySelectorAll('#hand .card')];
  const stage=document.getElementById('stage').getBoundingClientRect();
  const xs=cards.map(c=>{const r=c.getBoundingClientRect(); return {l:(r.left-stage.left), r:(r.right-stage.left)};});
  const overflow = xs.some(x=>x.l<-10 || x.r>1090);
  return { n:cards.length, overflow }; })()`);
check('9张手牌不越界', hand.n === 9 && hand.overflow === false, hand);
await shot('06_portrait_fullhand');

// ---- 8. 胜利画面竖屏 ----
await ev(`(function(){ const S=window.__game; S.ehp=1; window.__api.spawnBlock('p','do',6); S.blocks.forEach(b=>b.x=9999); return true; })()`);
await sleep(1200);
st = await ev(`(function(){ return { overlay: document.getElementById('overlay').classList.contains('show') }; })()`);
check('胜利遮罩弹出', st.overlay === true, st);
await shot('07_portrait_victory');

// ---- 9. 横屏手机回退验证（844×390）----
await send('Emulation.setDeviceMetricsOverride', { width: 844, height: 390, deviceScaleFactor: 2, mobile: true });
await ev(`location.reload()`);
await sleep(1800);
st = await ev(`(function(){ const s=document.getElementById('stage');
  return { portrait: s.classList.contains('portrait'), w:innerWidth, h:innerHeight }; })()`);
check('横屏手机=landscape布局', st.portrait === false, st);
await shot('08_landscape_phone');

await send('Emulation.clearDeviceMetricsOverride');
console.log('\n===== 结果 =====');
log.forEach(l => console.log(l));
console.log('js异常:', jsErrs.length ? jsErrs : '无');
ws.close(); process.exit(log.some(l => l.startsWith('FAIL')) || jsErrs.length ? 1 : 0);
