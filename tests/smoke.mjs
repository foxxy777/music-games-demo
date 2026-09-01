// V11 冒烟测试：CDP 直连 Edge，加载页面→查状态→出牌→对撞→和弦→胜利路径，全程截图
import fs from 'fs';

const OUT = 'E:/git_repo/music-games-demo/tests/';
const URL = 'http://127.0.0.1:8117/';
const sleep = ms => new Promise(r => setTimeout(r, ms));

// 找专属测试标签（按 URL 匹配）；找不到就开一个后台新标签（WS 方式，不用会断调试端口的 PUT /json/new）
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
let mid = 0; const pending = new Map();
const jsErrs = [];
function send(method, params = {}) {
  return new Promise((res, rej) => {
    const id = ++mid; pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
}
ws.onmessage = e => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.rej(new Error(m.error.message)) : p.res(m.result); }
  else if (m.method === 'Runtime.exceptionThrown') jsErrs.push('EXC: ' + JSON.stringify(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails).slice(0, 200));
  else if (m.method === 'Page.screencastFrame') send('Page.screencastFrameAck', { sessionId: m.params?.sessionId }).catch(()=>{});
};
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
await send('Page.enable'); await send('Runtime.enable');
await send('Page.bringToFront'); // rAF 后台会被冻结，必须置前

const ev = async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result.value;
async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(OUT + 'shot_' + name + '.png', Buffer.from(r.data, 'base64'));
  console.log('shot saved:', name);
}

const log = [];
const check = (name, cond, extra) => { log.push((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra !== undefined ? ' | ' + JSON.stringify(extra) : '')); };

// ---- 1. 加载 ----
await send('Page.navigate', { url: URL });
await sleep(1200);
// screencast 强制渲染器持续产帧：后台标签页 rAF 不再冻结（bringToFront 对最小化窗口无效）
await send('Page.startScreencast', { format: 'jpeg', quality: 30, maxWidth: 640, maxHeight: 360, everyNthFrame: 2 });
await sleep(1800);

let st = await ev(`(function(){ const S=window.__game; if(!S) return null;
  return {hand:S.hand.length, deck:S.deck.length, energy:S.energy, php:S.php, ehp:S.ehp, phase:S.phase, turn:S.turn}; })()`);
check('初始状态 5手牌/10曲库/3音量', !!st && st.hand === 5 && st.deck === 10 && st.energy === 3 && st.php === 50 && st.ehp === 42, st);
await shot('01_initial');

// ---- 2. 出音符卡 ----
let played = await ev(`(function(){ const S=window.__game;
  const notes=['do','re','mi','fa','sol','la','si'];
  const i=S.hand.findIndex(c=>notes.includes(c)); if(i<0) return {err:'hand 无音符卡'};
  const cid=S.hand[i];
  document.querySelectorAll('#hand .card')[i].click();
  return {cid, energy:S.energy, blocks:S.blocks.map(b=>({side:b.side,note:b.note,force:b.force}))}; })()`);
check('出音符卡→音块生成', played && !played.err && played.energy === 2 && played.blocks.length === 1, played);
await sleep(500);
let fly = await ev(`(function(){ const S=window.__game; return {x:Math.round(S.blocks[0]?.x||0)}; })()`);
check('音块在飞行(x>起点)', fly.x > 58, fly);
await shot('02_block_flying');

// ---- 3. 快进到达：命中敌方 ----
await ev(`(function(){ const S=window.__game; const b=S.blocks[0];
  b.x = document.getElementById('zone_'+b.note).clientWidth - 40; return true; })()`);
await sleep(600);
st = await ev(`(function(){ const S=window.__game; return {ehp:S.ehp, blocks:S.blocks.length}; })()`);
check('音块到达→敌方掉血', st.ehp < 42 && st.blocks === 0, st);

// ---- 4. 结束第1小节（敌方蓄力）→ 第2小节 ----
await ev(`document.getElementById('endTurnBtn').click()`);
await sleep(1400);
st = await ev(`(function(){ const S=window.__game; return {turn:S.turn, phase:S.phase, energy:S.energy, hand:S.hand.length}; })()`);
check('第1小节结算→第2小节', st.turn === 2 && st.phase === 'play' && st.energy === 3, st);

// ---- 5. 第2小节：出一张音符卡拦截 + 结束→敌方 do/re/mi 起飞 ----
let p2 = await ev(`(function(){ const S=window.__game;
  const notes=['do','re','mi','fa','sol','la','si'];
  const i=S.hand.findIndex(c=>notes.includes(c)); if(i<0) return {err:'无音符卡'};
  const cid=S.hand[i]; document.querySelectorAll('#hand .card')[i].click();
  return {cid}; })()`);
await sleep(300);
await ev(`document.getElementById('endTurnBtn').click()`);
await sleep(1900); // 敌方 3 块在 250/650/1050ms 起飞
st = await ev(`(function(){ const S=window.__game;
  return {phase:S.phase, eblk:S.blocks.filter(b=>b.side==='e').length, pblk:S.blocks.filter(b=>b.side==='p').length,
    blocks:S.blocks.map(b=>b.side+':'+b.note+':'+b.force)}; })()`);
check('敌方歌单起飞 3 块', st.eblk === 3, st);
await shot('03_collision_course');

// 等全部结算完（含对撞演出），最多 25s
st = await ev(`(function(){ return new Promise(res=>{ const t0=Date.now();
  const iv=setInterval(()=>{ const S=window.__game;
    if(S.phase==='play'||S.phase==='over'||Date.now()-t0>25000){ clearInterval(iv);
      res({turn:S.turn, phase:S.phase, php:S.php, ehp:S.ehp}); } },300); }); })()`);
check('第2小节完整结算→第3小节', st.phase === 'play' && st.turn === 3, st);

// ---- 6. 和弦共鸣：直发 do/mi/sol ----
let res6 = await ev(`(function(){ const a=window.__api, S=window.__game;
  a.spawnBlock('p','do',6); a.spawnBlock('p','mi',6); a.spawnBlock('p','sol',6);
  return {boosted:S.blocks.filter(b=>b.boosted).length, forces:S.blocks.map(b=>b.force)}; })()`);
check('大三和弦共鸣 全员+2', res6.boosted === 3 && res6.forces.every(f => f === 8), res6);
await sleep(300);
await shot('04_resonance');

// ---- 7. 终曲华彩：立即命中结算 ----
const ehpBefore = await ev(`window.__game.ehp`);
await ev(`(function(){ const S=window.__game; S.energy=9; S.hand.push('rest'); S.phase='play';
  window.__api.playCard(S.hand.length-1); return S.ehp; })()`);
await sleep(800);
st = await ev(`(function(){ const S=window.__game; return {phase:S.phase, ehp:S.ehp}; })()`);
st.ehpBefore = ehpBefore;
check('终曲华彩立即结算(≥24伤害或直接胜利)', st.phase === 'over' || (ehpBefore - st.ehp >= 24), st);
await shot('05_victory');

console.log('\n===== 结果 =====');
log.forEach(l => console.log(l));
console.log('js异常:', jsErrs.length ? jsErrs : '无');
ws.close(); process.exit(log.some(l => l.startsWith('FAIL')) || jsErrs.length ? 1 : 0);
